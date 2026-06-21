// GET /api/_admin/listStoryVersions?id={storyId}
// Read-only inventory of versions that exist in R2 for a story. Useful
// for admin tools so they can probe what's deletable without hitting
// the destructive endpoint.

import type { Env } from '../_lib/env';
import { isAdminRequest } from '../_lib/adminAuth';
import { getStoryIndex, listStoryVersionNumbers } from '../_lib/storage';
import type { StoryVersion } from '../_lib/types';
import { badRequest, json } from '../_lib/util';

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface VersionSummary {
  version: number;
  title: string;
  status: string;
  created_at: string;
  is_latest: boolean;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAdminRequest(request, env)) return forbidden();

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return badRequest('id required');

  const idx = await getStoryIndex(env, id);
  if (!idx) return badRequest('story not found');

  const versionNums = await listStoryVersionNumbers(env, id);

  const versions: VersionSummary[] = await Promise.all(
    versionNums.map(async (v) => {
      const obj = await env.STORIES.get(`${id}/v${v}.json`);
      let title = idx.title;
      let status = idx.status;
      let created_at = idx.created_at;
      if (obj) {
        try {
          const blob = (await obj.json()) as StoryVersion;
          title = blob.title || title;
          status = blob.status || status;
          created_at = blob.created_at || created_at;
        } catch { /* ignore — surface index defaults */ }
      }
      return { version: v, title, status, created_at, is_latest: v === idx.latest_version };
    })
  );

  return json({ id, latest_version: idx.latest_version, versions });
};
