// Storytime service worker. Manual cache strategies — no workbox.
// Bumping this version string invalidates all caches.
const VERSION = 'storytime-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const API_CACHE = `${VERSION}-api`;
const MEDIA_CACHE = `${VERSION}-media`;

const SHELL_URLS = ['/', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isAsset(url) {
  return url.pathname.startsWith('/assets/') ||
         url.pathname.startsWith('/voice-samples/') ||
         url.pathname === '/favicon.svg' ||
         url.pathname === '/manifest.webmanifest';
}

function isListStoriesApi(url) {
  return url.pathname === '/api/listStories';
}

function isGetStoryApi(url) {
  return url.pathname === '/api/getStory';
}

function isMediaApi(url) {
  return url.pathname === '/api/media';
}

function isMutationOrAdmin(url) {
  if (url.pathname.startsWith('/api/_admin')) return true;
  return /^\/api\/(createStory|updateStory|translateStory|deleteStory|deleteStoryVersion|moderate|askVoice)$/.test(url.pathname);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && (request.method === 'GET' || request.method === 'HEAD')) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

// Network-first: always try the server (so freshly saved edits show up
// immediately), falling back to the cached copy only when offline.
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => null);
  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }
  const fresh = await networkPromise;
  if (fresh) return fresh;
  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' && request.method !== 'HEAD') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // SPA navigation: network-first so a fresh deploy's index.html (and the new
  // hashed JS bundle it points at) is loaded as soon as the user is online.
  // Cache-first here pinned the old bundle and hid newly shipped features;
  // we fall back to the cached shell only when the network is unavailable.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok) {
            caches.open(SHELL_CACHE).then((c) => c.put('/', fresh.clone())).catch(() => {});
            return fresh;
          }
        } catch { /* offline — fall back to cached shell */ }
        const cached = await caches.match('/');
        return cached || fetch(request);
      })(),
    );
    return;
  }

  if (isMutationOrAdmin(url)) return;       // network-only
  if (isAsset(url)) { event.respondWith(cacheFirst(request, ASSET_CACHE)); return; }
  if (isMediaApi(url)) {
    // Range requests (audio seeking) must reach the network so the browser
    // gets a real 206; serving a cached full 200 to them would defeat seeking.
    if (request.headers.has('range')) return;
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
    return;
  }
  // A just-saved story must reflect the edit, so getStory is network-first.
  if (isGetStoryApi(url)) { event.respondWith(networkFirst(request, API_CACHE)); return; }
  if (isListStoriesApi(url)) { event.respondWith(staleWhileRevalidate(request, API_CACHE)); return; }
});
