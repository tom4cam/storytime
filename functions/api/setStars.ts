// POST /api/setStars  body: { id: string, stars: number | null }
// Owner-only. Stars 1..5 or null to clear.

import type { Env } from './_lib/env';
import { getStoryVersion, saveStoryVersion } from './_lib/storage';
import { readCreatorId } from './_lib/creatorId';
import { badRequest, json, notFound } from './_lib/util';

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403, headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { id?: string; stars?: number | null };
  try { body = (await request.json()) as typeof body; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.id) return badRequest('id required');
  const stars = body.stars;
  if (stars !== null && stars !== undefined && (typeof stars !== 'number' || stars < 1 || stars > 5)) {
    return badRequest('stars must be 1..5 or null');
  }

  const latest = await getStoryVersion(env, body.id);
  if (!latest) return notFound('story not found');

  const cookieId = readCreatorId(request);
  if (!cookieId || cookieId !== latest.creator_id) {
    return forbidden('Only the story owner can set stars');
  }

  const next = { ...latest };
  if (stars === null || stars === undefined) delete next.stars;
  else next.stars = stars;
  await saveStoryVersion(env, next);
  return json({ ok: true, stars: next.stars ?? null });
};
