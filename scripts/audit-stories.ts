// Read-only health check across every story in R2. For each story's latest
// version it verifies: status is "ready", it has paragraphs, every paragraph
// has an image whose file exists in the MEDIA bucket, and the narration file
// exists. Also flags index/version mismatches and group siblings that point at
// missing media. Prints a report; changes nothing.
//
//   npx tsx --env-file-if-exists=.env scripts/audit-stories.ts

import { getScriptEnv } from './lib/script-env';
import { getStoryVersion } from '../functions/api/_lib/storage';
import type { StoryIndex, StoryVersion } from '../functions/api/_lib/types';

const env = getScriptEnv();

function keyFromUrl(u: string | null | undefined): string | null {
  const m = /[?&]key=([^&]+)/.exec(u || '');
  return m ? decodeURIComponent(m[1]) : null;
}

async function main() {
  // All story indexes.
  const all = await env.STORIES.list({ limit: 1000 });
  const idxKeys = all.objects.map((o) => o.key).filter((k) => k.endsWith('/index.json'));
  const indexes: StoryIndex[] = [];
  for (const k of idxKeys) {
    const b = await env.STORIES.get(k);
    if (!b) continue;
    try { indexes.push((await b.json()) as StoryIndex); } catch { /* skip */ }
  }

  // Build the set of existing media keys by listing per story-id prefix (each
  // page stays well under the 1000-object list cap). Translations reuse the
  // source story's `{sourceId}-` image keys; the source may have been deleted
  // (no index) while its media survives under the group_id prefix, so list
  // every distinct group_id prefix too.
  const prefixes = new Set<string>();
  for (const idx of indexes) {
    prefixes.add(idx.id);
    if (idx.group_id) prefixes.add(idx.group_id);
  }
  const mediaKeys = new Set<string>();
  for (const prefix of prefixes) {
    const lst = await env.MEDIA.list({ prefix: `${prefix}-`, limit: 1000 });
    lst.objects.forEach((o) => mediaKeys.add(o.key));
  }

  const problems: Array<{ label: string; issues: string[] }> = [];
  let healthy = 0;

  for (const idx of indexes) {
    const label = `"${idx.title}" (${idx.language}, ${idx.id})`;
    let v: StoryVersion | null = null;
    try { v = await getStoryVersion(env, idx.id); } catch { /* handled below */ }
    const issues: string[] = [];

    if (!v) {
      problems.push({ label, issues: ['latest version blob missing / unreadable'] });
      continue;
    }
    if (v.status !== 'ready') issues.push(`status=${v.status}`);
    if (idx.latest_version !== v.version) issues.push(`index.latest_version=${idx.latest_version} but latest blob is v${v.version}`);
    const paras = v.paragraphs ?? [];
    if (paras.length === 0) issues.push('0 paragraphs');

    let noUrl = 0; let missingImg = 0;
    for (const p of paras) {
      if (!p.image_url) { noUrl += 1; continue; }
      const k = keyFromUrl(p.image_url);
      if (!k || !mediaKeys.has(k)) missingImg += 1;
    }
    if (noUrl) issues.push(`${noUrl}/${paras.length} paragraphs missing image_url`);
    if (missingImg) issues.push(`${missingImg}/${paras.length} images not found in MEDIA`);

    if (!v.narration_url) issues.push('no narration_url');
    else {
      const nk = keyFromUrl(v.narration_url);
      if (!nk || !mediaKeys.has(nk)) issues.push('narration file not found in MEDIA');
    }

    if (issues.length) problems.push({ label, issues });
    else healthy += 1;
  }

  console.log(`\nChecked ${indexes.length} stories. ${mediaKeys.size} media objects seen.`);
  console.log(`✅ healthy: ${healthy}   ❌ with issues: ${problems.length}\n`);
  for (const p of problems) console.log(`  ❌ ${p.label}\n       ${p.issues.join('\n       ')}`);
  if (!problems.length) console.log('All stories healthy.');
}

main().catch((e) => { console.error(e); process.exit(1); });
