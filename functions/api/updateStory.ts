// POST /api/updateStory
// Owners (cookie matches story creator_id): overwrites the current version in place.
// Non-owners: writes a new "generating" version stub, builds, returns the new version.

import type { Env } from './_lib/env';
import { buildAndSaveVersion, propagateEditToTranslations, saveFailedVersion, saveGeneratingStub } from './_lib/build';
import { CAP_REACHED_MESSAGE, isOverMonthlyCap } from './_lib/costs';
import { getStoryIndex, getStoryVersion } from './_lib/storage';
import { readCreatorId } from './_lib/creatorId';
import { toPublicStory } from './_lib/publicStory';
import { badRequest, json, notFound, serverError } from './_lib/util';

interface UpdateStoryRequest {
  id: string;
  title: string;
  summary?: string;
  paragraphs: {
    text: string;
    image_url: string | null;
    image_prompt?: string;
    regenerate_image?: boolean;
    regenerate_text?: boolean;
    change_instruction?: string;
  }[];
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let body: UpdateStoryRequest;
  try { body = (await request.json()) as UpdateStoryRequest; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.id) return badRequest('Missing story id');
  if (!Array.isArray(body.paragraphs) || body.paragraphs.length === 0) return badRequest('paragraphs must be a non empty array');

  if (await isOverMonthlyCap(env)) return json({ error: CAP_REACHED_MESSAGE }, 429);

  const idx = await getStoryIndex(env, body.id);
  if (!idx) return notFound('That story does not exist.');
  const previous = await getStoryVersion(env, body.id, idx.latest_version);
  if (!previous) return notFound('That story version is missing.');

  const cookieId = readCreatorId(request);
  const isOwner = !!cookieId && !!previous.creator_id && cookieId === previous.creator_id;
  const targetVersion = isOwner ? idx.latest_version : idx.latest_version + 1;

  const language = previous.language ?? 'en';
  const voiceId = previous.voice_id;
  const summary = typeof body.summary === 'string' ? body.summary : (previous.summary ?? '');

  // Non-owners get the existing "generating stub" UX so the home page reflects
  // an in-flight new version. Owners edit in place; the previous ready version
  // stays valid until the new one overwrites it on success.
  if (!isOwner) {
    try {
      await saveGeneratingStub(env, {
        id: body.id, version: targetVersion,
        sourceAnswers: previous.source_answers ?? [],
        language, voiceId,
      });
    } catch (e) {
      console.error('updateStory stub failed', e);
      return serverError((e as Error).message);
    }
  }

  const title = body.title || idx.title;
  const paragraphs = body.paragraphs.map((p) => ({
    text: p.text,
    image_url: p.image_url ?? null,
    image_prompt: p.image_prompt,
    regenerate_image: !!p.regenerate_image,
    regenerate_text: !!p.regenerate_text,
    change_instruction: typeof p.change_instruction === 'string' ? p.change_instruction : undefined,
  }));
  const sourceAnswers = previous.source_answers ?? [];

  try {
    const story = await buildAndSaveVersion(env, {
      id: body.id,
      version: targetVersion,
      title,
      sourceAnswers,
      language,
      voiceId,
      summary,
      paragraphs,
      creator_id: previous.creator_id,
      listed: previous.listed,
      group_id: previous.group_id,
      rhyme: previous.rhyme,
    });
    // Owner edits are authoritative, so bring sibling translations back in
    // sync in the background (re-translate + re-narrate). Non-owner edits make
    // a new version of someone else's story and must not rewrite their group.
    if (isOwner && previous.group_id) {
      waitUntil(
        propagateEditToTranslations(env, story).catch((e) =>
          console.error('propagateEditToTranslations failed', e)),
      );
    }
    return json(toPublicStory(story, cookieId), 200);
  } catch (e) {
    console.error('update build failed', e);
    // Only record a failed version when we were creating a new one. For
    // in-place owner edits, the previous version remains intact on error.
    if (!isOwner) {
      try {
        await saveFailedVersion(env, {
          id: body.id, version: targetVersion, sourceAnswers, language, voiceId,
          creator_id: previous.creator_id,
          listed: previous.listed,
          group_id: previous.group_id,
          error: 'Something went wrong while saving the new version. Please try again.',
        });
      } catch (saveErr) { console.error('Could not record failure state', saveErr); }
    }
    return serverError((e as Error).message);
  }
};
