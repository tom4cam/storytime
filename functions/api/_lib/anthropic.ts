// Anthropic Claude wrapper for story generation. Strict JSON output.

import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './env';
import type { GeneratedStory, Lang, StoryAnswer } from './types';
import { requireEnv } from './env';
import { notifyAdminFailure } from './alerts';
import { recordAnthropicUsage } from './costs';
import { recordCall } from './telemetry';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

const STORY_SYSTEM_PROMPT = `You are a warm, playful storyteller writing for kids ages 5 to 9. Your job is to turn a few simple answers into a short illustrated story.

Strict rules:
- G rated only. No violence, no real fear, no romance, no mean characters, no bathroom humor, no scary monsters.
- Use simple words a 6 year old can understand.
- The story has 5 to 8 short paragraphs. Each paragraph is 2 to 4 sentences.
- Include a small, age appropriate problem and a kind, satisfying ending.
- Keep the tone warm and a little playful.
- Do not use hyphens or em dashes or emojis. Prefer commas and periods.

Submit the finished story by calling the submit_story tool. Fill in title, character_bible, and one paragraph object (text plus image_prompt) per paragraph.

Character consistency (very important): First lock each named character's exact visual look in "character_bible". Then, in every image_prompt, repeat the character's defining physical features using the SAME words from the bible (hair, fur, colors, signature clothing). A character must look identical across every image. Only change a character's described look if the story itself changes it (for example they put on a costume or get a haircut), and only from that paragraph onward.`;

// Forced-tool schema for story generation. Using tool-use (like translateStory)
// gives us SDK-parsed structured output instead of hand-slicing a JSON string
// out of a text completion — no more brittle brace-matching or code-fence
// stripping, and the model can't wander off-shape.
const STORY_TOOL = {
  name: 'submit_story',
  description: 'Submit the finished illustrated children\'s story.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'A short, fun title under 8 words.' },
      character_bible: {
        type: 'string',
        description:
          "Visual descriptions only. Format each as 'Name: <species or age>, <hair / fur / scales>, <eye color>, <skin color>, <clothing with specific colors>.' One per line. Concrete physical features only, no personality words. Example: 'Mo: a small brown mouse, big round ears, black eyes, cream belly, red wool scarf, no shoes. Lily: a girl, age 6, curly black hair in two puffs, brown eyes, warm beige skin, yellow corduroy dress, white sneakers.'",
      },
      paragraphs: {
        type: 'array',
        description: '5 to 8 paragraphs, in order.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The paragraph text, 2 to 4 sentences, in the target language.' },
            image_prompt: {
              type: 'string',
              description:
                "Pure scene description, around 20 words, in English even when the story text is in another language. Name the main character(s), the setting, the action, the mood lighting, repeating each character's defining physical features using the same words as character_bible. Do NOT include style instructions, color palette notes, or 'no text' negatives, those are added downstream. Example: 'Mo the mouse stands on tip-toes at a wooden kitchen counter, kneading bread dough, flour puffing into warm afternoon sunlight.'",
            },
          },
          required: ['text', 'image_prompt'],
        },
      },
    },
    required: ['title', 'paragraphs'],
  },
};

// Normalise the submit_story tool input into a GeneratedStory. Exported for
// tests. Defensive against the model emitting `paragraphs` as a stringified
// JSON array (a known non-Latin-script failure mode also handled in
// translateStory).
export function __coerceStoryInput(input: unknown): GeneratedStory {
  if (!input || typeof input !== 'object') throw new Error('story: tool input was not an object');
  const obj = input as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  if (!title) throw new Error('story: missing title');
  const character_bible = typeof obj.character_bible === 'string' ? obj.character_bible.trim() : '';

  let rawParas: unknown = obj.paragraphs;
  if (typeof rawParas === 'string') {
    const t = rawParas.trim();
    if (t.startsWith('[') && t.endsWith(']')) {
      try { rawParas = JSON.parse(t); } catch { /* fall through to the array check */ }
    }
  }
  if (!Array.isArray(rawParas) || rawParas.length === 0) throw new Error('story: missing paragraphs');

  const paragraphs = rawParas.map((p, i) => {
    const item = (p ?? {}) as Record<string, unknown>;
    const text = typeof item.text === 'string' ? item.text : '';
    const image_prompt = typeof item.image_prompt === 'string' ? item.image_prompt : '';
    if (!text) throw new Error(`story: paragraph ${i + 1} missing text`);
    return { text, image_prompt };
  });

  return character_bible ? { title, character_bible, paragraphs } : { title, paragraphs };
}

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

