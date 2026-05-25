// The end to end story build pipeline. Lives here so it can be shared by
// the createStory + createWorker-background pair and by updateStory.

import { randomUUID } from 'node:crypto';
import { generateStory, regenerateImagePrompt } from './anthropic';
import { synthesize } from './elevenlabs';
import { generateImage } from './fal';
import { moderate } from './moderation';
import { saveStoryVersion, storeMedia } from './storage';
import type { GeneratedStory, Paragraph, StoryAnswer, StoryVersion } from './types';
import { charsToWords } from './words';

export class ModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModerationError';
  }
}

// Run moderation against every answer. Throws if any input is flagged.
export async function moderateAnswers(answers: StoryAnswer[]): Promise<void> {
  const joined = answers.map((a) => a.answer).join('\n\n');
  const result = await moderate(joined);
  if (result.flagged) {
    throw new ModerationError(
      'I cannot make a story with those words. Try different words for your hero, the place, or the problem.'
    );
  }
}

// Write a "generating" placeholder so the UI can poll and show a loading
// state. We deliberately don't touch the {id}/index.json record yet, so
// the home page list does not include unfinished stories.
export async function saveGeneratingStub(opts: {
  id: string;
  version: number;
  sourceAnswers: StoryAnswer[];
  language: 'en' | 'sv';
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
  };
  await saveStoryVersion(stub);
  return stub;
}

// Mark a generating record as failed so the UI can show a friendly message
// instead of polling forever.
export async function saveFailedVersion(opts: {
  id: string;
  version: number;
  sourceAnswers: StoryAnswer[];
  error: string;
  language: 'en' | 'sv';
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
  };
  await saveStoryVersion(rec);
}

interface BuildOptions {
  id?: string;
  version: number;
  title?: string;
  sourceAnswers: StoryAnswer[];
  language: 'en' | 'sv';
  paragraphs: { text: string; image_prompt?: string; image_url: string | null; regenerate_image?: boolean }[];
}

// Builds the assets (any missing images + fresh narration audio) and saves
// the story as the canonical {id}/v{n}.json record plus updating the
// {id}/index.json summary.
export async function buildAndSaveVersion(opts: BuildOptions): Promise<StoryVersion> {
  const id = opts.id ?? randomUUID();
  const title = opts.title?.trim() || 'A Brand New Story';

  const tasks = opts.paragraphs.map(async (p, i) => {
    const needsImage = p.regenerate_image || !p.image_url;
    if (!needsImage) {
      return { text: p.text, image_url: p.image_url, image_prompt: p.image_prompt } satisfies Paragraph;
    }
    const prompt = p.image_prompt && p.image_prompt.trim().length > 0
      ? p.image_prompt
      : await regenerateImagePrompt(p.text, title);
    const img = await generateImage(prompt);
    const url = await storeMedia(`${id}-v${opts.version}-p${i + 1}.png`, img.data, img.contentType);
    return { text: p.text, image_url: url, image_prompt: prompt } satisfies Paragraph;
  });

  const paragraphTexts = opts.paragraphs.map((p) => p.text);
  const narrationText = paragraphTexts.join('\n\n');
  const narrationTask = synthesize(narrationText).then(async ({ audio, alignment }) => {
    const url = await storeMedia(`${id}-v${opts.version}.mp3`, audio, 'audio/mpeg');
    const words = charsToWords(paragraphTexts, alignment);
    return { url, words };
  });

  const [paragraphs, narration] = await Promise.all([Promise.all(tasks), narrationTask]);

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
  };
  await saveStoryVersion(version);
  return version;
}

// Generates a story from the kid's answers (moderates first), then builds
// the assets. Throws ModerationError if anything is flagged.
export async function buildFromAnswers(id: string, answers: StoryAnswer[], language: 'en' | 'sv'): Promise<StoryVersion> {
  await moderateAnswers(answers);
  const generated = await safelyGenerate(answers, language);
  return buildAndSaveVersion({
    id,
    version: 1,
    title: generated.title,
    sourceAnswers: answers,
    language,
    paragraphs: generated.paragraphs.map((p) => ({
      text: p.text,
      image_prompt: p.image_prompt,
      image_url: null,
    })),
  });
}

async function safelyGenerate(answers: StoryAnswer[], language: 'en' | 'sv'): Promise<GeneratedStory> {
  const generated = await generateStory(answers, language);
  const fullText = `${generated.title}\n\n${generated.paragraphs.map((p) => p.text).join('\n\n')}`;
  const result = await moderate(fullText);
  if (result.flagged) {
    throw new ModerationError(
      'The story came out a little off. Try asking again with different details.'
    );
  }
  return generated;
}
