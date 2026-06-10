// One-shot: rewrite a story's image_url's to include the new ?v=<hash>
// cache-buster. Use after an owner regen that landed in R2 but is
// invisible to viewers because the URL was unchanged and /api/media's
// immutable Cache-Control pinned them to the previous bytes.
//
//   npx tsx --env-file-if-exists=.env scripts/recache-story-images.ts <story-id> [version]
//
// Example:
//   npx tsx --env-file-if-exists=.env scripts/recache-story-images.ts 1889442e-aa1a-458a-8a15-3d1a2c8c5d42

import { createHash } from 'node:crypto';
import { getStoryIndex, getStoryVersion, saveStoryVersion } from '../functions/api/_lib/storage';
import { getScriptEnv } from './lib/script-env';

const id = process.argv[2];
const versionArg = process.argv[3];
if (!id) {
  console.error('usage: recache-story-images.ts <story-id> [version]');
  process.exit(1);
}

const env = getScriptEnv();

function extractKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?&]key=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function buildUrl(key: string, tag: string): string {
  return `/api/media?key=${encodeURIComponent(key)}&v=${tag}`;
}

async function main() {
  const idx = await getStoryIndex(env, id);
  if (!idx) throw new Error(`story ${id} not found`);

  const version = versionArg ? parseInt(versionArg, 10) : idx.latest_version;
  const v = await getStoryVersion(env, id, version);
  if (!v) throw new Error(`${id}/v${version} not found`);

  console.log(`Story: "${v.title}" v${version}, ${v.paragraphs.length} paragraphs`);

  let changed = 0;
  const next = { ...v, paragraphs: await Promise.all(v.paragraphs.map(async (p, i) => {
    const key = extractKey(p.image_url);
    if (!key) {
      console.log(`  p${i + 1}: no image_url; skipping`);
      return p;
    }
    if (p.image_url?.includes('&v=')) {
      console.log(`  p${i + 1}: already cache-busted; skipping`);
      return p;
    }
    const obj = await env.MEDIA.get(key);
    if (!obj) {
      console.warn(`  p${i + 1}: R2 key ${key} missing; skipping`);
      return p;
    }
    const bytes = new Uint8Array(await obj.arrayBuffer());
    const tag = createHash('md5').update(bytes).digest('hex').slice(0, 8);
    const newUrl = buildUrl(key, tag);
    console.log(`  p${i + 1}: ${bytes.byteLength} B  →  ?v=${tag}`);
    changed += 1;
    return { ...p, image_url: newUrl };
  })) };

  if (changed === 0) {
    console.log('Nothing to change.');
    return;
  }
  await saveStoryVersion(env, next);
  console.log(`Saved. ${changed} image url(s) re-cached.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
