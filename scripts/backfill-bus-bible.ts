// One-shot: back-fill a character_bible onto "The Big Blue Tooth Bus" (and any
// translation siblings in its group). The bus was rebuilt on the new pipeline
// but predates the character_bible anchor, so future edits have nothing keeping
// Michael / Mindy / the bus visually consistent. This patches the bible onto
// each story's CURRENT version in place — it does NOT regenerate images or
// narration and does NOT bump the version. saveStoryVersion rewrites the
// version JSON and re-derives the index (preserving created_at).
//
// The bible is a purely visual description (used only for image prompts), so
// the same English text applies to every language in the group.
//
//   npx tsx --env-file-if-exists=.env scripts/backfill-bus-bible.ts            # dry run
//   npx tsx --env-file-if-exists=.env scripts/backfill-bus-bible.ts --commit   # write (free: no images/TTS)

import { getStoryVersion, saveStoryVersion } from '../functions/api/_lib/storage';
import type { StoryIndex } from '../functions/api/_lib/types';
import { getScriptEnv } from './lib/script-env';

const BUS_ID = '875465f3-4d83-4c36-98cd-0f4cd530d642';
const COMMIT = process.argv.includes('--commit');
const env = getScriptEnv();

const BUS_BIBLE =
  "Michael is a cheerful adult man with dark brown wavy hair and a warm, playful grin (he is the joke-teller), wearing tidy light-blue dental scrubs. " +
  "Mindy is his kind adult wife, tall, with bright golden blond hair, a friendly smile, wearing matching light-blue dental scrubs; she is a dental hygienist. " +
  "The Big Blue Tooth Bus is a large bus painted sky-blue with a big friendly white tooth painted on its side, stocked inside with dental tools (polishers, flossers, shiny spools). " +
  "Michael and Mindy are a married couple. They all have friendly cartoon faces. Each scene contains just Michael and Mindy unless a stanza explicitly mentions other people (like the older folks they visit).";

async function allIndexes(): Promise<StoryIndex[]> {
  const result = await env.STORIES.list({ limit: 1000 });
  const keys = result.objects.filter((o) => o.key.endsWith('/index.json'));
  const items = await Promise.all(
    keys.map(async (o) => {
      const blob = await env.STORIES.get(o.key);
      if (!blob) return null;
      try { return (await blob.json()) as StoryIndex; } catch { return null; }
    })
  );
  return items.filter((x): x is StoryIndex => !!x);
}

async function main() {
  // Find the bus + every story sharing its group_id (its translations).
  const indexes = await allIndexes();
  const bus = indexes.find((i) => i.id === BUS_ID);
  const group = bus?.group_id ?? BUS_ID;
  const members = indexes.filter((i) => i.id === BUS_ID || i.group_id === group);

  console.log(`Group ${group}: ${members.length} stor${members.length === 1 ? 'y' : 'ies'}`);
  console.log(`Bible:\n  ${BUS_BIBLE}\n`);

  for (const idx of members) {
    const v = await getStoryVersion(env, idx.id); // latest version
    if (!v) { console.log(`  ${idx.id} (${idx.language}): no version found, skipping`); continue; }
    if (v.character_bible && v.character_bible.trim()) {
      console.log(`  ${idx.id} (${idx.language}) v${v.version}: already has a bible, skipping`);
      continue;
    }
    if (!COMMIT) {
      console.log(`  ${idx.id} (${idx.language}) v${v.version}: WOULD set bible`);
      continue;
    }
    await saveStoryVersion(env, { ...v, character_bible: BUS_BIBLE });
    console.log(`  ${idx.id} (${idx.language}) v${v.version}: bible set`);
  }

  if (!COMMIT) console.log('\nDRY RUN — re-run with --commit to write.');
  else console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
