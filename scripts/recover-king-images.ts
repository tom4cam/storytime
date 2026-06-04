// One-shot: re-create the broken paragraph images for the King story.
// The English original (id=882644d6-...) was hard-deleted; its
// translations survive but their image_url's still point at the
// original media keys. We regenerate via FAL from the image_prompt
// fields preserved in any surviving translation and write the bytes
// back under the original keys so every translation sees them.
//
//   npx tsx --env-file-if-exists=.env scripts/recover-king-images.ts

import { generateImage } from '../functions/api/_lib/fal';
import { storeMedia } from '../functions/api/_lib/storage';
import { getScriptEnv } from './lib/script-env';

const SOURCE_TRANSLATION_ID = 'd6f6d5e1-e06f-4803-b764-91e0e7b1ac3b';
const ORIGINAL_STORY_ID = '882644d6-90b6-474a-a22b-32b0d04b5dc6';
const ORIGINAL_VERSION = 1;

const env = getScriptEnv();

async function main() {
  const obj = await env.STORIES.get(`${SOURCE_TRANSLATION_ID}/v1.json`);
  if (!obj) throw new Error(`source translation ${SOURCE_TRANSLATION_ID}/v1.json not found`);
  const story = (await obj.json()) as {
    paragraphs: Array<{ image_prompt?: string; image_url?: string | null }>;
  };
  if (!story.paragraphs?.length) throw new Error('no paragraphs');

  console.log(`Found ${story.paragraphs.length} paragraphs in source translation`);

  for (let i = 0; i < story.paragraphs.length; i += 1) {
    const p = story.paragraphs[i];
    const prompt = p.image_prompt?.trim();
    if (!prompt) {
      console.warn(`  p${i + 1}: no image_prompt; skipping`);
      continue;
    }
    const key = `${ORIGINAL_STORY_ID}-v${ORIGINAL_VERSION}-p${i + 1}.png`;
    console.log(`  p${i + 1}: generating → ${key}`);
    const img = await generateImage(env, prompt);
    await storeMedia(env, key, img.data, img.contentType);
    console.log(`  p${i + 1}: ✓ saved (${img.data.byteLength} bytes)`);
  }

  console.log('Done. All four surviving translations now resolve their images.');
}

main().catch((e) => { console.error(e); process.exit(1); });
