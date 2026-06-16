// One-shot: collapse the Sarah story to a single, repaired version.
//
// Every version references the original `-v1-` images for paragraphs that were
// never re-generated, but those files were deleted from R2 long ago, so 5 of 7
// images 404. This keeps v5's text + narration, copies the 2 surviving images
// (p4, p5) and regenerates the 5 missing ones from their saved prompts, writes
// the result as the sole v1 (index.latest_version = 1), and deletes versions
// 2-5 plus every now-orphaned media object.
//
//   npx tsx --env-file-if-exists=.env scripts/fix-sarah-story.ts            # dry run
//   npx tsx --env-file-if-exists=.env scripts/fix-sarah-story.ts --commit   # apply

import { getScriptEnv } from './lib/script-env';
import { getStoryVersion, saveStoryVersion, storeMedia } from '../functions/api/_lib/storage';
import { generateImage } from '../functions/api/_lib/fal';
import type { StoryVersion } from '../functions/api/_lib/types';

const ID = '626cda9c-e994-4340-b51b-d41183e9adab';
const KEEP = 5;
const COMMIT = process.argv.includes('--commit');
const env = getScriptEnv();

function keyFromUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try { return new URL(u, 'http://x').searchParams.get('key'); }
  catch { return null; }
}

function ctypeFor(key: string): string {
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

async function copyMedia(srcKey: string, dstKey: string): Promise<string> {
  const obj = await env.MEDIA.get(srcKey);
  if (!obj) throw new Error(`media not found: ${srcKey}`);
  const bytes = await obj.arrayBuffer();
  const ct = obj.httpMetadata?.contentType ?? ctypeFor(dstKey);
  return storeMedia(env, dstKey, bytes, ct);
}

async function main() {
  const v5 = await getStoryVersion(env, ID, KEEP);
  if (!v5) throw new Error(`${ID}/v${KEEP} not found`);
  console.log(`Source: v${KEEP} "${v5.title}", ${v5.paragraphs.length} paragraphs\n`);

  // Plan each paragraph: copy the existing image, or regenerate if it's gone.
  type Plan = { idx: number; dstKey: string; srcKey: string | null; action: 'copy' | 'regen'; prompt?: string };
  const plan: Plan[] = [];
  for (let i = 0; i < v5.paragraphs.length; i++) {
    const p = v5.paragraphs[i];
    const srcKey = keyFromUrl(p.image_url);
    const dstKey = `${ID}-v1-p${i + 1}.png`;
    const exists = srcKey ? !!(await env.MEDIA.get(srcKey)) : false;
    plan.push({ idx: i, dstKey, srcKey, action: exists ? 'copy' : 'regen', prompt: p.image_prompt });
    console.log(`  p${i + 1}: ${exists ? `COPY  ${srcKey}` : `REGEN (prompt ${(p.image_prompt || '').length} chars)`} -> ${dstKey}`);
  }

  const narrSrc = keyFromUrl(v5.narration_url);
  const narrDst = `${ID}-v1.mp3`;
  console.log(`  narration: COPY ${narrSrc} -> ${narrDst}`);

  // What survives, what gets deleted.
  const keepMedia = new Set<string>([narrDst]);
  for (let i = 0; i < v5.paragraphs.length; i++) keepMedia.add(`${ID}-v1-p${i + 1}.png`);
  const allMedia = (await env.MEDIA.list({ prefix: `${ID}-`, limit: 1000 })).objects.map((o) => o.key);
  const mediaToDelete = allMedia.filter((k) => !keepMedia.has(k));
  const allStories = (await env.STORIES.list({ prefix: `${ID}/`, limit: 1000 })).objects.map((o) => o.key);
  const storiesToDelete = allStories.filter((k) => /\/v\d+\.json$/.test(k) && k !== `${ID}/v1.json`);

  console.log(`\nWill regenerate ${plan.filter((p) => p.action === 'regen').length} image(s), copy ${plan.filter((p) => p.action === 'copy').length} + narration.`);
  console.log(`Delete media (${mediaToDelete.length}): ${mediaToDelete.sort().join(', ')}`);
  console.log(`Delete version blobs (${storiesToDelete.length}): ${storiesToDelete.sort().join(', ')}`);

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to apply.');
    return;
  }

  // Build the new v1 media + paragraphs.
  const newParagraphs = [];
  for (const item of plan) {
    let url: string;
    if (item.action === 'copy') {
      url = await copyMedia(item.srcKey as string, item.dstKey);
      console.log(`  copied p${item.idx + 1}`);
    } else {
      if (!item.prompt || !item.prompt.trim()) throw new Error(`p${item.idx + 1}: missing image and no prompt`);
      const img = await generateImage(env, item.prompt.trim());
      url = await storeMedia(env, item.dstKey, img.data, img.contentType);
      console.log(`  regenerated p${item.idx + 1}`);
    }
    newParagraphs.push({ ...v5.paragraphs[item.idx], image_url: url });
  }

  const narrationUrl = narrSrc ? await copyMedia(narrSrc, narrDst) : v5.narration_url;
  console.log('  copied narration');

  const v1: StoryVersion = { ...v5, version: 1, paragraphs: newParagraphs, narration_url: narrationUrl };
  await saveStoryVersion(env, v1);
  console.log('\nWrote v1.json + index.json (latest_version=1).');

  for (const k of storiesToDelete) { await env.STORIES.delete(k); console.log('  del', k); }
  for (const k of mediaToDelete) { await env.MEDIA.delete(k); console.log('  del', k); }

  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
