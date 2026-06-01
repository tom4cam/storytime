// One-shot: ensure every {id}/index.json carries the `language` field
// from its latest version. Idempotent.
//
//   npm run backfill:index-language

import { getStoryVersion, saveStoryVersion } from '../functions/api/_lib/storage';
import { getScriptEnv } from './lib/script-env';

async function main() {
  const env = getScriptEnv();
  const listed = await env.STORIES.list({ limit: 1000 });
  const indexKeys = listed.objects.filter((o) => o.key.endsWith('/index.json'));
  if (listed.objects.length >= 1000) {
    console.warn('WARNING: hit the 1000-key list cap.');
  }

  let updated = 0;
  for (const obj of indexKeys) {
    const id = obj.key.slice(0, -'/index.json'.length);
    const blob = await env.STORIES.get(obj.key);
    if (!blob) continue;
    const idxJson = await blob.json() as { language?: string };
    if (idxJson.language) {
      console.log(`[skip] ${id}: already has language=${idxJson.language}`);
      continue;
    }
    const latest = await getStoryVersion(env, id);
    if (!latest) {
      console.warn(`[skip] ${id}: no latest version JSON`);
      continue;
    }
    // saveStoryVersion rewrites both v{n}.json and index.json, picking
    // language up from version.language.
    await saveStoryVersion(env, latest);
    console.log(`[ok]   ${id}: stamped language=${latest.language}`);
    updated += 1;
  }
  console.log(`Done. ${updated}/${indexKeys.length} indexes updated.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
