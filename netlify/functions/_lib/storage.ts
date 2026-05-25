// Netlify Blobs wrapper: stores story versions (JSON) and media (binary).
// One namespace per concern: 'stories' for story data, 'media' for images
// and audio. Keys follow simple flat patterns so listing is cheap.

import { getStore, type Store } from '@netlify/blobs';
import type { StoryIndex, StoryVersion } from './types';

const STORIES = 'stories';
const MEDIA = 'media';

// Inside the Netlify Functions runtime, NETLIFY_BLOBS_CONTEXT is set
// automatically and the SDK reads it. From a standalone script (e.g.,
// the seed scripts), we need to pass siteID and token explicitly using
// NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN from the environment.
function storeOptions(name: string) {
  const base = { name, consistency: 'strong' as const };
  if (process.env.NETLIFY_BLOBS_CONTEXT) return base;
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) return { ...base, siteID, token };
  return base;
}

function stories(): Store {
  return getStore(storeOptions(STORIES));
}

function media(): Store {
  return getStore(storeOptions(MEDIA));
}

// Story keys:
//   {id}/index.json   summary metadata, used for listing and latest lookup
//   {id}/v{n}.json    full version snapshot

export async function saveStoryVersion(version: StoryVersion): Promise<void> {
  const s = stories();
  await s.setJSON(`${version.id}/v${version.version}.json`, version);
  let createdAt = version.created_at;
  const existing = (await s.get(`${version.id}/index.json`, { type: 'json' })) as StoryIndex | null;
  if (existing?.created_at) createdAt = existing.created_at;
  const idx: StoryIndex = {
    id: version.id,
    title: version.title,
    latest_version: version.version,
    cover_image_url: version.paragraphs[0]?.image_url ?? null,
    updated_at: version.created_at,
    created_at: createdAt,
    status: version.status,
  };
  await s.setJSON(`${version.id}/index.json`, idx);
}

export async function getStoryVersion(id: string, version?: number): Promise<StoryVersion | null> {
  const s = stories();
  let v = version;
  if (v === undefined) {
    const idx = (await s.get(`${id}/index.json`, { type: 'json' })) as StoryIndex | null;
    if (!idx) return null;
    v = idx.latest_version;
  }
  return (await s.get(`${id}/v${v}.json`, { type: 'json' })) as StoryVersion | null;
}

export async function getStoryIndex(id: string): Promise<StoryIndex | null> {
  return (await stories().get(`${id}/index.json`, { type: 'json' })) as StoryIndex | null;
}

export async function listStoryIndexes(): Promise<StoryIndex[]> {
  const s = stories();
  const { blobs } = await s.list();
  const indexKeys = blobs.filter((b) => b.key.endsWith('/index.json'));
  const items = await Promise.all(
    indexKeys.map((b) => s.get(b.key, { type: 'json' }) as Promise<StoryIndex | null>)
  );
  return items
    .filter((x): x is StoryIndex => !!x && x.status === 'ready')
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

// Media: arbitrary binary, stored under a flat key like "abc-1.png" or "abc.mp3".
// Returns a URL that the browser can fetch (served by the media function).

export async function storeMedia(
  keyWithExt: string,
  data: ArrayBuffer | Uint8Array,
  contentType: string
): Promise<string> {
  const buf: ArrayBuffer = data instanceof ArrayBuffer
    ? data
    : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  await media().set(keyWithExt, buf, { metadata: { contentType } });
  return `/.netlify/functions/media?key=${encodeURIComponent(keyWithExt)}`;
}

export async function readMedia(key: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const result = await media().getWithMetadata(key, { type: 'arrayBuffer' });
  if (!result) return null;
  const contentType = (result.metadata?.contentType as string | undefined) ?? 'application/octet-stream';
  return { data: result.data as ArrayBuffer, contentType };
}
