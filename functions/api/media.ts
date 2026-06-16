// GET /api/media?key=...
// Streams a stored image or audio blob to the client. Edge-cached for 1 year.
// Honors HTTP Range requests so audio is seekable: without 206 support the
// browser cannot seek into a not-yet-fully-downloaded MP3 and snaps playback
// back to the start, which broke per-word tap-to-play (every early tap read
// the first word).

import type { Env } from './_lib/env';

// All media keys are flat names like `{id}-v{n}-p{i}.png` / `{id}-v{n}.mp3`.
// Rejecting anything else (slashes especially) keeps this endpoint from ever
// becoming an arbitrary-key reader if namespaced objects land in the bucket.
const VALID_MEDIA_KEY = /^[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp|mp3)$/;

// Parse a single-range `Range: bytes=...` header into an R2Range. Multi-range
// requests (rare, not used by media players) return null → full 200 response.
function parseRange(header: string): R2Range | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (startStr === '' && endStr === '') return null;
  if (startStr === '') return { suffix: parseInt(endStr, 10) };
  if (endStr === '') return { offset: parseInt(startStr, 10) };
  const offset = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  if (end < offset) return null;
  return { offset, length: end - offset + 1 };
}

function contentTypeFor(key: string): string {
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return new Response('Missing key', { status: 400 });
  if (!VALID_MEDIA_KEY.test(key)) return new Response('Bad key', { status: 400 });

  const rangeHeader = request.headers.get('Range');
  const range = rangeHeader ? parseRange(rangeHeader) : null;

  const obj = await env.MEDIA.get(key, range ? { range } : undefined);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', contentTypeFor(key));
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('ETag', obj.httpEtag);

  const served = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && served) {
    let start: number;
    let length: number;
    if (typeof served.suffix === 'number') {
      length = Math.min(served.suffix, obj.size);
      start = obj.size - length;
    } else {
      start = served.offset ?? 0;
      length = served.length ?? obj.size - start;
    }
    headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
};
