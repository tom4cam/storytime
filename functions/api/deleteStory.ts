// POST /api/deleteStory

import type { Env } from './_lib/env';
import { getStoryVersion, deleteStoryAndMedia } from './_lib/storage';
import { readCreatorId } from './_lib/creatorId';
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
  let body: { id?: string };
  try { body = (await request.json()) as { id?: string }; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.id || typeof body.id !== 'string') return badRequest('id required');

  const cookieId = readCreatorId(request);
  const isAdmin = isAdminRequest(request, env);
  const latest = await getStoryVersion(env, body.id);
  if (!latest) return badRequest('story not found');

  if (!isAdmin) {
    // System stories (or legacy ones with no creator_id) are never deletable.
    if (!latest.creator_id || latest.creator_id === 'system') {
      return forbidden("This is a default story and can't be deleted");
    }
    if (!cookieId || cookieId !== latest.creator_id) {
      return forbidden('Only the creator can delete this story');
    }
  }

  try {
    const counts = await deleteStoryAndMedia(env, body.id);
    if (isAdmin) {
      await recordAdminAction(env, {
        action: 'delete_story',
        story_id: body.id,
        detail: { creator_id: latest.creator_id ?? null, counts },
      });
    }
    return json({ ok: true, deleted: counts });
  } catch (e) {
    console.error('deleteStory failed', e);
    return serverError((e as Error).message);
  }
};
