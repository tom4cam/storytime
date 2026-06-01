// GET /api/_admin/listFlagged
// Lists all stories where listed === false. Admin-only.

import type { Env } from '../_lib/env';
import { isAdminRequest } from '../_lib/adminAuth';
import { recordAdminAction } from '../_lib/adminAudit';
import { json } from '../_lib/util';
import type { StoryIndex, StoryVersion } from '../_lib/types';

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface FlaggedStorySummary {
  id: string;
  title: string;
  language: string;
  created_at: string;
  creator_id: string | null;
  status: string;
  error?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAdminRequest(request, env)) return forbidden();

  // List all index.json keys and filter to listed === false.
  const result = await env.STORIES.list({ limit: 1000 });
  const indexKeys = result.objects.filter((o) => o.key.endsWith('/index.json'));

  const flagged: FlaggedStorySummary[] = [];
  await Promise.all(
    indexKeys.map(async (o) => {
      const blob = await env.STORIES.get(o.key);
      if (!blob) return;
      let idx: StoryIndex;
      try { idx = (await blob.json()) as StoryIndex; } catch { return; }
      if (idx.listed !== false) return;

      // Fetch the latest version to get error detail if any.
      let errorDetail: string | undefined;
      try {
        const vObj = await env.STORIES.get(`${idx.id}/v${idx.latest_version}.json`);
        if (vObj) {
          const v = (await vObj.json()) as StoryVersion;
          if (v.error) errorDetail = v.error;
        }
      } catch { /* ignore */ }

      flagged.push({
        id: idx.id,
        title: idx.title,
        language: idx.language,
        created_at: idx.created_at,
        creator_id: idx.creator_id ?? null,
        status: idx.status,
        ...(errorDetail ? { error: errorDetail } : {}),
      });
    })
  );

  // Sort newest first.
  flagged.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  void recordAdminAction(env, { action: 'list_flagged', detail: { count: flagged.length } });
  return json({ flagged });
};
