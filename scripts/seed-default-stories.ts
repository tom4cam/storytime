// Seeds the two default stories. Run once with `.env` plus
// NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN in the environment:
//
//   npm run seed:stories
//
// Both stories are idempotent: they use fixed ids and overwrite on
// re-run.

import Anthropic from '@anthropic-ai/sdk';
import { buildAndSaveVersion } from '../netlify/functions/_lib/build';
import { regenerateImagePrompt } from '../netlify/functions/_lib/anthropic';
import { generateImage } from '../netlify/functions/_lib/fal';
import { storeMedia } from '../netlify/functions/_lib/storage';
import { BOB_TITLE, BOB_STANZAS } from './data/bob-source';
import { PIP_TITLE_EN, PIP_PARAGRAPHS_EN } from './data/pip-source';

const FAL_CONCURRENCY = 6; // Fal free tier caps at 10 concurrent

// Generate images in capped batches to respect Fal's concurrency limit.
async function generateImagesBatched(
  storyId: string,
  version: number,
  prompts: string[]
): Promise<string[]> {
  const urls: string[] = new Array(prompts.length);
  for (let start = 0; start < prompts.length; start += FAL_CONCURRENCY) {
    const slice = prompts.slice(start, start + FAL_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (prompt, j) => {
        const idx = start + j;
        console.log(`  image ${idx + 1}/${prompts.length}...`);
        const img = await generateImage(prompt);
        const url = await storeMedia(`${storyId}-v${version}-p${idx + 1}.png`, img.data, img.contentType);
        return { idx, url };
      })
    );
    for (const { idx, url } of results) urls[idx] = url;
  }
  return urls;
}

const BOB_ID = 'default-bobs-butter';
const PIP_ID = 'default-pip-bread';

const DANIEL_VOICE = 'onwK4e9ZLuTAKqWW03F9'; // English male
const SANNA_VOICE = '21m00Tcm4TlvDq8ikWAM';  // Placeholder for Swedish female; swap when you have a native voice

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

interface TranslatedPip { title: string; paragraphs: string[] }

async function translatePipToSwedish(): Promise<TranslatedPip> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
  const client = new Anthropic({ apiKey });
  const englishBody = PIP_PARAGRAPHS_EN.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    system:
      'Translate the given children\'s story into warm, simple Swedish suitable for ages 3-6. Keep proper names (Pip, Marta) unchanged. Return strict JSON with this shape: {"title": "...", "paragraphs": ["...", "...", ...]}. No prose outside JSON, no code fences.',
    messages: [
      {
        role: 'user',
        content: `Title: ${PIP_TITLE_EN}\n\n${englishBody}\n\nReturn JSON.`,
      },
    ],
  });
  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Claude returned no text for translation');
  const raw = block.text.trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as TranslatedPip;
  if (!parsed.title || !Array.isArray(parsed.paragraphs) || parsed.paragraphs.length !== PIP_PARAGRAPHS_EN.length) {
    throw new Error(`Translation shape unexpected: ${raw.slice(0, 200)}`);
  }
  return parsed;
}

async function seedBob() {
  console.log('Seeding Bob...');
  console.log('  generating image prompts...');
  const promptedParas = await Promise.all(
    BOB_STANZAS.map(async (text) => ({
      text,
      image_prompt: await regenerateImagePrompt(text, BOB_TITLE),
    }))
  );
  console.log('  generating images (batched)...');
  const urls = await generateImagesBatched(BOB_ID, 1, promptedParas.map((p) => p.image_prompt));
  const paragraphs = promptedParas.map((p, i) => ({
    text: p.text,
    image_prompt: p.image_prompt,
    image_url: urls[i],
  }));
  const v = await buildAndSaveVersion({
    id: BOB_ID,
    version: 1,
    title: BOB_TITLE,
    sourceAnswers: [{ question: 'Default story', answer: BOB_TITLE }],
    language: 'en',
    voiceId: DANIEL_VOICE,
    paragraphs,
  });
  console.log(`Bob seeded: ${v.id} v${v.version}, ${v.paragraphs.length} paragraphs`);
}

async function seedPipSwedish() {
  console.log('Seeding Pip (sv)...');
  const sv = await translatePipToSwedish();
  console.log('  generating images (batched)...');
  const urls = await generateImagesBatched(PIP_ID, 1, PIP_PARAGRAPHS_EN.map((p) => p.image_prompt));
  const paragraphs = PIP_PARAGRAPHS_EN.map((p, i) => ({
    text: sv.paragraphs[i],
    image_prompt: p.image_prompt,
    image_url: urls[i],
  }));
  const v = await buildAndSaveVersion({
    id: PIP_ID,
    version: 1,
    title: sv.title,
    sourceAnswers: [{ question: 'Default story', answer: PIP_TITLE_EN }],
    language: 'sv',
    voiceId: SANNA_VOICE,
    paragraphs,
  });
  console.log(`Pip-sv seeded: ${v.id} v${v.version}, ${v.paragraphs.length} paragraphs`);
}

async function main() {
  const required = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FAL_KEY', 'ELEVENLABS_API_KEY', 'NETLIFY_SITE_ID', 'NETLIFY_AUTH_TOKEN'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error('Missing env vars:', missing.join(', '));
    process.exit(1);
  }
  await seedBob();
  await seedPipSwedish();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
