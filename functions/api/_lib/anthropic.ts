// Anthropic Claude wrapper for story generation. Strict JSON output.

import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './env';
import type { GeneratedStory, Lang, StoryAnswer } from './types';
import { requireEnv } from './env';
import { notifyAdminFailure } from './alerts';
import { recordCost } from './costs';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

const STORY_SYSTEM_PROMPT = `You are a warm, playful storyteller writing for kids ages 5 to 9. Your job is to turn a few simple answers into a short illustrated story.

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

const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  sv: 'Swedish (svenska)',
  bg: 'Bulgarian',
  es: 'simple, warm Spanish (Latin American)',
  fr: 'simple, warm French (European)',
  it: 'Italian (italiano)',
  mk: 'Macedonian (македонски)',
  'pt-BR': 'Brazilian Portuguese (português do Brasil)',
  'pt-PT': 'European Portuguese (português de Portugal)',
};

export async function generateStory(env: Env, answers: StoryAnswer[], language: Lang, rhyme: boolean): Promise<GeneratedStory> {
  const apiKey = requireEnv(env, 'ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const formattedAnswers = answers.map((a) => `${a.question}\n${a.answer}`).join('\n\n');
  const langName = LANG_NAMES[language];
  const languageInstruction = `Write the title and every paragraph's "text" in ${langName}. Keep every "image_prompt" in English so the image model understands it.`;
  const rhymeInstruction = rhyme
    ? 'Write every paragraph as a short rhyming verse in simple AABB couplets suitable for ages 3-6. Keep the rhymes natural — do not stretch the sentence just to force a rhyme.'
    : 'Write in clear, warm prose suitable for ages 3-6.';

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 2500,
      system: STORY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Here are the kid's answers. Use them to write the story.\n\n${formattedAnswers}\n\n${languageInstruction}\n\n${rhymeInstruction}\n\nReturn only the JSON object.`,
        },
      ],
    });
  } catch (e) {
    await notifyAdminFailure(env, 'anthropic', 'network_error', (e as Error).message);
    throw e;
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('Claude did not return any text');
  const raw = textBlock.text.trim();
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error(`Claude returned non JSON: ${raw.slice(0, 200)}`);
  const slice = raw.slice(jsonStart, jsonEnd + 1);
  let parsed: GeneratedStory;
  try { parsed = JSON.parse(slice) as GeneratedStory; }
  catch (e) { throw new Error(`Could not parse Claude JSON: ${(e as Error).message}`); }
  if (!parsed.title || !Array.isArray(parsed.paragraphs) || parsed.paragraphs.length === 0) {
    throw new Error('Claude JSON missing required fields');
  }
  // Flat rate estimate: $0.015 per story_gen call (refine with token usage later).
  void recordCost(env, 'anthropic', 'story_gen', 0.015);
  return parsed;
}

export async function regenerateImagePrompt(env: Env, paragraphText: string, storyTitle: string): Promise<string> {
  const apiKey = requireEnv(env, 'ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 200,
      system: 'Return one short sentence describing the scene for a cartoon illustrator. Bright colors, friendly faces, cartoon style, no text in the image. Around 20 words. No quotes, no prefix.',
      messages: [
        { role: 'user', content: `Story title: ${storyTitle}\n\nParagraph:\n${paragraphText}\n\nWrite the image prompt only.` },
      ],
    });
  } catch (e) {
    await notifyAdminFailure(env, 'anthropic', 'network_error', (e as Error).message);
    throw e;
  }
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return paragraphText.slice(0, 200);
  return block.text.trim().replace(/^"|"$/g, '');
}

export interface TranslatedStoryPayload {
  title: string;
  paragraphs: string[];
}

// Exported only for tests.
export function __parseTranslation(raw: string): TranslatedStoryPayload {
  const text = raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`translation: no JSON object found`);
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!parsed.title || !Array.isArray(parsed.paragraphs)) {
    throw new Error('translation: missing title or paragraphs');
  }
  return { title: String(parsed.title), paragraphs: parsed.paragraphs.map(String) };
}

export async function translateStory(
  env: Env,
  source: { title: string; paragraphs: string[]; sourceLanguage: string },
  targetLanguage: Lang
): Promise<TranslatedStoryPayload> {
  const apiKey = requireEnv(env, 'ANTHROPIC_API_KEY');
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });

  const targetName = LANG_NAMES[targetLanguage];
  const body = source.paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');

  // Use tool-use for structured output. Claude returns a typed object
  // directly — no embedded JSON to parse, so quotes/newlines inside
  // translated paragraphs can never break the response.
  let res: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    res = await client.messages.create({
      model,
      max_tokens: 3000,
      system:
        `Translate the given children's story into ${targetName} suitable for ages 3-8. ` +
        `Keep proper names (Pip, Marta, Bob, Brennan, Linnéa, etc.) unchanged. ` +
        `Call the submit_translation tool with the translated title and one entry per source paragraph, in order. ` +
        `Return exactly ${source.paragraphs.length} paragraph${source.paragraphs.length === 1 ? '' : 's'}.`,
      tools: [
        {
          name: 'submit_translation',
          description: 'Submit the translated story.',
          input_schema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Translated story title.' },
              paragraphs: {
                type: 'array',
                items: { type: 'string' },
                description: 'Translated paragraphs in the same order as the source.',
              },
            },
            required: ['title', 'paragraphs'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_translation' },
      messages: [{ role: 'user', content: `Title: ${source.title}\n\n${body}` }],
    });
  } catch (e) {
    await notifyAdminFailure(env, 'anthropic', 'network_error', (e as Error).message);
    throw e;
  }
  const parsed = extractTranslationFromResponse(res);
  if (parsed.paragraphs.length !== source.paragraphs.length) {
    throw new Error(`translation: expected ${source.paragraphs.length} paragraphs, got ${parsed.paragraphs.length}`);
  }
  // Flat rate estimate: $0.01 per translation call.
  void recordCost(env, 'anthropic', 'translation', 0.01);
  return parsed;
}

function extractTranslationFromResponse(
  res: Anthropic.Messages.Message
): TranslatedStoryPayload {
  for (const block of res.content) {
    if (block.type === 'tool_use') {
      const input = block.input as { title?: unknown; paragraphs?: unknown } | null;
      if (input && typeof input.title === 'string' && Array.isArray(input.paragraphs)) {
        return { title: input.title, paragraphs: input.paragraphs.map((p) => String(p)) };
      }
      throw new Error('translation: tool input missing title or paragraphs');
    }
  }
  // Defensive fallback — should not happen with tool_choice forced.
  for (const block of res.content) {
    if (block.type === 'text') return __parseTranslation(block.text);
  }
  throw new Error('translation: Claude returned neither a tool call nor text');
}
