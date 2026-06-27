// POST /api/deleteStory

import type { Env } from './_lib/env';
import { getStoryVersion, deleteStoryAndMedia, deleteStoryGroupAndMedia } from './_lib/storage';
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
    // Admin force-delete removes the ENTIRE story: all versions AND all
    // translations (every member of the translation group). Owner delete stays
    // scoped to the single story so a regular user deleting one language can't
    // wipe their other translations.
    if (isAdmin) {
      const result = await deleteStoryGroupAndMedia(env, body.id);
      await recordAdminAction(env, {
        action: 'delete_story',
        story_id: body.id,
        detail: { creator_id: latest.creator_id ?? null, group_member_ids: result.ids, counts: { story: result.story, media: result.media } },
      });
      return json({ ok: true, deleted: { story: result.story, media: result.media, stories_removed: result.ids.length, ids: result.ids } });
    }
    const counts = await deleteStoryAndMedia(env, body.id);
    return json({ ok: true, deleted: counts });
  } catch (e) {
    console.error('deleteStory failed', e);
    return serverError((e as Error).message);
  }
};
