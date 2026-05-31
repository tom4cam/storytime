// Stamp every story's latest version with a given creator_id and
// listed:true, so the holder of that creator_id cookie can edit and
// delete any of them through the UI. Overwrites existing ownership
// (including `creator_id: 'system'` on seeded defaults), so use with
// intent — afterward the defaults are deletable like any user story.
//
//   npm run take-ownership -- <creator-id>
//
// Idempotent: re-running for the same creator_id reports skips.

import { getStoryVersion, saveStoryVersion } from '../functions/api/_lib/storage';
import { getScriptEnv } from './lib/script-env';

async function main() {
  const creatorId = process.argv[2];
  if (!creatorId) {
    console.error('usage: npm run take-ownership -- <creator-id>');
    process.exit(1);
  }

  const env = getScriptEnv();
  const listed = await env.STORIES.list({ limit: 1000 });
  const indexKeys = listed.objects.filter((o) => o.key.endsWith('/index.json'));
  if (listed.objects.length >= 1000) {
    console.warn('WARNING: hit the 1000-key list cap. Some stories may not have been processed.');
  }

  let updated = 0;
  for (const obj of indexKeys) {
    const id = obj.key.slice(0, -'/index.json'.length);
    const latest = await getStoryVersion(env, id);
    if (!latest) {
      console.warn(`[skip] ${id}: no latest version JSON`);
      continue;
    }
    if (latest.creator_id === creatorId && latest.listed === true) {
      console.log(`[skip] ${id}: already owned`);
      continue;
    }
    const next = { ...latest, creator_id: creatorId, listed: true };
    await saveStoryVersion(env, next);
    console.log(`[ok]   ${id}: was ${latest.creator_id ?? 'null'} -> owned`);
    updated += 1;
  }
  console.log(`Done. ${updated}/${indexKeys.length} story/stories updated.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
