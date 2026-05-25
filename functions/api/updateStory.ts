// POST /api/updateStory
// Writes a new "generating" version stub, kicks off the build via
// ctx.waitUntil, returns 202.

import type { Env } from './_lib/env';
import { buildAndSaveVersion, saveFailedVersion, saveGeneratingStub } from './_lib/build';
import { getStoryIndex, getStoryVersion } from './_lib/storage';
import { badRequest, json, notFound, serverError } from './_lib/util';

interface UpdateStoryRequest {
  id: string;
  title: string;
  summary?: string;
  paragraphs: { text: string; image_url: string | null; image_prompt?: string; regenerate_image?: boolean }[];
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: UpdateStoryRequest;
  try { body = (await request.json()) as UpdateStoryRequest; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.id) return badRequest('Missing story id');
  if (!Array.isArray(body.paragraphs) || body.paragraphs.length === 0) return badRequest('paragraphs must be a non empty array');

  const idx = await getStoryIndex(env, body.id);
  if (!idx) return notFound('That story does not exist.');
  const previous = await getStoryVersion(env, body.id, idx.latest_version);
  if (!previous) return notFound('That story version is missing.');

  const language = previous.language ?? 'en';
  const voiceId = previous.voice_id;
  const summary = typeof body.summary === 'string' ? body.summary : (previous.summary ?? '');
  const nextVersion = idx.latest_version + 1;

  try {
    await saveGeneratingStub(env, {
      id: body.id, version: nextVersion,
      sourceAnswers: previous.source_answers ?? [],
      language, voiceId,
    });
  } catch (e) {
    console.error('updateStory stub failed', e);
    return serverError((e as Error).message);
  }

  const title = body.title || idx.title;
  const paragraphs = body.paragraphs.map((p) => ({
    text: p.text,
    image_url: p.image_url ?? null,
    image_prompt: p.image_prompt,
    regenerate_image: !!p.regenerate_image,
  }));
  const sourceAnswers = previous.source_answers ?? [];

  try {
    const story = await buildAndSaveVersion(env, {
      id: body.id, version: nextVersion, title,
      sourceAnswers, language, voiceId, summary, paragraphs,
    });
    return json(story, 200);
  } catch (e) {
    console.error('update build failed', e);
    try {
      await saveFailedVersion(env, {
        id: body.id, version: nextVersion, sourceAnswers, language, voiceId,
        error: `Something went wrong while saving the new version: ${(e as Error).message}`,
      });
    } catch (saveErr) { console.error('Could not record failure state', saveErr); }
    return serverError((e as Error).message);
  }
};
