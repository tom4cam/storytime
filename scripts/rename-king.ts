// One-shot: retitle the recovered English King story without
// re-running TTS or image generation.
//
//   npx tsx --env-file-if-exists=.env scripts/rename-king.ts

import { getStoryVersion, saveStoryVersion } from '../functions/api/_lib/storage';
import { getScriptEnv } from './lib/script-env';

const ID = '8712a824-3040-4b4e-81ad-43a2f37bdf94';
const NEW_TITLE = 'The King Who Drove to the Future';

const env = getScriptEnv();

async function main() {
  const v = await getStoryVersion(env, ID, 1);
  if (!v) throw new Error(`${ID}/v1 not found`);
  if (v.title === NEW_TITLE) {
    console.log('Already named correctly; no-op.');
    return;
  }
  console.log(`"${v.title}" → "${NEW_TITLE}"`);
  await saveStoryVersion(env, { ...v, title: NEW_TITLE });
  console.log('Saved.');
}

main().catch((e) => { console.error(e); process.exit(1); });