export async function generateStory(
  env: Env,
  answers: StoryAnswer[],
  language: Lang,
  rhyme: boolean,
  priorCharacters?: string,
): Promise<GeneratedStory> {
  const apiKey = requireEnv(env, 'ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const formattedAnswers = answers.map((a) => `${a.question}\n${a.answer}`).join('\n\n');
  const langName = LANG_NAMES[language];
  const languageInstruction = `Write the title and every paragraph's "text" in ${langName}. Keep every "image_prompt" in English so the image model understands it.`;
  const rhymeInstruction = rhyme
    ? 'Write every paragraph as a short rhyming verse in simple AABB couplets suitable for ages 3-6. Keep the rhymes natural — do not stretch the sentence just to force a rhyme.'
    : 'Write in clear, warm prose suitable for ages 3-6.';
  // For a sequel, returning characters MUST keep the look they had before.
  const sequelInstruction = priorCharacters && priorCharacters.trim()
    ? `\n\nThis is a sequel. These characters already appeared and must look the same. Reuse these descriptions word for word for returning characters in "character_bible" and in every image_prompt, and add any new characters:\n${priorCharacters.trim()}`
    : '';

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await recordCall(env, 'anthropic', 'story_gen', () =>
      client.messages.create({
        model,
        // Generous cap so a non-Latin-script story (Cyrillic tokenizes at
        // multiple tokens per char) never truncates before the tool call closes.
        max_tokens: 8000,
        system: STORY_SYSTEM_PROMPT,
        tools: [STORY_TOOL],
        tool_choice: { type: 'tool', name: 'submit_story' },
        messages: [
          {
            role: 'user',
            content: `Here are the kid's answers. Use them to write the story.\n\n${formattedAnswers}\n\n${languageInstruction}\n\n${rhymeInstruction}${sequelInstruction}\n\nCall the submit_story tool with the finished story.`,
          },
        ],
      })
    );
  } catch (e) {
    await notifyAdminFailure(env, 'anthropic', 'network_error', (e as Error).message);
    throw e;
  }

  const toolBlock = response.content.find((b) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    if (response.stop_reason === 'max_tokens') {
      throw new Error('story: response truncated at max_tokens before tool call completed');
    }
    throw new Error(`story: Claude did not call submit_story (stop=${response.stop_reason})`);
  }
  const parsed = __coerceStoryInput(toolBlock.input);
  void recordAnthropicUsage(env, 'story_gen', model, response.usage);
  return parsed;
}

// Derive a character bible for an existing story (one without one — created
// before the bible feature). Returns concrete, fixed visual descriptions of
// each named character, one per line.
export async function generateCharacterBible(
  env: Env,
  opts: { title: string; paragraphs: string[] },
): Promise<string> {
  const apiKey = requireEnv(env, 'ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const body = opts.paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');
  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 400,
      system: 'You are a character designer for a children\'s picture book. Given a story, list each named character on its own line with a concrete, unchanging visual look. Format: "Name: <species or age>, <hair / fur / scales>, <eye color>, <skin color>, <clothing with specific colors>." Physical features only — no personality words. Infer reasonable, consistent details where the story is silent. Example: "Mo: a small brown mouse, big round ears, black eyes, cream belly, red wool scarf, no shoes." Return only the descriptions, no preamble and no JSON.',
      messages: [{ role: 'user', content: `Title: ${opts.title}\n\n${body}` }],
    });
  } catch (e) {
    await notifyAdminFailure(env, 'anthropic', 'network_error', (e as Error).message);
    throw e;
  }
  void recordAnthropicUsage(env, 'story_gen', model, response.usage);
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return '';
  return block.text.trim().replace(/^"|"$/g, '');
}

export async function regenerateImagePrompt(
  env: Env,
  paragraphText: string,
  storyTitle: string,
  instruction?: string,
): Promise<string> {
  const apiKey = requireEnv(env, 'ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  // An optional user instruction (e.g. "give him blond medium-long hair") is
  // woven into the scene so the regenerated image reflects the requested change.
  const changeLine = instruction && instruction.trim()
    ? `\n\nIncorporate this change in the scene: ${instruction.trim()}`
    : '';
  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 200,
      system: 'Return one short sentence describing the scene only — main character(s), setting, action, mood lighting. Around 20 words. No style instructions, no color palette notes, no negatives like "no text" — those are added downstream. No quotes, no prefix.',
      messages: [
        { role: 'user', content: `Story title: ${storyTitle}\n\nParagraph:\n${paragraphText}${changeLine}\n\nWrite the image prompt only.` },
      ],
    });
  } catch (e) {
    await notifyAdminFailure(env, 'anthropic', 'network_error', (e as Error).message);
    throw e;
  }
  void recordAnthropicUsage(env, 'story_gen', model, response.usage);
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return paragraphText.slice(0, 200);
  return block.text.trim().replace(/^"|"$/g, '');
}

