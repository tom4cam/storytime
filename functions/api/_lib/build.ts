// End-to-end story build pipeline (Cloudflare). Shared by createStory's
// background work and updateStory's background work.

import type { Env } from './env';
import { generateStory, regenerateImagePrompt, regenerateParagraphText, translateStory as runTranslation } from './anthropic';
import { synthesize } from './tts';
import { generateImage } from './fal';
import { moderate } from './moderation';
import { getStoryVersion, listStoryIndexes, saveStoryVersion, storeMedia } from './storage';
import { isOverMonthlyCap } from './costs';
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
  paragraphs: {
    text: string;
    image_prompt?: string;
    image_url: string | null;
    regenerate_image?: boolean;
    regenerate_text?: boolean;
    change_instruction?: string;
  }[];
}

export async function buildAndSaveVersion(env: Env, opts: BuildOptions): Promise<StoryVersion> {
  const id = opts.id ?? crypto.randomUUID();
  const title = opts.title?.trim() || 'A Brand New Story';

  // Phase 1: resolve final paragraph text. Paragraphs flagged for text
  // regeneration are rewritten first (optionally applying the user's change
  // instruction) so the narration and any regenerated image reflect the new
  // wording. Batched to respect the LLM/concurrency budget.
  const finalTexts: string[] = new Array(opts.paragraphs.length);
  for (let start = 0; start < opts.paragraphs.length; start += FAL_CONCURRENCY) {
    const slice = opts.paragraphs.slice(start, start + FAL_CONCURRENCY);
    const rewritten = await Promise.all(slice.map(async (p) => {
      if (!p.regenerate_text) return p.text;
      return regenerateParagraphText(env, {
        originalText: p.text,
        instruction: p.change_instruction,
        storyTitle: title,
        language: opts.language,
        rhyme: opts.rhyme,
      });
    }));
    for (let j = 0; j < rewritten.length; j += 1) finalTexts[start + j] = rewritten[j];
  }

  const paragraphTexts = finalTexts;
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
      const finalText = finalTexts[i];
      const needsImage = p.regenerate_image || !p.image_url;
      if (!needsImage) {
        return { text: finalText, image_url: p.image_url, image_prompt: p.image_prompt } satisfies Paragraph;
      }
      const instruction = p.change_instruction?.trim();
      // Reuse the saved prompt only when nothing should change it. If the text
      // was rewritten or the user gave a change instruction, derive a fresh
      // prompt from the final text (weaving the instruction in) so the picture
      // matches the new wording / requested change.
      const reuseSaved = !p.regenerate_text && !instruction && !!p.image_prompt && p.image_prompt.trim().length > 0;
      const basePrompt = reuseSaved
        ? unwrapImagePrompt(p.image_prompt as string)
        : await regenerateImagePrompt(env, finalText, title, instruction);
      const summary = opts.summary?.trim();
      const prompt = summary
        ? `Cartoon illustration. Characters: ${summary} Scene: ${basePrompt} Style: bright colors, friendly faces, cartoon style, no text in the image.`
        : basePrompt;
      const img = await generateImage(env, prompt);
      const url = await storeMedia(env, `${id}-v${opts.version}-p${i + 1}.png`, img.data, img.contentType);
      return { text: finalText, image_url: url, image_prompt: basePrompt } satisfies Paragraph;
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

// After an owner edits a story, bring its sibling translations (same group_id,
// other languages) back in sync: re-translate the edited text into each
// sibling's language and rebuild that sibling in place, reusing the edited
// story's (new) images and re-synthesizing narration in the sibling language.
// Best-effort and side-effecting — intended to run in ctx.waitUntil so the
// edit response is not blocked. Failures for one sibling don't abort others.
export async function propagateEditToTranslations(env: Env, edited: StoryVersion): Promise<void> {
  const groupId = edited.group_id;
  if (!groupId) return;
  if (await isOverMonthlyCap(env)) return;

  let indexes;
  try { indexes = await listStoryIndexes(env); }
  catch (e) { console.error('propagate: listStoryIndexes failed', e); return; }

  const siblings = indexes.filter((idx) => idx.group_id === groupId && idx.id !== edited.id && idx.language !== edited.language);
  for (const s of siblings) {
    try {
      const member = await getStoryVersion(env, s.id, s.latest_version);
      if (!member) continue;
      const translated = await runTranslation(env, {
        title: edited.title,
        paragraphs: edited.paragraphs.map((p) => p.text),
        sourceLanguage: edited.language,
      }, s.language);
      if (translated.paragraphs.length !== edited.paragraphs.length) {
        console.error(`propagate: paragraph count mismatch for ${s.id}`);
        continue;
      }
      await buildAndSaveVersion(env, {
        id: s.id,
        version: s.latest_version,
        title: translated.title,
        sourceAnswers: member.source_answers ?? [],
        language: s.language,
        voiceId: member.voice_id,
        creator_id: member.creator_id,
        listed: member.listed,
        group_id: groupId,
        rhyme: member.rhyme,
        series_id: member.series_id,
        series_position: member.series_position,
        // Reuse the edited story's images (translations share image keys) and
        // its prompts; only the text is translated and narration re-synthesized.
        paragraphs: edited.paragraphs.map((p, i) => ({
          text: translated.paragraphs[i],
          image_prompt: p.image_prompt,
          image_url: p.image_url,
        })),
      });
      console.log(`propagate: synced translation ${s.id} (${s.language})`);
    } catch (e) {
      console.error(`propagate: failed for ${s.id} (${s.language})`, e);
    }
  }
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
