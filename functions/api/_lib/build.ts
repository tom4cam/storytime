// End-to-end story build pipeline (Cloudflare). Shared by createStory's
// background work and updateStory's background work.

import type { Env } from './env';
import { generateStory, regenerateImagePrompt } from './anthropic';
import { synthesize } from './tts';
import { generateImage } from './fal';
import { moderate } from './moderation';
import { saveStoryVersion, storeMedia } from './storage';
import { notifyAdminFailure } from './alerts';
import type { GeneratedStory, Lang, Paragraph, StoryAnswer, StoryVersion } from './types';
import { charsToWords } from './words';

export class ModerationError extends Error {
  constructor(message: string) { super(message); this.name = 'ModerationError'; }
}

const FAL_CONCURRENCY = 10;

// Strips the "Cartoon illustration. Characters: ... Scene: ... Style: ..."
// wrapper that earlier versions saved on top of the base scene description.
// Without this, every subsequent edit would re-wrap the already-wrapped
// prompt, growing it without bound and eventually outrunning FAL.
function unwrapImagePrompt(p: string): string {
  const m = p.match(/^Cartoon illustration\. Characters: [^]*? Scene: ([^]*?) Style: bright colors, friendly faces, cartoon style, no text in the image\.\s*$/);
  return m ? m[1].trim() : p;
}

export async function moderateAnswers(env: Env, answers: StoryAnswer[]): Promise<void> {
  const joined = answers.map((a) => a.answer).join('\n\n');
  const result = await moderate(env, joined);
  if (result.flagged) {
    throw new ModerationError(
      'I cannot make a story with those words. Try different words for your hero, the place, or the problem.'
    );
  }
}

export async function saveGeneratingStub(env: Env, opts: {
  id: string;
  version: number;
  sourceAnswers: StoryAnswer[];
  language: Lang;
  voiceId?: string;
  creator_id?: string;
  listed?: boolean;
}): Promise<StoryVersion> {
  const stub: StoryVersion = {
    id: opts.id,
    version: opts.version,
    title: 'Your new story',
    paragraphs: [],
    narration_url: null,
    source_answers: opts.sourceAnswers,
    created_at: new Date().toISOString(),
    status: 'generating',
    language: opts.language,
    ...(opts.voiceId ? { voice_id: opts.voiceId } : {}),
    ...(opts.creator_id ? { creator_id: opts.creator_id } : {}),
    ...(opts.listed !== undefined ? { listed: opts.listed } : {}),
  };
  await saveStoryVersion(env, stub);
  return stub;
}

export async function saveFailedVersion(env: Env, opts: {
  id: string;
  version: number;
  sourceAnswers: StoryAnswer[];
  error: string;
  language: Lang;
  voiceId?: string;
  creator_id?: string;
  listed?: boolean;
  group_id?: string;
  rhyme?: boolean;
  series_id?: string;
  series_position?: number;
}): Promise<void> {
  const rec: StoryVersion = {
    id: opts.id,
    version: opts.version,
    title: 'Story did not finish',
    paragraphs: [],
    narration_url: null,
    source_answers: opts.sourceAnswers,
    created_at: new Date().toISOString(),
    status: 'failed',
    error: opts.error,
    language: opts.language,
    ...(opts.voiceId ? { voice_id: opts.voiceId } : {}),
    ...(opts.creator_id ? { creator_id: opts.creator_id } : {}),
    ...(opts.listed !== undefined ? { listed: opts.listed } : {}),
    ...(opts.group_id ? { group_id: opts.group_id } : {}),
    ...(opts.rhyme ? { rhyme: true } : {}),
    ...(opts.series_id ? { series_id: opts.series_id } : {}),
    ...(opts.series_position !== undefined ? { series_position: opts.series_position } : {}),
  };
  await saveStoryVersion(env, rec);
}

interface BuildOptions {
  id?: string;
  version: number;
  title?: string;
  sourceAnswers: StoryAnswer[];
  language: Lang;
  voiceId?: string;
  creator_id?: string;
  listed?: boolean;
  summary?: string;
  group_id?: string;
  rhyme?: boolean;
  series_id?: string;
  series_position?: number;
  paragraphs: { text: string; image_prompt?: string; image_url: string | null; regenerate_image?: boolean }[];
}

