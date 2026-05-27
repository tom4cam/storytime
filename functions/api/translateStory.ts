// POST /api/translateStory
// Body: { id: string, version?: number, target_language: 'en'|'sv'|'bg'|'es'|'fr' }
// Returns a brand-new StoryVersion (its own id) in the target language,
// reusing the source story's images and original voice id. Re-synthesizes
// narration in the target language.

import type { Env } from './_lib/env';
import { translateStory as runTranslation } from './_lib/anthropic';
import { buildAndSaveVersion } from './_lib/build';
import { getStoryVersion } from './_lib/storage';
import { readCreatorId } from './_lib/creatorId';
import { LANGS, type Lang } from './_lib/types';
import { badRequest, json, serverError } from './_lib/util';

interface TranslateRequest {
  id?: string;
  version?: number;
  target_language?: string;
}

const VALID_LANGS = new Set<Lang>(LANGS);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: TranslateRequest;
  try { body = await request.json(); }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.id || typeof body.id !== 'string') return badRequest('id required');
  const target = body.target_language as Lang;
  if (!VALID_LANGS.has(target)) return badRequest('target_language must be en, sv, bg, es, or fr');

  try {
    const source = await getStoryVersion(env, body.id, body.version);
    if (!source) return badRequest('source story not found');
    if (source.language === target) return badRequest('target_language must differ from source');

    const translated = await runTranslation(env, {
      title: source.title,
      paragraphs: source.paragraphs.map((p) => p.text),
      sourceLanguage: source.language,
    }, target);

    const creator_id = readCreatorId(request) ?? source.creator_id ?? undefined;
    const newId = crypto.randomUUID();

    const newVersion = await buildAndSaveVersion(env, {
      id: newId,
      version: 1,
      title: translated.title,
      sourceAnswers: [{ question: 'Translated from', answer: `${source.id} (${source.language} → ${target})` }],
      language: target,
      voiceId: source.voice_id,
      creator_id,
      listed: true,
      paragraphs: source.paragraphs.map((p, i) => ({
        text: translated.paragraphs[i],
        image_prompt: p.image_prompt,
        image_url: p.image_url,
      })),
    });

    return json(newVersion);
  } catch (e) {
    console.error('translateStory failed', e);
    return serverError((e as Error).message);
  }
};
