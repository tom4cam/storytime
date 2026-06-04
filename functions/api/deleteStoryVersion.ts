// POST /api/deleteStoryVersion — admin-only.
// Body: { id: string, version: number }
// Deletes a single version. If it was the latest, rolls the index back
// to the highest remaining version. If no versions remain, hard-deletes
// the entire story.

import type { Env } from './_lib/env';
import { deleteOneStoryVersion, getStoryIndex, getStoryVersion } from './_lib/storage';
import { isAdminRequest } from './_lib/adminAuth';
import { recordAdminAction } from './_lib/adminAudit';
import { badRequest, json, serverError } from './_lib/util';

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAdminRequest(request, env)) return forbidden('Admin token required');

  let body: { id?: string; version?: number };
  try { body = (await request.json()) as { id?: string; version?: number }; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.id || typeof body.id !== 'string') return badRequest('id required');
  if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 1) {
    return badRequest('version must be a positive integer');
  }

  const idx = await getStoryIndex(env, body.id);
  if (!idx) return badRequest('story not found');
  // Confirm the specific version blob exists before doing destructive work.
  // Without this an already-deleted version (stale UI / double-click) would
  // throw deep inside storage and surface as a 500.
  const versionBlob = await getStoryVersion(env, body.id, body.version);
  if (!versionBlob) return badRequest(`version ${body.version} not found`);

  try {
    const result = await deleteOneStoryVersion(env, body.id, body.version);
    await recordAdminAction(env, {
      action: 'delete_story_version',
      story_id: body.id,
      version: body.version,
      detail: { removed_story: result.removedStory, new_latest: result.newLatest ?? null },
    });
    return json({ ok: true, ...result });
  } catch (e) {
    console.error('deleteStoryVersion failed', e);
    return serverError((e as Error).message);
  }
};
