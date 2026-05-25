// One-off recovery: revert a story to a specific version by re-pointing
// its index and deleting later version blobs in R2.
//
// Required env: the same R2_* credentials as seed:stories (see
// .env.example).
//
//   npm run revert -- <storyId> <targetVersion>
//
// Example: npm run revert -- default-bobs-butter 1

import { getStoryVersion, saveStoryVersion } from '../functions/api/_lib/storage';
import { getScriptEnv } from './lib/script-env';

async function main() {
  const id = process.argv[2];
  const targetStr = process.argv[3];
  if (!id || !targetStr) {
    console.error('usage: tsx scripts/revert-story.ts <storyId> <targetVersion>');
    process.exit(1);
  }
  const target = parseInt(targetStr, 10);
  if (!Number.isFinite(target) || target < 1) {
    console.error('targetVersion must be a positive integer');
    process.exit(1);
  }

  const env = getScriptEnv();
  const v = await getStoryVersion(env, id, target);
  if (!v) {
    console.error(`Version ${target} of "${id}" not found in R2.`);
    process.exit(1);
  }
  await saveStoryVersion(env, v); // overwrites index.json so latest_version=target

  // Delete any later versions.
  let n = target + 1;
  while (true) {
    const key = `${id}/v${n}.json`;
    const exists = await env.STORIES.get(key);
    if (!exists) break;
    await env.STORIES.delete(key);
    console.log(`  deleted ${key}`);
    n += 1;
  }
  console.log(`Reverted "${id}" to v${target}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
