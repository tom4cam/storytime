// Find media files in R2 whose corresponding story-version JSON no
// longer exists, and (optionally) delete them. Useful after a revert
// or version cull leaves behind per-paragraph images / audio with no
// referencing version.
//
//   Dry run:   npm run cleanup:media
//   Delete:    npm run cleanup:media -- --delete
//
// Requires the S3 backend (R2_* env vars); the wrangler-CLI fallback
// in script-env can't list buckets.

import { getScriptEnv } from './lib/script-env';

interface ParsedKey { id: string; version: number; key: string }

// `{id}-v{n}-p{i}.{ext}` and `{id}-v{n}.{ext}`. The id may itself
// contain hyphens, so `.+` is greedy and captures the longest prefix
// up to the LAST `-v\d+` — which is the version marker.
const KEY_RE = /^(.+)-v(\d+)(?:-p\d+)?\.[A-Za-z0-9]+$/;

function parseKey(key: string): ParsedKey | null {
  const m = KEY_RE.exec(key);
  return m ? { id: m[1], version: parseInt(m[2], 10), key } : null;
}

async function main() {
  const dryRun = !process.argv.includes('--delete');
  const env = getScriptEnv();

  console.log('Listing MEDIA bucket...');
  const listed = await env.MEDIA.list({ limit: 1000 });
  console.log(`  ${listed.objects.length} keys`);
  if (listed.objects.length >= 1000) {
    console.warn('WARNING: hit the 1000-key list cap. Re-run after cleanup to catch remaining keys.');
  }

  const parsed: ParsedKey[] = [];
  const unparseable: string[] = [];
  for (const o of listed.objects) {
    const p = parseKey(o.key);
    if (p) parsed.push(p);
    else unparseable.push(o.key);
  }

  // Group by `{id}/v{n}.json` so we do one existence check per version.
  const groups = new Map<string, ParsedKey[]>();
  for (const p of parsed) {
    const versionKey = `${p.id}/v${p.version}.json`;
    const arr = groups.get(versionKey);
    if (arr) arr.push(p);
    else groups.set(versionKey, [p]);
  }

  console.log(`Checking ${groups.size} story-version reference(s) in STORIES...`);
  const orphans: ParsedKey[] = [];
  for (const [versionKey, files] of groups) {
    const exists = await env.STORIES.get(versionKey);
    if (!exists) orphans.push(...files);
  }

  console.log(`\nOrphaned media files: ${orphans.length}`);
  if (unparseable.length) {
    console.log(`Unparseable keys (skipped): ${unparseable.length}`);
    for (const k of unparseable.slice(0, 5)) console.log(`  ${k}`);
    if (unparseable.length > 5) console.log(`  ... and ${unparseable.length - 5} more`);
  }
  if (orphans.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  // Summarize by version for readable output.
  const byVersion = new Map<string, number>();
  for (const o of orphans) {
    const k = `${o.id}/v${o.version}`;
    byVersion.set(k, (byVersion.get(k) ?? 0) + 1);
  }
  for (const [vk, count] of [...byVersion.entries()].sort()) {
    console.log(`  ${vk}: ${count} file(s)`);
  }

  if (dryRun) {
    console.log('\nDry run. Pass --delete to actually remove these files.');
    return;
  }

  console.log('\nDeleting...');
  let deleted = 0;
  for (const o of orphans) {
    await env.MEDIA.delete(o.key);
    deleted += 1;
    if (deleted % 25 === 0) console.log(`  ${deleted}/${orphans.length}`);
  }
  console.log(`Deleted ${deleted} file(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
