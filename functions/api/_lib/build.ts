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

// The image-gen style anchor. Flux is sensitive to style tokens; one
// consistent anchor across every image keeps the whole book visually
// coherent. Tweak here to evolve the look.
const IMAGE_STYLE =
  "Soft modern children's picture book illustration, warm pastel palette, " +
  'gentle hand-drawn lines, friendly rounded faces, expressive eyes, simple flat shapes';

function siteUrl(env: Env): string {
  return env.SITE_URL || 'https://storytime-app.pages.dev';
}

// Turn a relative /api/media URL (what storeMedia returns) into an absolute
// URL fal can fetch when we pass it as a kontext reference image.
function absolutizeMediaUrl(env: Env, url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${siteUrl(env)}${url}`;
}

function wrapImagePrompt(scene: string, characters: string | undefined): string {
  const charLine = characters?.trim() ? `Characters: ${characters.trim()}. ` : '';
  return `${IMAGE_STYLE}. ${charLine}Scene: ${scene.trim()}. No text, no signs, no letters in the image.`;
}

// Defensive: handle any legacy stored prompts that accidentally captured
// the wrap. We save the bare scene now, so this is a no-op for new data.
function unwrapImagePrompt(p: string): string {
  const legacy = p.match(/^Cartoon illustration\. Characters: [^]*? Scene: ([^]*?) Style: bright colors, friendly faces, cartoon style, no text in the image\.\s*$/);
  if (legacy) return legacy[1].trim();
  const fresh = p.match(/^Soft modern[^]*? Scene: ([^]*?)\.\s*No text, no signs, no letters in the image\.\s*$/);
  if (fresh) return fresh[1].trim();
  return p;
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
  group_id?: string;
  title?: string;
}): Promise<StoryVersion> {
  const stub: StoryVersion = {
    id: opts.id,
    version: opts.version,
    title: opts.title ?? 'Your new story',
    paragraphs: [],
    narration_url: null,
    source_answers: opts.sourceAnswers,
    created_at: new Date().toISOString(),
    status: 'generating',
    language: opts.language,
    ...(opts.voiceId ? { voice_id: opts.voiceId } : {}),
    ...(opts.creator_id ? { creator_id: opts.creator_id } : {}),
    ...(opts.listed !== undefined ? { listed: opts.listed } : {}),
    ...(opts.group_id ? { group_id: opts.group_id } : {}),
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
  character_bible?: string;
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

  // Image generation. Paragraph 1 is generated text-to-image (or reused
  // from a prior version); its image is then the kontext reference for
  // paragraphs 2..N, which is what keeps characters visually consistent
  // across the book. The reference URL must be absolute and publicly
  // fetchable by fal — we use the fresh fal CDN URL when we just generated
  // it, and absolutize the stored /api/media URL when we reused it.
  const anchor = [opts.character_bible?.trim(), opts.summary?.trim()].filter(Boolean).join(' ');

  const resolveBasePrompt = async (
    p: BuildOptions['paragraphs'][number],
    finalText: string,
  ): Promise<string> => {
    const instruction = p.change_instruction?.trim();
    const reuseSaved = !p.regenerate_text && !instruction && !!p.image_prompt && p.image_prompt.trim().length > 0;
    return reuseSaved
      ? unwrapImagePrompt(p.image_prompt as string)
      : regenerateImagePrompt(env, finalText, title, instruction);
  };

  const paragraphs: Paragraph[] = new Array(opts.paragraphs.length);
  const firstP = opts.paragraphs[0];
  const firstNeedsImage = firstP.regenerate_image || !firstP.image_url;
  let referenceImageUrl: string | null;
  if (firstNeedsImage) {
    const basePrompt = await resolveBasePrompt(firstP, finalTexts[0]);
    const fullPrompt = wrapImagePrompt(basePrompt, anchor);
    const img = await generateImage(env, fullPrompt);
    const url = await storeMedia(env, `${id}-v${opts.version}-p1.jpg`, img.data, img.contentType);
    paragraphs[0] = { text: finalTexts[0], image_url: url, image_prompt: basePrompt };
    // Fresh fal CDN URL — fetchable for many minutes, no R2 round trip.
    referenceImageUrl = img.sourceUrl;
  } else {
    paragraphs[0] = {
      text: finalTexts[0],
      image_url: firstP.image_url,
      image_prompt: firstP.image_prompt ? unwrapImagePrompt(firstP.image_prompt) : undefined,
    };
    referenceImageUrl = absolutizeMediaUrl(env, firstP.image_url);
  }

  for (let start = 1; start < opts.paragraphs.length; start += FAL_CONCURRENCY) {
    const slice = opts.paragraphs.slice(start, start + FAL_CONCURRENCY);
    const results = await Promise.all(slice.map(async (p, j) => {
      const i = start + j;
      const finalText = finalTexts[i];
      const needsImage = p.regenerate_image || !p.image_url;
      if (!needsImage) {
        return {
          text: finalText,
          image_url: p.image_url,
          image_prompt: p.image_prompt ? unwrapImagePrompt(p.image_prompt) : undefined,
        } satisfies Paragraph;
      }
      const basePrompt = await resolveBasePrompt(p, finalText);
      const fullPrompt = wrapImagePrompt(basePrompt, anchor);
      const img = await generateImage(env, fullPrompt, {
        referenceImageUrl: referenceImageUrl ?? undefined,
      });
      const url = await storeMedia(env, `${id}-v${opts.version}-p${i + 1}.jpg`, img.data, img.contentType);
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
    ...(opts.character_bible && opts.character_bible.trim() ? { character_bible: opts.character_bible.trim() } : {}),
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
        character_bible: edited.character_bible,
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
  priorCharacters?: string,
): Promise<StoryVersion> {
  await moderateAnswers(env, answers);
  const generated = await safelyGenerate(env, answers, language, rhyme, priorCharacters);
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
    character_bible: generated.character_bible,
    paragraphs: generated.paragraphs.map((p) => ({ text: p.text, image_prompt: p.image_prompt, image_url: null })),
  });
}

async function safelyGenerate(env: Env, answers: StoryAnswer[], language: Lang, rhyme: boolean, priorCharacters?: string): Promise<GeneratedStory> {
  const generated = await generateStory(env, answers, language, rhyme, priorCharacters);
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
