// POST /api/_admin/restoreStory  { id: string }
// Sets listed: true on the latest version of a story. Admin-only.

import type { Env } from '../_lib/env';
import { isAdminRequest } from '../_lib/adminAuth';
import { setStoryListed } from '../_lib/storage';
import { recordAdminAction } from '../_lib/adminAudit';
import { badRequest, json, serverError } from '../_lib/util';

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAdminRequest(request, env)) return forbidden();

  let body: { id?: string };
  try { body = (await request.json()) as { id?: string }; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.id || typeof body.id !== 'string') return badRequest('id required');

  try {
    const updated = await setStoryListed(env, body.id, true);
    if (!updated) return badRequest('story not found');
    void recordAdminAction(env, {
      action: 'restore_story',
      story_id: body.id,
      detail: { listed: true },
    });
    return json({ ok: true, story: updated });
  } catch (e) {
    console.error('restoreStory failed', e);
    return serverError((e as Error).message);
  }
};
