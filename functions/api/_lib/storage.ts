// R2-backed storage. Two buckets:
//   STORIES (env.STORIES) — JSON
//     {id}/index.json   summary metadata
//     {id}/v{n}.json    full version snapshot
//   MEDIA (env.MEDIA) — binary
//     {id}-v{n}-p{i}.png   paragraph image
//     {id}-v{n}.mp3        narration audio

import type { Env } from './env';
import type { Lang, StoryGroupSummary, StoryIndex, StoryVersion } from './types';

export async function saveStoryVersion(env: Env, version: StoryVersion): Promise<void> {
  const versionKey = `${version.id}/v${version.version}.json`;
  await env.STORIES.put(versionKey, JSON.stringify(version), {
    httpMetadata: { contentType: 'application/json' },
  });

  // Preserve original created_at across version saves.
  let createdAt = version.created_at;
  const existing = await env.STORIES.get(`${version.id}/index.json`);
  if (existing) {
    try {
      const prev = (await existing.json()) as StoryIndex;
      if (prev?.created_at) createdAt = prev.created_at;
    } catch { /* ignore */ }
  }

  const idx: StoryIndex = {
    id: version.id,
    title: version.title,
    latest_version: version.version,
    cover_image_url: version.paragraphs[0]?.image_url ?? null,
    updated_at: version.created_at,
    created_at: createdAt,
    status: version.status,
    language: version.language,
    ...(version.creator_id ? { creator_id: version.creator_id } : {}),
    ...(version.listed !== undefined ? { listed: version.listed } : {}),
    ...(version.group_id ? { group_id: version.group_id } : {}),
    ...(version.stars !== undefined ? { stars: version.stars } : {}),
    ...(version.series_id ? { series_id: version.series_id } : {}),
    ...(version.series_position !== undefined ? { series_position: version.series_position } : {}),
  };
  await env.STORIES.put(`${version.id}/index.json`, JSON.stringify(idx), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function getStoryVersion(env: Env, id: string, version?: number): Promise<StoryVersion | null> {
  let v = version;
  if (v === undefined) {
    const idx = await getStoryIndex(env, id);
    if (!idx) return null;
    v = idx.latest_version;
  }
  const obj = await env.STORIES.get(`${id}/v${v}.json`);
  if (!obj) return null;
  return (await obj.json()) as StoryVersion;
}

export async function getStoryIndex(env: Env, id: string): Promise<StoryIndex | null> {
  const obj = await env.STORIES.get(`${id}/index.json`);
  if (!obj) return null;
  return (await obj.json()) as StoryIndex;
}

// The version numbers that actually exist on disk for a story (ascending).
// Used instead of assuming versions are a contiguous 1..latest range, which
// breaks once an admin deletes a middle/earliest version: a stale link would
// linger and re-deleting it 400s with "version N not found".
export async function listStoryVersionNumbers(env: Env, id: string): Promise<number[]> {
  const result = await env.STORIES.list({ prefix: `${id}/v`, limit: 1000 });
  return result.objects
    .map((o) => {
      const m = /\/v(\d+)\.json$/.exec(o.key);
      return m ? parseInt(m[1], 10) : NaN;
    })
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

export async function listStoryIndexes(env: Env): Promise<StoryIndex[]> {
  // R2 list is paginated; for a small app one page is plenty.
  const result = await env.STORIES.list({ limit: 1000 });
  const indexKeys = result.objects.filter((o) => o.key.endsWith('/index.json'));
  const items = await Promise.all(
    indexKeys.map(async (o) => {
      const blob = await env.STORIES.get(o.key);
      if (!blob) return null;
      try { return (await blob.json()) as StoryIndex; } catch { return null; }
    })
  );
  return items
    .filter((x): x is StoryIndex => !!x && x.status === 'ready' && x.listed !== false)
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

export async function storeMedia(
  env: Env,
  keyWithExt: string,
  data: ArrayBuffer | Uint8Array,
  contentType: string
): Promise<string> {
  const buf: ArrayBuffer = data instanceof ArrayBuffer
    ? data
    : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  const put = await env.MEDIA.put(keyWithExt, buf, { httpMetadata: { contentType } });
  // Cache-bust on overwrite: owner edits reuse the same R2 key, so without
  // a per-content suffix the immutable Cache-Control on /api/media would
  // pin the browser and Cloudflare edge to the previous bytes forever.
  // R2's PUT etag is the MD5 of the upload for non-multipart writes; an
  // 8-char prefix is plenty unique per key.
  const tag = put?.etag?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
    || Date.now().toString(36);
  return `/api/media?key=${encodeURIComponent(keyWithExt)}&v=${tag}`;
}

export async function readMedia(env: Env, key: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const obj = await env.MEDIA.get(key);
  if (!obj) return null;
  const data = await obj.arrayBuffer();
  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  return { data, contentType };
}

// Flip the latest version's `listed` flag in-place (no new version).
export async function setStoryListed(env: Env, id: string, listed: boolean): Promise<StoryVersion | null> {
  const latest = await getStoryVersion(env, id);
  if (!latest) return null;
  const updated: StoryVersion = { ...latest, listed };
  await saveStoryVersion(env, updated);
  return updated;
}

// Hard-delete every blob belonging to a story.
export async function deleteStoryAndMedia(env: Env, id: string): Promise<{ story: number; media: number }> {
  const storyList = await env.STORIES.list({ prefix: `${id}/`, limit: 1000 });
  await Promise.all(storyList.objects.map((o) => env.STORIES.delete(o.key)));
  const mediaList = await env.MEDIA.list({ prefix: `${id}-`, limit: 1000 });
  await Promise.all(mediaList.objects.map((o) => env.MEDIA.delete(o.key)));
  return { story: storyList.objects.length, media: mediaList.objects.length };
}

// Every story id in the same translation group as `id` (shares group_id),
// including `id` itself. Reads index blobs directly so it catches members
// regardless of status/listed (unlike listStoryIndexes, which filters). A
// story with no group_id is its own group of one.
export async function listGroupMemberIds(env: Env, id: string): Promise<string[]> {
  const idx = await getStoryIndex(env, id);
  const groupId = idx?.group_id;
  if (!groupId) return [id];
  const all = await env.STORIES.list({ limit: 1000 });
  const indexKeys = all.objects.filter((o) => o.key.endsWith('/index.json'));
  const ids = new Set<string>([id]);
  await Promise.all(indexKeys.map(async (o) => {
    const blob = await env.STORIES.get(o.key);
    if (!blob) return;
    try {
      const m = (await blob.json()) as StoryIndex;
      if (m.id && m.group_id === groupId) ids.add(m.id);
    } catch { /* ignore unparseable blob */ }
  }));
  return [...ids];
}

// Hard-delete a story AND all of its translations (every member of its
// translation group), with all versions and media of each. Translations reuse
// the source story's image keys by URL, so deleting just one member would
// orphan or break the rest — removing the whole group is the only consistent
// "delete the entire story" operation.
export async function deleteStoryGroupAndMedia(
  env: Env,
  id: string
): Promise<{ ids: string[]; story: number; media: number }> {
  const ids = await listGroupMemberIds(env, id);
  let story = 0;
  let media = 0;
  for (const memberId of ids) {
    const counts = await deleteStoryAndMedia(env, memberId);
    story += counts.story;
    media += counts.media;
  }
  return { ids, story, media };
}

export function groupStoryIndexes(
  indexes: StoryIndex[],
  preferredLang: Lang | null,
): StoryGroupSummary[] {
  const buckets = new Map<string, { groupId: string | null; members: StoryIndex[] }>();
  for (const idx of indexes) {
    const key = idx.group_id ?? `__solo:${idx.id}`;
    const existing = buckets.get(key);
    if (existing) existing.members.push(idx);
    else buckets.set(key, { groupId: idx.group_id ?? null, members: [idx] });
  }

  // series_id -> count of distinct positions among all indexes that share it.
  // Each series member is its own translation-group; the series can span groups.
  const seriesPositions = new Map<string, Set<number>>();
  for (const idx of indexes) {
    if (!idx.series_id || idx.series_position === undefined) continue;
    const set = seriesPositions.get(idx.series_id) ?? new Set<number>();
    set.add(idx.series_position);
    seriesPositions.set(idx.series_id, set);
  }

  const groups: StoryGroupSummary[] = [];
  for (const { groupId, members } of buckets.values()) {
    const primary = pickPrimary(members, preferredLang);
    // One entry per language; if multiple members share a language (shouldn't
    // happen in practice), keep the first.
    const seen = new Set<string>();
    const memberRefs: Array<{ id: string; language: Lang }> = [];
    for (const m of members) {
      if (seen.has(m.language)) continue;
      seen.add(m.language);
      memberRefs.push({ id: m.id, language: m.language });
    }
    const languages = memberRefs.map((m) => m.language);
    const series_count = primary.series_id ? seriesPositions.get(primary.series_id)?.size : undefined;
    groups.push({
      group_id: groupId,
      primary,
      languages,
      members: memberRefs,
      ...(series_count && series_count > 1 ? { series_count } : {}),
    });
  }

  groups.sort((a, b) => (b.primary.updated_at || '').localeCompare(a.primary.updated_at || ''));
  return groups;
}

function pickPrimary(members: StoryIndex[], preferredLang: Lang | null): StoryIndex {
  if (preferredLang) {
    const match = members.find((m) => m.language === preferredLang);
    if (match) return match;
  }
  const en = members.find((m) => m.language === 'en');
  if (en) return en;
  return [...members].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0];
}

// Result of deleting a single version. `removedStory` is true when no
// versions remained and the entire story was hard-deleted.
export interface DeleteVersionResult {
  removedStory: boolean;
  newLatest?: number;
  mediaDeleted: number;
}

// Delete one version of a story. If it was the latest version, re-derive
// `index.json` from the highest remaining version (carrying its title,
// cover image, status, listed flag). If no versions remain, hard-delete
// the entire story.
// Pull the bucket key out of an `/api/media?key=...&v=...` URL.
function mediaKeyFromUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const m = /[?&]key=([^&]+)/.exec(u);
  return m ? decodeURIComponent(m[1]) : null;
}

// Collect every media key referenced by any *surviving* story version (across
// all stories — translations share image keys by URL). `excludeVersionKey` is
// the `{id}/v{n}.json` being deleted, so its own references don't count.
// This is what keeps version deletion from removing an image another version
// still points at (the bug that left the Sarah story with 5 broken images).
export async function collectReferencedMediaKeys(env: Env, excludeVersionKey: string): Promise<Set<string>> {
  const set = new Set<string>();
  const all = await env.STORIES.list({ limit: 1000 });
  const versionKeys = all.objects
    .map((o) => o.key)
    .filter((k) => /\/v\d+\.json$/.test(k) && k !== excludeVersionKey);
  await Promise.all(versionKeys.map(async (k) => {
    const blob = await env.STORIES.get(k);
    if (!blob) return;
    try {
      const v = (await blob.json()) as StoryVersion;
      for (const p of v.paragraphs ?? []) {
        const ik = mediaKeyFromUrl(p.image_url);
        if (ik) set.add(ik);
      }
      const nk = mediaKeyFromUrl(v.narration_url);
      if (nk) set.add(nk);
    } catch { /* ignore unparseable blob */ }
  }));
  return set;
}

export async function deleteOneStoryVersion(env: Env, id: string, version: number): Promise<DeleteVersionResult> {
  const versionKey = `${id}/v${version}.json`;
  const existing = await env.STORIES.get(versionKey);
  if (!existing) {
    throw new Error(`version ${version} not found for story ${id}`);
  }

  // Delete the version blob, then delete its media — but only media that no
  // surviving version still references. Unchanged paragraphs across versions
  // share one image key, so a blind prefix delete would orphan live images.
  await env.STORIES.delete(versionKey);
  const referenced = await collectReferencedMediaKeys(env, versionKey);
  const candidateMedia = (await env.MEDIA.list({ prefix: `${id}-v${version}-`, limit: 1000 })).objects.map((o) => o.key);
  candidateMedia.push(`${id}-v${version}.mp3`);
  const toDelete = candidateMedia.filter((k) => !referenced.has(k));
  await Promise.all(toDelete.map((k) => env.MEDIA.delete(k)));
  const mediaDeleted = toDelete.length;

  // Find remaining versions to decide what to do with the index.
  const versionNumbers = await listStoryVersionNumbers(env, id);

  if (versionNumbers.length === 0) {
    // No versions left — drop the index too, and sweep this story's remaining
    // media, but still spare anything another story (e.g. a translation) points
    // at so we don't break a surviving version elsewhere.
    await env.STORIES.delete(`${id}/index.json`);
    const stillReferenced = await collectReferencedMediaKeys(env, versionKey);
    const remainingMedia = (await env.MEDIA.list({ prefix: `${id}-`, limit: 1000 })).objects.map((o) => o.key);
    const orphans = remainingMedia.filter((k) => !stillReferenced.has(k));
    await Promise.all(orphans.map((k) => env.MEDIA.delete(k)));
    return { removedStory: true, mediaDeleted: mediaDeleted + orphans.length };
  }

  const highest = versionNumbers[versionNumbers.length - 1];
  const idx = await getStoryIndex(env, id);
  if (idx && idx.latest_version === version) {
    // Re-derive the index from the new highest version.
    const newLatestObj = await env.STORIES.get(`${id}/v${highest}.json`);
    if (newLatestObj) {
      const newLatest = (await newLatestObj.json()) as StoryVersion;
      const next: StoryIndex = {
        id,
        title: newLatest.title,
        latest_version: highest,
        cover_image_url: newLatest.paragraphs[0]?.image_url ?? null,
        updated_at: newLatest.created_at,
        created_at: idx.created_at,
        status: newLatest.status,
        language: newLatest.language,
        ...(newLatest.creator_id ? { creator_id: newLatest.creator_id } : {}),
        ...(newLatest.listed !== undefined ? { listed: newLatest.listed } : {}),
        ...(newLatest.group_id ? { group_id: newLatest.group_id } : {}),
        ...(newLatest.stars !== undefined ? { stars: newLatest.stars } : {}),
        ...(newLatest.series_id ? { series_id: newLatest.series_id } : {}),
        ...(newLatest.series_position !== undefined ? { series_position: newLatest.series_position } : {}),
      };
      await env.STORIES.put(`${id}/index.json`, JSON.stringify(next), {
        httpMetadata: { contentType: 'application/json' },
      });
    }
  }
  return { removedStory: false, newLatest: highest, mediaDeleted };
}