// Rewrite a single paragraph during an edit. With an instruction it applies
// that specific change ("make him braver", "add a puppy"); without one it
// rephrases the same events with fresh wording. Returns plain text.
export async function regenerateParagraphText(
  env: Env,
  opts: { originalText: string; instruction?: string; storyTitle: string; language: Lang; rhyme?: boolean },
): Promise<string> {
  const apiKey = requireEnv(env, 'ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const langName = LANG_NAMES[opts.language];
  const styleRule = opts.rhyme
    ? 'Write it as a short rhyming verse in simple AABB couplets.'
    : 'Write clear, warm prose.';
  const change = opts.instruction && opts.instruction.trim()
    ? `Apply this change: ${opts.instruction.trim()}`
    : 'Rewrite it with fresh wording while keeping the same meaning and events.';
  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 600,
      system: `You are a warm storyteller for kids ages 5 to 9. Rewrite a single paragraph of a story. G rated only: no violence, no real fear, no romance, no mean characters. Use simple words. Keep it to 2 to 4 short sentences, about the same length as the original. Keep any character names unchanged. Write in ${langName}. ${styleRule} Do not use hyphens, em dashes, or emojis. Return only the rewritten paragraph text, with no quotes, no prefix, and no JSON.`,
      messages: [
        { role: 'user', content: `Story title: ${opts.storyTitle}\n\nOriginal paragraph:\n${opts.originalText}\n\n${change}\n\nReturn only the new paragraph text.` },
      ],
    });
  } catch (e) {
    await notifyAdminFailure(env, 'anthropic', 'network_error', (e as Error).message);
    throw e;
  }
  void recordAnthropicUsage(env, 'story_gen', model, response.usage);
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return opts.originalText;
  const text = block.text.trim().replace(/^"|"$/g, '');
  return text || opts.originalText;
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

  // Use tool-use for structured output with one explicit string field per
  // paragraph (paragraph_1, paragraph_2, ...). An array-of-strings schema
  // works most of the time but occasionally gets serialized as a stringified
  // JSON array — especially for non-Latin scripts — and that string can
  // contain unescaped inner quotes that defeat any downstream parser.
  // Flat scalar fields sidestep that entire failure mode.
  const paragraphProps: Record<string, { type: 'string'; description: string }> = {};
  const required: string[] = ['title'];
  for (let i = 1; i <= source.paragraphs.length; i++) {
    const key = `paragraph_${i}`;
    paragraphProps[key] = { type: 'string', description: `Translation of source paragraph [${i}].` };
    required.push(key);
  }

  let res: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    res = await recordCall(env, 'anthropic', 'translation', () => client.messages.create({
      model,
      // Generous cap so we never truncate mid tool-call. Non-Latin scripts
      // (Cyrillic, Devanagari, etc.) tokenize at multiple tokens per char,
      // so the 3000-token budget could be exhausted by a single story.
      max_tokens: 16000,
      system:
        `Translate the given children's story into ${targetName} suitable for ages 3-8. ` +
        `Keep proper names (Pip, Marta, Bob, Brennan, Linnéa, etc.) unchanged. ` +
        `Call the submit_translation tool. Fill paragraph_1 through paragraph_${source.paragraphs.length} ` +
        `with the translation of source paragraphs [1] through [${source.paragraphs.length}] respectively.`,
      tools: [
        {
          name: 'submit_translation',
          description: 'Submit the translated story.',
          input_schema: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Translated story title.' },
              ...paragraphProps,
            },
            required,
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_translation' },
      messages: [{ role: 'user', content: `Title: ${source.title}\n\n${body}` }],
    }));
  } catch (e) {
    await notifyAdminFailure(env, 'anthropic', 'network_error', (e as Error).message);
    throw e;
  }
  const parsed = extractTranslationFromResponse(res, source.paragraphs.length);
  if (parsed.paragraphs.length !== source.paragraphs.length) {
    throw new Error(`translation: expected ${source.paragraphs.length} paragraphs, got ${parsed.paragraphs.length}`);
  }
  void recordAnthropicUsage(env, 'translation', model, res.usage);
  return parsed;
}

