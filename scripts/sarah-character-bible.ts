// One-shot: give the Sarah story a character bible and regenerate its images
// with that bible injected, so Sarah looks the same in every picture. Keeps the
// existing text and narration (no re-TTS, so the voice is unchanged).
//
//   npx tsx --env-file-if-exists=.env scripts/sarah-character-bible.ts            # dry run (bible only)
//   npx tsx --env-file-if-exists=.env scripts/sarah-character-bible.ts --commit   # regenerate images

import { getScriptEnv } from './lib/script-env';
import { getStoryVersion, saveStoryVersion, storeMedia } from '../functions/api/_lib/storage';
import { generateCharacterBible } from '../functions/api/_lib/anthropic';
import { generateImage } from '../functions/api/_lib/fal';
import type { StoryVersion } from '../functions/api/_lib/types';

const ID = '626cda9c-e994-4340-b51b-d41183e9adab';
const COMMIT = process.argv.includes('--commit');
const env = getScriptEnv();

// Mirror buildAndSaveVersion's prompt construction so the regenerated images
// match what the live app would produce for a bible-backed story.
function buildPrompt(bible: string, summary: string | undefined, scene: string): string {
  const anchor = [bible.trim(), summary?.trim()].filter(Boolean).join(' ');
  return anchor
    ? `Cartoon illustration. Characters: ${anchor} Scene: ${scene} Style: bright colors, friendly faces, cartoon style, no text in the image.`
    : scene;
}

async function main() {
  const v = await getStoryVersion(env, ID); // current latest version
  if (!v) throw new Error('Sarah story not found');
  const version = v.version;
  console.log(`Story: "${v.title}", v${version}, ${v.paragraphs.length} paragraphs`);

  const bible = await generateCharacterBible(env, { title: v.title, paragraphs: v.paragraphs.map((p) => p.text) });
  console.log('\nCharacter bible:\n' + bible + '\n');

  if (!COMMIT) {
    console.log('DRY RUN — bible generated above. Re-run with --commit to regenerate images.');
    return;
  }

  // Regenerate each paragraph image with the bible anchor; keep narration.
  const newParagraphs = await Promise.all(v.paragraphs.map(async (p, i) => {
    const scene = (p.image_prompt && p.image_prompt.trim()) || p.text;
    const prompt = buildPrompt(bible, v.summary, scene);
    const img = await generateImage(env, prompt);
    const url = await storeMedia(env, `${ID}-v${version}-p${i + 1}.png`, img.data, img.contentType);
    console.log(`  regenerated p${i + 1}`);
    return { ...p, image_url: url };
  }));

  const updated: StoryVersion = { ...v, paragraphs: newParagraphs, character_bible: bible };
  await saveStoryVersion(env, updated);
  console.log(`\nSaved v${version} with character bible + regenerated images (narration unchanged).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
