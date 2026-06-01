// POST /api/createStory
// Validates, writes a "generating" stub, kicks off the long build work
// via ctx.waitUntil (which lets Cloudflare keep running it after the
// response is returned), and returns 202 immediately.

import type { Env } from './_lib/env';
import { buildFromAnswers, ModerationError, moderateAnswers, saveFailedVersion, saveGeneratingStub } from './_lib/build';
import { readCreatorId } from './_lib/creatorId';
import { getStoryIndex, getStoryVersion, listStoryIndexes, saveStoryVersion } from './_lib/storage';
import { LANGS } from './_lib/types';
import type { Lang, StoryAnswer } from './_lib/types';
import { badRequest, json, serverError } from './_lib/util';

interface CreateStoryRequest {
  answers: StoryAnswer[];
  language: Lang;
  voice_id?: string;
  rhyme?: boolean;
  series_id?: string;
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

  // Resolve series membership when series_id is supplied.
  // series_id here is expected to be the UUID series key (not a story id).
  // If the series is brand new (no existing members have it), the source story
  // (identified by body.series_id acting as the root) gets tagged as position 1.
  let seriesId: string | undefined;
  let seriesPosition: number | undefined;
  let sourceStoryIdToTag: string | undefined; // source story that needs series tagging if position=1
  if (body.series_id) {
    // body.series_id can be either:
    //   (a) an existing series UUID already stored on other stories, or
    //   (b) a story id whose owner wants to start a new series from it.
    // We detect (b) by checking if any indexed story has series_id === body.series_id.
    const all = await listStoryIndexes(env);
    const existingMembers = all.filter((i) => i.series_id === body.series_id);
    if (existingMembers.length > 0) {
      // Continuing an existing series — validate ownership via first member.
      const any = existingMembers[0];
      if (!creator_id || any.creator_id !== creator_id) return badRequest('series not owned by caller');
      seriesId = body.series_id;
      const maxPos = existingMembers.reduce((acc, m) => Math.max(acc, m.series_position ?? 1), 1);
      seriesPosition = maxPos + 1;
    } else {
      // Starting a new series — body.series_id is treated as the source story id.
      const sourceIndex = await getStoryIndex(env, body.series_id);
      if (!sourceIndex) return badRequest('series source story not found');
      if (!creator_id || sourceIndex.creator_id !== creator_id) return badRequest('series source story not owned by caller');
      seriesId = crypto.randomUUID();
      seriesPosition = 2; // new story is part 2; source will become part 1
      sourceStoryIdToTag = body.series_id;
    }
  }

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
    const story = await buildFromAnswers(env, id, trimmed, body.language, voiceId, creator_id, rhyme, seriesId, seriesPosition);
    // If we started a new series, tag the source story as position 1.
    if (sourceStoryIdToTag && seriesId) {
      try {
        const src = await getStoryVersion(env, sourceStoryIdToTag);
        if (src) {
          await saveStoryVersion(env, { ...src, series_id: seriesId, series_position: 1 });
        }
      } catch (tagErr) {
        console.error('Could not tag source story with series info', tagErr);
      }
    }
    return json(story, 200);
  } catch (e) {
    const message = e instanceof ModerationError
      ? e.message
      : `Something went wrong while making the story: ${(e as Error).message}`;
    console.error('build failed', e);
    try {
      await saveFailedVersion(env, {
        id, version: 1, sourceAnswers: trimmed, language: body.language, voiceId, error: message, creator_id, listed: true, rhyme,
        series_id: seriesId, series_position: seriesPosition,
      });
    } catch (saveErr) { console.error('Could not record failure state', saveErr); }
    if (e instanceof ModerationError) return json({ error: e.message }, 422);
    return serverError(message);
  }
};