function extractTranslationFromResponse(
  res: Anthropic.Messages.Message,
  expectedCount: number,
): TranslatedStoryPayload {
  const stopReason = res.stop_reason;
  for (const block of res.content) {
    if (block.type === 'tool_use') {
      const input = (block.input ?? null) as Record<string, unknown> | null;
      if (input && typeof input.title === 'string') {
        const paragraphs: string[] = [];
        for (let i = 1; i <= expectedCount; i++) {
          const v = input[`paragraph_${i}`];
          if (typeof v !== 'string') break;
          paragraphs.push(v);
        }
        if (paragraphs.length === expectedCount) {
          return { title: input.title, paragraphs };
        }
        // Back-compat: accept the older array-of-strings shape too, in case
        // any caller still configures it that way.
        const arr = coerceParagraphsArray(input.paragraphs);
        if (arr && arr.length === expectedCount) return { title: input.title, paragraphs: arr };
      }
      if (stopReason === 'max_tokens') {
        throw new Error('translation: response truncated at max_tokens before tool call completed');
      }
      const got = input ? Object.keys(input).join(',') : 'null';
      throw new Error(`translation: tool input missing required fields (stop=${stopReason}, keys=${got})`);
    }
  }
  // Defensive fallback — should not happen with tool_choice forced.
  for (const block of res.content) {
    if (block.type === 'text') return __parseTranslation(block.text);
  }
  throw new Error(`translation: Claude returned neither a tool call nor text (stop=${stopReason})`);
}

function coerceParagraphsArray(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.map((p) => String(p));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((p) => String(p));
      } catch { /* fall through */ }
    }
  }
  return null;
}

// --- Image quality control (vision) -----------------------------------------
// flux/schnell occasionally produces anatomically broken illustrations (extra
// limbs, two heads, a head with no body, mangled hands, stray extra people).
// checkImageQuality runs a cheap vision pass to catch the clear cases so the
// build loop can regenerate them with a different seed.

const DEFAULT_QC_MODEL = 'claude-haiku-4-5';

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

type QcMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
function normalizeMediaType(ct: string): QcMediaType {
  const c = ct.toLowerCase();
  if (c.includes('png')) return 'image/png';
  if (c.includes('gif')) return 'image/gif';
  if (c.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

export interface ImageQcVerdict {
  ok: boolean;
  problems: string[];
}

// Exported for tests. Normalises the report_image tool input. Errs toward
// "acceptable": a vague/empty verdict should never reject a usable image.
export function __coerceQcVerdict(input: unknown): ImageQcVerdict {
  if (!input || typeof input !== 'object') return { ok: true, problems: [] };
  const obj = input as Record<string, unknown>;
  const problems = Array.isArray(obj.problems)
    ? obj.problems.map((p) => String(p)).filter((p) => p.trim().length > 0)
    : [];
  // Reject only when the model both says not-ok AND names a concrete problem.
  const flaggedOk = typeof obj.ok === 'boolean' ? obj.ok : problems.length === 0;
  return { ok: flaggedOk || problems.length === 0, problems };
}

export async function checkImageQuality(
  env: Env,
  opts: { image: ArrayBuffer; contentType: string; characters: string; scene: string },
): Promise<ImageQcVerdict> {
  const apiKey = requireEnv(env, 'ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });
  const model = env.IMAGE_QC_MODEL || DEFAULT_QC_MODEL;
  const charLine = opts.characters.trim() ? `Expected characters: ${opts.characters.trim()}\n` : '';

  let res: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    // Telemetry kind 'moderation' (closest existing bucket); cost kind 'image_qc'.
    res = await recordCall(env, 'anthropic', 'moderation', () => client.messages.create({
      model,
      max_tokens: 300,
      system:
        "You inspect AI-generated children's book illustrations for clear anatomical or composition defects. " +
        'Flag ONLY obvious, unmistakable problems: a character with extra or missing limbs, more than one head, ' +
        'a head with no body, fused or melted faces, badly mangled or extra hands and fingers, or extra people ' +
        'who do not belong in the scene. Do NOT flag art style, coloring, cropping, background detail, or minor ' +
        'imperfections. When unsure, treat the image as acceptable. Always call the report_image tool.',
      tools: [
        {
          name: 'report_image',
          description: 'Report whether the illustration is free of anatomical and composition defects.',
          input_schema: {
            type: 'object',
            properties: {
              ok: { type: 'boolean', description: 'true if the image has no clear defect.' },
              problems: {
                type: 'array',
                items: { type: 'string' },
                description: 'Short list of any clear defects found. Empty when the image is fine.',
              },
            },
            required: ['ok', 'problems'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'report_image' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: normalizeMediaType(opts.contentType),
                data: arrayBufferToBase64(opts.image),
              },
            },
            { type: 'text', text: `${charLine}Scene: ${opts.scene.trim()}\n\nInspect the illustration and call report_image.` },
          ],
        },
      ],
    }));
  } catch (e) {
    // QC must never break the build. On any error, accept the image.
    await notifyAdminFailure(env, 'anthropic', 'network_error', `image_qc: ${(e as Error).message}`);
    return { ok: true, problems: [] };
  }
  void recordAnthropicUsage(env, 'image_qc', model, res.usage);
  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') return { ok: true, problems: [] };
  return __coerceQcVerdict(block.input);
}
