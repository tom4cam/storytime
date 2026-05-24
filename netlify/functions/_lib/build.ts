// The end to end story build pipeline. Lives here so it can be shared by
// createStory (from answers) and updateStory (from edited paragraphs).

import { randomUUID } from 'node:crypto';
import { generateStory, regenerateImagePrompt } from './anthropic';
import { synthesize } from './elevenlabs';
import { generateImage } from './fal';
import { moderate } from './moderation';
import { saveStoryVersion, storeMedia } from './storage';
import type { GeneratedStory, Paragraph, StoryAnswer, StoryVersion } from './types';

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

export class ModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModerationError';
  }
}

interface BuildOptions {
  id?: string;
  version: number;
  title?: string;
  sourceAnswers: StoryAnswer[];
  paragraphs: { text: string; image_prompt?: string; image_url: string | null; regenerate_image?: boolean }[];
}

// Builds and saves a StoryVersion: generates any missing images, synthesizes
// fresh narration audio, and writes everything to blob storage.
export async function buildAndSaveVersion(opts: BuildOptions): Promise<StoryVersion> {
  const id = opts.id ?? randomUUID();
  const title = opts.title?.trim() || 'A Brand New Story';

  // Decide which paragraphs need a new image.
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

  const narrationText = opts.paragraphs.map((p) => p.text).join('\n\n');
  const narrationTask = synthesize(narrationText).then(async (audio) => {
    return storeMedia(`${id}-v${opts.version}.mp3`, audio, 'audio/mpeg');
  });

  const [paragraphs, narrationUrl] = await Promise.all([Promise.all(tasks), narrationTask]);

  const version: StoryVersion = {
    id,
    version: opts.version,
    title,
    paragraphs,
    narration_url: narrationUrl,
    source_answers: opts.sourceAnswers,
    created_at: new Date().toISOString(),
  };
  await saveStoryVersion(version);
  return version;
}

// Generate a story from raw answers (moderates first), then build the assets.
export async function buildFromAnswers(answers: StoryAnswer[]): Promise<StoryVersion> {
  await moderateAnswers(answers);
  const generated = await safelyGenerate(answers);
  return buildAndSaveVersion({
    version: 1,
    title: generated.title,
    sourceAnswers: answers,
    paragraphs: generated.paragraphs.map((p) => ({
      text: p.text,
      image_prompt: p.image_prompt,
      image_url: null,
    })),
  });
}

async function safelyGenerate(answers: StoryAnswer[]): Promise<GeneratedStory> {
  const generated = await generateStory(answers);
  // Second layer of safety: moderate the generated story text too.
  const fullText = `${generated.title}\n\n${generated.paragraphs.map((p) => p.text).join('\n\n')}`;
  const result = await moderate(fullText);
  if (result.flagged) {
    throw new ModerationError(
      'The story came out a little off. Try asking again with different details.'
    );
  }
  return generated;
}
