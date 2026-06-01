// POST /api/createStory
// Validates, writes a "generating" stub, kicks off the long build work
// via ctx.waitUntil (which lets Cloudflare keep running it after the
// response is returned), and returns 202 immediately.

import type { Env } from './_lib/env';
import { buildFromAnswers, ModerationError, moderateAnswers, saveFailedVersion, saveGeneratingStub } from './_lib/build';
import { readCreatorId } from './_lib/creatorId';
import { LANGS } from './_lib/types';
import type { Lang, StoryAnswer } from './_lib/types';
import { badRequest, json, serverError } from './_lib/util';

interface CreateStoryRequest {
  answers: StoryAnswer[];
  language: Lang;
  voice_id?: string;
  rhyme?: boolean;
}

const VALID_LANGS = new Set(LANGS);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: CreateStoryRequest;
  try { body = (await request.json()) as CreateStoryRequest; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }

  if (!Array.isArray(body.answers) || body.answers.length === 0) return badRequest('answers must be a non empty array');
  if (!VALID_LANGS.has(body.language)) return badRequest('language must be one of: en, sv, bg, es, fr');
  const trimmed = body.answers
    .filter((a) => a && typeof a.answer === 'string' && a.answer.trim().length > 0)
    .map((a) => ({ question: String(a.question || ''), answer: a.answer.trim() }));
  if (trimmed.length < 3) return badRequest('At least three answers are required to make a story.');

  try { await moderateAnswers(env, trimmed); }
  catch (e) {
    if (e instanceof ModerationError) return json({ error: e.message }, 422);
    console.error('moderation failed', e);
    return serverError((e as Error).message);
  }

  const voiceId = typeof body.voice_id === 'string' && body.voice_id ? body.voice_id : undefined;
  const rhyme = typeof body.rhyme === 'boolean' ? body.rhyme : false;
  const creator_id = readCreatorId(request) ?? undefined;
  const id = crypto.randomUUID();
  try { await saveGeneratingStub(env, { id, version: 1, sourceAnswers: trimmed, language: body.language, voiceId, creator_id, listed: true }); }
  catch (e) {
    console.error('saveGeneratingStub failed', e);
    return serverError((e as Error).message);
  }

  // Build synchronously. User stories are 5-8 paragraphs; total subrequests
  // stay well under Workers' free-tier 50/invocation cap (≈ 4 calls per
  // paragraph + ~3 fixed = ~35 max). Pages Functions allow up to 5min
  // wall-clock per request which is more than enough for ~60s of
  // generation. waitUntil was tried first but doesn't reliably run the
  // background body on this configuration, leaving stories stuck in
  // "generating" forever.
  try {
    const story = await buildFromAnswers(env, id, trimmed, body.language, voiceId, creator_id, rhyme);
    return json(story, 200);
  } catch (e) {
    const message = e instanceof ModerationError
      ? e.message
      : `Something went wrong while making the story: ${(e as Error).message}`;
    console.error('build failed', e);
    try {
      await saveFailedVersion(env, {
        id, version: 1, sourceAnswers: trimmed, language: body.language, voiceId, error: message, creator_id, listed: true, rhyme,
      });
    } catch (saveErr) { console.error('Could not record failure state', saveErr); }
    if (e instanceof ModerationError) return json({ error: e.message }, 422);
    return serverError(message);
  }
};
