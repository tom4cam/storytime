// One-shot: FORCE-DELETE the entire "Big Blue Tooth Bus" — all versions AND all
// translation siblings in its group, plus every image and narration file.
//
// The app's force-delete (deleteStory -> deleteStoryAndMedia) only removes the
// single id it's given; it does NOT cascade to translations sharing a group_id.
// This does the cascade: it resolves the group, then runs the same full-delete
// primitive on each member.
//
//   npx tsx --env-file-if-exists=.env scripts/delete-bus.ts            # dry run (lists scope)
//   npx tsx --env-file-if-exists=.env scripts/delete-bus.ts --commit   # actually delete (irreversible)

import { deleteStoryAndMedia } from '../functions/api/_lib/storage';
import type { StoryIndex } from '../functions/api/_lib/types';
import { getScriptEnv } from './lib/script-env';

const BUS_ID = '875465f3-4d83-4c36-98cd-0f4cd530d642';
const COMMIT = process.argv.includes('--commit');
const env = getScriptEnv();

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

async function countScope(id: string): Promise<{ story: number; media: number }> {
  const s = await env.STORIES.list({ prefix: `${id}/`, limit: 1000 });
  const m = await env.MEDIA.list({ prefix: `${id}-`, limit: 1000 });
  return { story: s.objects.length, media: m.objects.length };
}

async function main() {
  const indexes = await allIndexes();
  const bus = indexes.find((i) => i.id === BUS_ID);
  const group = bus?.group_id ?? BUS_ID;
  const members = indexes.filter((i) => i.id === BUS_ID || i.group_id === group);

  if (members.length === 0) {
    console.log('No stories found for the Big Blue Tooth Bus group — nothing to delete.');
    return;
  }

  console.log(`Group ${group}: ${members.length} stor${members.length === 1 ? 'y' : 'ies'} to delete\n`);
  let totalStory = 0, totalMedia = 0;
  for (const idx of members) {
    if (!COMMIT) {
      const c = await countScope(idx.id);
      totalStory += c.story; totalMedia += c.media;
      console.log(`  ${idx.id} (${idx.language}) "${idx.title}": ${c.story} story objects, ${c.media} media files`);
    } else {
      const c = await deleteStoryAndMedia(env, idx.id);
      totalStory += c.story; totalMedia += c.media;
      console.log(`  DELETED ${idx.id} (${idx.language}) "${idx.title}": ${c.story} story objects, ${c.media} media files`);
    }
  }

  console.log(`\nTotal: ${totalStory} story objects, ${totalMedia} media files across ${members.length} stories.`);
  if (!COMMIT) console.log('DRY RUN — re-run with --commit to permanently delete.');
  else console.log('Done. The Big Blue Tooth Bus is fully gone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
