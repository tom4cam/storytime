// End-to-end story build pipeline (Cloudflare). Shared by createStory's
// background work and updateStory's background work.

import type { Env } from './env';
import { checkImageQuality, generateStory, regenerateImagePrompt, regenerateParagraphText, translateStory as runTranslation } from './anthropic';
import { synthesizeStory } from './narration';
import { generateImage, generateImageFromRef } from './fal';
import { moderate } from './moderation';
import { getStoryVersion, listStoryIndexes, saveStoryVersion, storeMedia } from './storage';
import { isOverMonthlyCap } from './costs';
import { notifyAdminFailure } from './alerts';
import type { GeneratedStory, Lang, Paragraph, StoryAnswer, StoryVersion } from './types';

export class ModerationError extends Error {
  constructor(message: string) { super(message); this.name = 'ModerationError'; }
}

const FAL_CONCURRENCY = 10;

// The image-gen style anchor. Flux is sensitive to style tokens; one
// consistent anchor — including an explicit, fixed palette — across every
// image keeps the whole book visually coherent and limits color drift
// between paragraphs. Tweak here to evolve the look.
const IMAGE_STYLE =
  "soft modern children's picture book illustration, gentle hand-drawn lines, " +
  'friendly rounded faces, expressive eyes, simple flat shapes, ' +
  'consistent warm pastel palette of peach, butter yellow, sky blue, sage green, and cream';

// Front-load the characters (flux weights early tokens most), then the scene,
// then the fixed style/palette suffix — so the cast and the look stay pinned
// the same way on every paragraph.
function wrapImagePrompt(scene: string, characters: string | undefined): string {
  const charLine = characters?.trim() ? `Characters: ${characters.trim()}. ` : '';
  return `${charLine}Scene: ${scene.trim()}. Style: ${IMAGE_STYLE}. No text, no signs, no letters in the image.`;
}

// Up to this many tries per image when the QC pass rejects one (the first
// try plus two regenerations with a fresh seed).
const IMAGE_QC_MAX_ATTEMPTS = 3;

// A deterministic seed. Sharing one seed across every paragraph's image nudges
// flux/schnell toward a consistent character/style look across the book
// (schnell has no image conditioning, so this is the main lever). Callers seed
// from the series id when a story belongs to a series, so every installment
// (not just every paragraph) shares the look.
function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1_000_000;
}

function qcEnabled(env: Env): boolean {
  const v = (env.IMAGE_QC_DISABLED || '').toLowerCase();
  return !(v === '1' || v === 'true' || v === 'yes');
}