export async function buildAndSaveVersion(env: Env, opts: BuildOptions): Promise<StoryVersion> {
  const id = opts.id ?? crypto.randomUUID();
  const title = opts.title?.trim() || 'A Brand New Story';

  const paragraphTexts = opts.paragraphs.map((p) => p.text);
  const narrationText = paragraphTexts.join('\n\n');
  const narrationTask = synthesize(env, narrationText, { voiceId: opts.voiceId }).then(async ({ audio, alignment }) => {
    const url = await storeMedia(env, `${id}-v${opts.version}.mp3`, audio, 'audio/mpeg');
    const words = charsToWords(paragraphTexts, alignment);
    return { url, words };
  });

  // Batched image generation (respect Fal's 10-concurrent limit).
  const paragraphs: Paragraph[] = new Array(opts.paragraphs.length);
  for (let start = 0; start < opts.paragraphs.length; start += FAL_CONCURRENCY) {
    const slice = opts.paragraphs.slice(start, start + FAL_CONCURRENCY);
    const results = await Promise.all(slice.map(async (p, j) => {
      const i = start + j;
      const needsImage = p.regenerate_image || !p.image_url;
      if (!needsImage) {
        return { text: p.text, image_url: p.image_url, image_prompt: p.image_prompt } satisfies Paragraph;
      }
      const basePrompt = p.image_prompt && p.image_prompt.trim().length > 0
        ? unwrapImagePrompt(p.image_prompt)
        : await regenerateImagePrompt(env, p.text, title);
      const summary = opts.summary?.trim();
      const prompt = summary
        ? `Cartoon illustration. Characters: ${summary} Scene: ${basePrompt} Style: bright colors, friendly faces, cartoon style, no text in the image.`
        : basePrompt;
      const img = await generateImage(env, prompt);
      const url = await storeMedia(env, `${id}-v${opts.version}-p${i + 1}.png`, img.data, img.contentType);
      return { text: p.text, image_url: url, image_prompt: basePrompt } satisfies Paragraph;
    }));
    for (let j = 0; j < results.length; j += 1) paragraphs[start + j] = results[j];
  }

  const narration = await narrationTask;

  const version: StoryVersion = {
    id,
    version: opts.version,
    title,
    paragraphs,
    narration_url: narration.url,
    source_answers: opts.sourceAnswers,
    created_at: new Date().toISOString(),
    status: 'ready',
    language: opts.language,
    narration_words: narration.words,
    ...(opts.voiceId ? { voice_id: opts.voiceId } : {}),
    ...(opts.creator_id ? { creator_id: opts.creator_id } : {}),
    ...(opts.listed !== undefined ? { listed: opts.listed } : {}),
    ...(opts.summary && opts.summary.trim() ? { summary: opts.summary.trim() } : {}),
    ...(opts.group_id ? { group_id: opts.group_id } : {}),
    ...(opts.rhyme ? { rhyme: true } : {}),
    ...(opts.series_id ? { series_id: opts.series_id } : {}),
    ...(opts.series_position !== undefined ? { series_position: opts.series_position } : {}),
  };
  await saveStoryVersion(env, version);
  return version;
}

export async function buildFromAnswers(
  env: Env,
  id: string,
  answers: StoryAnswer[],
  language: Lang,
  voiceId?: string,
  creator_id?: string,
  rhyme = false,
  series_id?: string,
  series_position?: number,
): Promise<StoryVersion> {
  await moderateAnswers(env, answers);
  const generated = await safelyGenerate(env, answers, language, rhyme);
  return buildAndSaveVersion(env, {
    id,
    version: 1,
    title: generated.title,
    sourceAnswers: answers,
    language,
    voiceId,
    creator_id,
    listed: true,
    rhyme,
    series_id,
    series_position,
    paragraphs: generated.paragraphs.map((p) => ({ text: p.text, image_prompt: p.image_prompt, image_url: null })),
  });
}

async function safelyGenerate(env: Env, answers: StoryAnswer[], language: Lang, rhyme: boolean): Promise<GeneratedStory> {
  const generated = await generateStory(env, answers, language, rhyme);
  const fullText = `${generated.title}\n\n${generated.paragraphs.map((p) => p.text).join('\n\n')}`;
  const result = await moderate(env, fullText);
  if (result.flagged) {
    // Notify admin that generated story content was flagged by moderation.
    void notifyAdminFailure(env, 'anthropic', 'http_5xx',
      `[storytime] Story hidden by moderation\n` +
      `Reasons: ${result.reasons.join(', ')}\n` +
      `Title: ${generated.title}\n` +
      `Language: ${language}\n` +
      `Text preview:\n${fullText.slice(0, 500)}`
    );
    throw new ModerationError('The story came out a little off. Try asking again with different details.');
  }
  return generated;
}
