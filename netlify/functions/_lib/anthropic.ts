// Anthropic Claude wrapper for story generation. The output is strict JSON.
// Prompt text is also documented in docs/PROMPTS.md; keep the two in sync.

import Anthropic from '@anthropic-ai/sdk';
import type { GeneratedStory, StoryAnswer } from './types';
import { requireEnv } from './util';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export const STORY_SYSTEM_PROMPT = `You are a warm, playful storyteller writing for kids ages 5 to 9. Your job is to turn a few simple answers into a short illustrated story.

Strict rules:
- G rated only. No violence, no real fear, no romance, no mean characters, no bathroom humor, no scary monsters.
- Use simple words a 6 year old can understand.
- The story has 5 to 8 short paragraphs. Each paragraph is 2 to 4 sentences.
- Include a small, age appropriate problem and a kind, satisfying ending.
- Keep the tone warm and a little playful.
- Do not use hyphens or em dashes or emojis. Prefer commas and periods.
- Output strict JSON. No prose outside the JSON. No code fences.

JSON shape:
{
  "title": "A short, fun title under 8 words",
  "paragraphs": [
    {
      "text": "The paragraph text.",
      "image_prompt": "One sentence describing the scene for a cartoon illustrator. Bright colors, friendly faces, cartoon style, no text in the image."
    }
  ]
}

Image prompts: describe one clear scene per paragraph in cartoon style, child friendly, around 20 words. Mention the main character and the setting each time so the illustrator stays consistent.`;

export async function generateStory(answers: StoryAnswer[]): Promise<GeneratedStory> {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const formattedAnswers = answers
    .map((a) => `${a.question}\n${a.answer}`)
    .join('\n\n');

  const response = await client.messages.create({
    model,
    max_tokens: 2500,
    system: STORY_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Here are the kid's answers. Use them to write the story.\n\n${formattedAnswers}\n\nReturn only the JSON object.`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude did not return any text');
  }
  const raw = textBlock.text.trim();
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`Claude returned non JSON: ${raw.slice(0, 200)}`);
  }
  const slice = raw.slice(jsonStart, jsonEnd + 1);
  let parsed: GeneratedStory;
  try {
    parsed = JSON.parse(slice) as GeneratedStory;
  } catch (e) {
    throw new Error(`Could not parse Claude JSON: ${(e as Error).message}`);
  }
  if (!parsed.title || !Array.isArray(parsed.paragraphs) || parsed.paragraphs.length === 0) {
    throw new Error('Claude JSON missing required fields');
  }
  return parsed;
}

export async function regenerateImagePrompt(paragraphText: string, storyTitle: string): Promise<string> {
  const apiKey = requireEnv('ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const response = await client.messages.create({
    model,
    max_tokens: 200,
    system: 'Return one short sentence describing the scene for a cartoon illustrator. Bright colors, friendly faces, cartoon style, no text in the image. Around 20 words. No quotes, no prefix.',
    messages: [
      {
        role: 'user',
        content: `Story title: ${storyTitle}\n\nParagraph:\n${paragraphText}\n\nWrite the image prompt only.`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return paragraphText.slice(0, 200);
  return block.text.trim().replace(/^"|"$/g, '');
}