// EXPERIMENTAL reference-conditioned mode (off by default). See env.ts.
function refModeEnabled(env: Env): boolean {
  const v = (env.IMAGE_REF_MODE || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function refStrength(env: Env): number {
  const n = parseFloat(env.IMAGE_REF_STRENGTH || '');
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.85;
}

type ImageBytes = { data: ArrayBuffer; contentType: string };

// Generate an image via `gen`, then (unless QC is disabled) run a vision check
// for broken anatomy, non-G-rated content, or garbled artifacts. On a rejection,
// regenerate with a different seed. If every attempt is flagged we fall back to
// the FIRST image: it used the shared per-story seed, so it stays the most
// visually consistent with the rest of the book — better than failing the story
// over one imperfect picture. `gen` takes the seed so text-to-image and
// reference-conditioned i2i can share this retry/QC harness.
async function generateCheckedImage(
  env: Env,
  gen: (seed: number) => Promise<ImageBytes>,
  baseSeed: number,
): Promise<ImageBytes> {
  const withQc = qcEnabled(env);
  const attempts = withQc ? IMAGE_QC_MAX_ATTEMPTS : 1;
  let first: ImageBytes | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const img = await gen(baseSeed + attempt);
    if (attempt === 0) first = img;
    if (!withQc) return img;
    const verdict = await checkImageQuality(env, { image: img.data, contentType: img.contentType });
    if (verdict.ok) return img;
    console.warn(`[build] image QC rejected (attempt ${attempt + 1}/${attempts}): ${verdict.problems.join('; ')}`);
  }
  return first as ImageBytes;
}

// Defensive: handle any legacy stored prompts that accidentally captured the
// wrap. We save the bare scene now, so this is a no-op for new data. Pulls out
// whatever sits between "Scene:" and the trailing "Style:"/"No text" suffix,
// which covers every wrap format we've shipped.
function unwrapImagePrompt(p: string): string {
  const m = p.match(/Scene:\s*([^]*?)\.\s*(?:Style:|No text)/);
  if (m) return m[1].trim();
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
  // Prior version's paragraphs, used by narration to reuse per-paragraph
  // MP3s when text + voice are unchanged. Omit on first generation.
  previousParagraphs?: Paragraph[];
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
  // Per-paragraph synth + reuse: unchanged paragraphs (same text + voice as
  // the prior version) reuse their saved MP3 + alignment instead of being
  // re-synthesised. Concatenates into the full narration MP3 stored at the
  // same key the player loads today.
  const narrationTask = synthesizeStory(
    env,
    id,
    opts.version,
    paragraphTexts,
    opts.voiceId,
    opts.previousParagraphs,
  ).then(({ narrationUrl, words, perParagraph }) => ({
    url: narrationUrl,
    words,
    perParagraph,
  }));

  // Image generation. Each paragraph's image is generated independently,
  // text-to-image, from its style-wrapped prompt. Paragraphs whose text and
  // prompt are unchanged reuse their stored image. Batched to respect the
  // fal concurrency budget.
  //
  // The "Characters:" anchor is the character bible alone (purely visual, the
  // strongest consistency signal); the editable story summary is only a
  // fallback for older stories that never got a bible, so it never dilutes the
  // bible when one exists.
  const anchor = opts.character_bible?.trim() || opts.summary?.trim() || '';
  // Seed from the series so every installment shares the look, not just every
  // paragraph within one book.
  const storySeed = seedFromId(opts.series_id || id);

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

  // EXPERIMENTAL: when ref mode is on and we have a character anchor, render a
  // neutral character "reference sheet" once, then condition every paragraph on
  // it (image-to-image) for stronger character consistency. Generated up front
  // so the per-paragraph batches can all reference the same sheet.
  let refSheet: ImageBytes | null = null;
  if (refModeEnabled(env) && anchor) {
    const refScene = 'character reference sheet, each character shown full-body and front-facing, '
      + 'standing side by side on a plain neutral light-grey background, even soft lighting';
    const refPrompt = wrapImagePrompt(refScene, anchor);
    try {
      refSheet = await generateCheckedImage(env, (seed) => generateImage(env, refPrompt, { seed }), storySeed);
      console.log('[build] ref-conditioned mode: reference sheet generated');
    } catch (e) {
      console.warn('[build] ref sheet generation failed; falling back to text-to-image', (e as Error).message);
    }
  }
  const strength = refStrength(env);

  const paragraphs: Paragraph[] = new Array(opts.paragraphs.length);
  for (let start = 0; start < opts.paragraphs.length; start += FAL_CONCURRENCY) {
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
      const gen = refSheet
        ? (seed: number) => generateImageFromRef(env, fullPrompt, refSheet as ImageBytes, { seed, strength })
        : (seed: number) => generateImage(env, fullPrompt, { seed });
      const img = await generateCheckedImage(env, gen, storySeed);
      const url = await storeMedia(env, `${id}-v${opts.version}-p${i + 1}.jpg`, img.data, img.contentType);
      return { text: finalText, image_url: url, image_prompt: basePrompt } satisfies Paragraph;
    }));
    for (let j = 0; j < results.length; j += 1) paragraphs[start + j] = results[j];
  }

  const narration = await narrationTask;

  // Attach per-paragraph audio cache (url + hash + alignment) to each
  // paragraph so the next save can reuse them without calling TTS again.
  const paragraphsWithAudio = paragraphs.map((p, i) => {
    const audio = narration.perParagraph[i];
    if (!audio) return p;
    return {
      ...p,
      narration_url: audio.url,
      narration_hash: audio.hash,
      narration_chars: audio.chars,
    } satisfies Paragraph;
  });

  const version: StoryVersion = {
    id,
    version: opts.version,
    title,
    paragraphs: paragraphsWithAudio,
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
        previousParagraphs: member.paragraphs,
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
