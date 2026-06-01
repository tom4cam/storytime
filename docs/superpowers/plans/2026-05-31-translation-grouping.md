# Translation grouping + new languages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group every translation of a story under a single home-page tile rendered in the user's app language, add an inline language switcher on the story page, and expand the supported story-content language set with Macedonian (`mk`), Brazilian Portuguese (`pt-BR`), and European Portuguese (`pt-PT`).

**Architecture:** Add a `group_id` field to `StoryVersion`/`StoryIndex`; `translateStory` stamps it on new translations (`source.group_id ?? source.id`). A new `groupStoryIndexes(indexes, preferredLang)` helper buckets indexes by `group_id` and returns `StoryGroupSummary[]` with a chosen primary + the available languages. The `/api/listStories` and `/api/getStory` endpoints adopt the new shapes. The frontend renders one tile per group with a flag row, and adds a sibling flag row on the story page. Two one-shot backfill scripts stamp `language` on existing indexes and `group_id` on the four legacy Pip stories.

**Tech Stack:** TypeScript (Cloudflare Pages Functions + React/Vite SPA), R2 storage via S3-compatible API, vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-31-translation-grouping-design.md`

---

### Task 1: Expand LANGS with mk, pt-BR, pt-PT

Add the three new story-content languages everywhere `Lang` is keyed. No grouping yet — purely additive language set.

**Files:**
- Modify: `functions/api/_lib/types.ts` (LANGS array)
- Modify: `apps/web/src/types.ts` (LANGS array, mirror)
- Modify: `functions/api/_lib/anthropic.ts` (LANG_NAMES record — must stay exhaustive)
- Modify: `functions/api/_lib/build.ts:178` (stale literal union → `Lang`)
- Modify: `functions/api/translateStory.ts:31` (error message lists valid langs)
- Modify: `apps/web/src/i18n/strings/en.ts` (3 new `create.langStepXx` strings)
- Modify: `apps/web/src/i18n/strings/sv.ts` (3 new strings)
- Modify: any other locale string files under `apps/web/src/i18n/strings/` that already carry `create.langStepXx` (fr.ts at minimum — discover by grep)

- [ ] **Step 1: Discover all locale files with `create.langStep` strings**

Run: `grep -l "create.langStep" apps/web/src/i18n/strings/`
Use the result to determine the full set of files to update in steps below.

- [ ] **Step 2: Expand LANGS in both type files**

Edit `functions/api/_lib/types.ts`:

```ts
export const LANGS = [
  'en', 'sv', 'bg', 'es', 'fr',
  'mk',
  'pt-BR', 'pt-PT',
] as const;
export type Lang = typeof LANGS[number];
```

Edit `apps/web/src/types.ts` to match exactly.

- [ ] **Step 3: Add LANG_NAMES entries**

Edit `functions/api/_lib/anthropic.ts`, find the `LANG_NAMES` Record:

```ts
const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  sv: 'Swedish (svenska)',
  bg: 'Bulgarian',
  es: 'simple, warm Spanish (Latin American)',
  fr: 'simple, warm French (European)',
  mk: 'Macedonian (македонски)',
  'pt-BR': 'Brazilian Portuguese (português do Brasil)',
  'pt-PT': 'European Portuguese (português de Portugal)',
};
```

- [ ] **Step 4: Replace stale literal union in build.ts**

Edit `functions/api/_lib/build.ts` around line 178, change:

```ts
async function safelyGenerate(env: Env, answers: StoryAnswer[], language: 'en' | 'sv' | 'bg' | 'es' | 'fr'): Promise<GeneratedStory> {
```

to:

```ts
async function safelyGenerate(env: Env, answers: StoryAnswer[], language: Lang): Promise<GeneratedStory> {
```

(`Lang` is already imported at the top of the file.)

- [ ] **Step 5: Update translateStory error message**

Edit `functions/api/translateStory.ts` line ~31, change:

```ts
if (!VALID_LANGS.has(target)) return badRequest('target_language must be en, sv, bg, es, or fr');
```

to:

```ts
if (!VALID_LANGS.has(target)) return badRequest(`target_language must be one of: ${LANGS.join(', ')}`);
```

- [ ] **Step 6: Add new langStep strings to each locale file**

For each file discovered in Step 1 (at minimum `en.ts`, `sv.ts`, `fr.ts`), add three keys alongside the existing `create.langStepXx` entries:

```ts
'create.langStepMk': 'Македонски (Macedonian)',
'create.langStepPtBr': 'Português brasileiro (Brazilian Portuguese)',
'create.langStepPtPt': 'Português de Portugal (European Portuguese)',
```

The label text is the same in every locale (we surface the native name plus an English gloss in parens). The order of keys doesn't matter, but keep them grouped with the other `create.langStepXx` entries.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If TS complains about a missing key in any `Record<Lang, ...>`, that's a downstream call site that needs an entry for the new langs — fix it inline before continuing.

- [ ] **Step 8: Commit**

```bash
git add functions/api/_lib/types.ts functions/api/_lib/anthropic.ts \
        functions/api/_lib/build.ts functions/api/translateStory.ts \
        apps/web/src/types.ts apps/web/src/i18n/strings/
git commit -m "Add mk, pt-BR, pt-PT to LANGS"
```

---

### Task 2: Add group_id and language to types + propagate in saveStoryVersion

Define the new fields and wire `saveStoryVersion` to write them to the index. No call site sets them yet, so behavior doesn't change.

**Files:**
- Modify: `functions/api/_lib/types.ts` (StoryVersion, StoryIndex)
- Modify: `apps/web/src/types.ts` (mirror)
- Modify: `functions/api/_lib/storage.ts` (`saveStoryVersion` writes `group_id` + `language` into the index)

- [ ] **Step 1: Add fields to StoryVersion and StoryIndex (functions side)**

Edit `functions/api/_lib/types.ts`:

```ts
export interface StoryVersion {
  // ... existing fields ...
  language: Lang;
  // ... existing fields ...
  group_id?: string;          // NEW — null/undefined = standalone
}

export interface StoryIndex {
  // ... existing fields ...
  status: StoryStatus;
  language: Lang;             // NEW — required going forward
  group_id?: string;          // NEW
  // ... existing fields ...
}
```

`language` on StoryIndex is required so the home-page grouping helper doesn't have to fetch full versions. Task 5 backfills it on legacy index entries.

- [ ] **Step 2: Mirror the changes in apps/web/src/types.ts**

Same edits to the SPA's `types.ts` so the frontend types stay in sync.

- [ ] **Step 3: Propagate fields in saveStoryVersion**

Edit `functions/api/_lib/storage.ts`, inside `saveStoryVersion`, expand the `idx` construction:

```ts
const idx: StoryIndex = {
  id: version.id,
  title: version.title,
  latest_version: version.version,
  cover_image_url: version.paragraphs[0]?.image_url ?? null,
  updated_at: version.created_at,
  created_at: createdAt,
  status: version.status,
  language: version.language,                                          // NEW
  ...(version.creator_id ? { creator_id: version.creator_id } : {}),
  ...(version.listed !== undefined ? { listed: version.listed } : {}),
  ...(version.group_id ? { group_id: version.group_id } : {}),         // NEW
};
```

`language` is unconditional because it's required on the version (already), so it's always defined. `group_id` is optional spread because we don't want to write `group_id: undefined` and clutter the JSON.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: pass. (Legacy index JSON in R2 won't have `language` populated, but TypeScript can't see that at compile time. Task 5 fixes it at runtime.)

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/types.ts apps/web/src/types.ts functions/api/_lib/storage.ts
git commit -m "Add group_id and language fields to StoryVersion/StoryIndex"
```

---

### Task 3: groupStoryIndexes helper with tests

A pure function that takes a flat list of `StoryIndex` and a preferred language, and returns one `StoryGroupSummary` per group.

**Files:**
- Modify: `functions/api/_lib/types.ts` (add `StoryGroupSummary` export)
- Modify: `apps/web/src/types.ts` (mirror)
- Modify: `functions/api/_lib/storage.ts` (export `groupStoryIndexes`)
- Test: `functions/api/_lib/storage.test.ts` (new file)

- [ ] **Step 1: Add StoryGroupSummary to types (both sides)**

Append to `functions/api/_lib/types.ts`:

```ts
export interface StoryGroupSummary {
  group_id: string | null;
  primary: StoryIndex;
  languages: Lang[];
}
```

Mirror in `apps/web/src/types.ts`.

- [ ] **Step 2: Write failing tests for groupStoryIndexes**

Create `functions/api/_lib/storage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupStoryIndexes } from './storage';
import type { StoryIndex } from './types';

function idx(overrides: Partial<StoryIndex> & Pick<StoryIndex, 'id' | 'language'>): StoryIndex {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    latest_version: overrides.latest_version ?? 1,
    cover_image_url: overrides.cover_image_url ?? null,
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    status: overrides.status ?? 'ready',
    language: overrides.language,
    ...(overrides.group_id ? { group_id: overrides.group_id } : {}),
  };
}

describe('groupStoryIndexes', () => {
  it('returns [] for empty input', () => {
    expect(groupStoryIndexes([], 'en')).toEqual([]);
  });

  it('treats a story with no group_id as a group of one', () => {
    const s = idx({ id: 'solo', language: 'en' });
    const result = groupStoryIndexes([s], 'en');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      group_id: null,
      primary: s,
      languages: ['en'],
    });
  });

  it('groups indexes that share a group_id', () => {
    const en = idx({ id: 'pip-en', language: 'en', group_id: 'pip' });
    const sv = idx({ id: 'pip-sv', language: 'sv', group_id: 'pip' });
    const result = groupStoryIndexes([en, sv], 'en');
    expect(result).toHaveLength(1);
    expect(result[0].group_id).toBe('pip');
    expect(result[0].languages.sort()).toEqual(['en', 'sv']);
  });

  it('picks the preferred-language member as primary', () => {
    const en = idx({ id: 'pip-en', language: 'en', group_id: 'pip' });
    const sv = idx({ id: 'pip-sv', language: 'sv', group_id: 'pip' });
    const result = groupStoryIndexes([en, sv], 'sv');
    expect(result[0].primary.id).toBe('pip-sv');
  });

  it('falls back to en when preferred is absent', () => {
    const en = idx({ id: 'pip-en', language: 'en', group_id: 'pip' });
    const fr = idx({ id: 'pip-fr', language: 'fr', group_id: 'pip' });
    const result = groupStoryIndexes([en, fr], 'sv');
    expect(result[0].primary.id).toBe('pip-en');
  });

  it('falls back to most-recently-updated when neither preferred nor en exists', () => {
    const fr = idx({ id: 'pip-fr', language: 'fr', group_id: 'pip', updated_at: '2026-02-01T00:00:00Z' });
    const bg = idx({ id: 'pip-bg', language: 'bg', group_id: 'pip', updated_at: '2026-03-01T00:00:00Z' });
    const result = groupStoryIndexes([fr, bg], 'sv');
    expect(result[0].primary.id).toBe('pip-bg');
  });

  it('handles a mix of grouped and solo stories', () => {
    const en = idx({ id: 'pip-en', language: 'en', group_id: 'pip' });
    const sv = idx({ id: 'pip-sv', language: 'sv', group_id: 'pip' });
    const solo = idx({ id: 'bob', language: 'sv' });
    const result = groupStoryIndexes([en, sv, solo], 'en');
    expect(result).toHaveLength(2);
    const groupIds = result.map((g) => g.group_id).sort();
    expect(groupIds).toEqual([null, 'pip']);
  });

  it('sorts groups by primary.updated_at descending', () => {
    const old = idx({ id: 'old', language: 'en', updated_at: '2026-01-01T00:00:00Z' });
    const recent = idx({ id: 'recent', language: 'en', updated_at: '2026-05-01T00:00:00Z' });
    const result = groupStoryIndexes([old, recent], 'en');
    expect(result.map((g) => g.primary.id)).toEqual(['recent', 'old']);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `npm --workspace apps/web run test -- storage.test`
Expected: FAIL with "Cannot find module" or "groupStoryIndexes is not exported" — the helper doesn't exist yet.

- [ ] **Step 4: Implement groupStoryIndexes**

Append to `functions/api/_lib/storage.ts`:

```ts
import type { Lang, StoryGroupSummary } from './types';

export function groupStoryIndexes(
  indexes: StoryIndex[],
  preferredLang: Lang | null,
): StoryGroupSummary[] {
  const buckets = new Map<string, { groupId: string | null; members: StoryIndex[] }>();
  for (const idx of indexes) {
    const key = idx.group_id ?? `__solo:${idx.id}`;
    const existing = buckets.get(key);
    if (existing) existing.members.push(idx);
    else buckets.set(key, { groupId: idx.group_id ?? null, members: [idx] });
  }

  const groups: StoryGroupSummary[] = [];
  for (const { groupId, members } of buckets.values()) {
    const primary = pickPrimary(members, preferredLang);
    const languages = [...new Set(members.map((m) => m.language))];
    groups.push({ group_id: groupId, primary, languages });
  }

  groups.sort((a, b) => (b.primary.updated_at || '').localeCompare(a.primary.updated_at || ''));
  return groups;
}

function pickPrimary(members: StoryIndex[], preferredLang: Lang | null): StoryIndex {
  if (preferredLang) {
    const match = members.find((m) => m.language === preferredLang);
    if (match) return match;
  }
  const en = members.find((m) => m.language === 'en');
  if (en) return en;
  return [...members].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0];
}
```

(Adjust the existing `import type { ... } from './types';` line at the top of the file to add `Lang` and `StoryGroupSummary` rather than adding a second import.)

- [ ] **Step 5: Run tests to confirm they pass**

Run: `npm --workspace apps/web run test -- storage.test`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add functions/api/_lib/types.ts apps/web/src/types.ts \
        functions/api/_lib/storage.ts functions/api/_lib/storage.test.ts
git commit -m "Add groupStoryIndexes helper for translation grouping"
```

---

### Task 4: Stamp group_id in the translate flow

When a translation is created, set its `group_id` so it joins the source's group.

**Files:**
- Modify: `functions/api/_lib/build.ts` (`BuildOptions` accepts `group_id`; `buildAndSaveVersion` threads it into the saved version; `saveFailedVersion` opts mirror it)
- Modify: `functions/api/translateStory.ts` (compute and pass `group_id` from source)

- [ ] **Step 1: Add group_id to BuildOptions and saveFailedVersion opts**

Edit `functions/api/_lib/build.ts`:

In the `BuildOptions` interface (around line 89), add the optional field:

```ts
interface BuildOptions {
  // ... existing fields ...
  listed?: boolean;
  summary?: string;
  group_id?: string;        // NEW
  paragraphs: { /* ... */ }[];
}
```

In the `saveFailedVersion` opts type (around line 61), add:

```ts
export async function saveFailedVersion(env: Env, opts: {
  // ... existing fields ...
  listed?: boolean;
  group_id?: string;        // NEW
}): Promise<void> {
```

In `saveFailedVersion`'s `rec` construction, mirror the `listed` pattern:

```ts
...(opts.listed !== undefined ? { listed: opts.listed } : {}),
...(opts.group_id ? { group_id: opts.group_id } : {}),
```

In `buildAndSaveVersion`, find where it constructs the StoryVersion to save (look for the `stub`/record literal that includes `creator_id` and `listed`). Add:

```ts
...(opts.group_id ? { group_id: opts.group_id } : {}),
```

(There are likely two places in `buildAndSaveVersion` that construct a version object — the early `stub` save and a final save. Update both for parity.)

- [ ] **Step 2: Pass group_id from translateStory**

Edit `functions/api/translateStory.ts`, in the `buildAndSaveVersion` call inside `onRequestPost`, add `group_id`:

```ts
const newVersion = await buildAndSaveVersion(env, {
  id: newId,
  version: 1,
  title: translated.title,
  sourceAnswers: [/* ... */],
  language: target,
  voiceId: source.voice_id,
  creator_id,
  listed: true,
  group_id: source.group_id ?? source.id,    // NEW
  paragraphs: /* ... */,
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add functions/api/_lib/build.ts functions/api/translateStory.ts
git commit -m "Stamp group_id on translated stories"
```

---

### Task 5: Backfill `language` on existing StoryIndex entries

`groupStoryIndexes` reads `language` off the index. Legacy index entries don't have it. One-shot script rewrites every `{id}/index.json` so it carries the value from the latest version.

**Files:**
- Create: `scripts/backfill-index-language.ts`
- Modify: `package.json` (add `backfill:index-language` script)

- [ ] **Step 1: Write the backfill script**

Create `scripts/backfill-index-language.ts`:

```ts
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
```

- [ ] **Step 2: Wire up npm script**

Edit `package.json`'s scripts block, append after `cleanup:media`:

```json
"backfill:index-language": "tsx --env-file-if-exists=.env scripts/backfill-index-language.ts",
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 4: Run the backfill against R2**

Run: `npm run backfill:index-language`
Expected output: one `[ok]` line per existing story whose index lacked `language`, then `Done. N/M indexes updated.` Re-running is a no-op (all `[skip]`).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-index-language.ts package.json
git commit -m "Add backfill:index-language one-shot for legacy indexes"
```

---

### Task 6: Backfill `group_id` on the four legacy Pip stories

Stamp the same `group_id` on the four Pip stories so they group together. Anchor id = `default-pip-bread-en` (matches what the French and Bulgarian translations already point to in their source_answers).

**Files:**
- Create: `scripts/backfill-groups.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

Create `scripts/backfill-groups.ts`:

```ts
// One-shot: stamp group_id on a curated set of stories so they group
// together on the home page. Edit the GROUPS table below to add more
// groups in the future. Idempotent.
//
//   npm run backfill:groups

import { getStoryVersion, saveStoryVersion } from '../functions/api/_lib/storage';
import { getScriptEnv } from './lib/script-env';

interface Group { group_id: string; member_ids: string[] }

const GROUPS: Group[] = [
  {
    group_id: 'default-pip-bread-en',
    member_ids: [
      'default-pip-bread-en',                       // en
      'default-pip-bread',                          // sv
      '05d291ea-d4d3-4163-9835-c9a480928352',       // fr
      'e8b71318-1a28-453a-809e-f3aaecceec7a',       // bg
    ],
  },
];

async function main() {
  const env = getScriptEnv();
  let updated = 0;
  let skipped = 0;
  for (const g of GROUPS) {
    for (const id of g.member_ids) {
      const latest = await getStoryVersion(env, id);
      if (!latest) {
        console.warn(`[skip] ${id}: not found`);
        skipped += 1;
        continue;
      }
      if (latest.group_id === g.group_id) {
        console.log(`[skip] ${id}: already in group ${g.group_id}`);
        skipped += 1;
        continue;
      }
      const next = { ...latest, group_id: g.group_id };
      await saveStoryVersion(env, next);
      console.log(`[ok]   ${id}: -> group ${g.group_id}`);
      updated += 1;
    }
  }
  console.log(`Done. ${updated} updated, ${skipped} skipped.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Wire up npm script**

Edit `package.json`, append after `backfill:index-language`:

```json
"backfill:groups": "tsx --env-file-if-exists=.env scripts/backfill-groups.ts",
```

- [ ] **Step 3: Run the backfill**

Run: `npm run backfill:groups`
Expected: 4 `[ok]` lines for the Pip stories (assuming none are pre-stamped). Re-run is all `[skip]`.

- [ ] **Step 4: Sanity-check via R2 list**

Run:

```bash
npx tsx --env-file-if-exists=.env -e "
(async () => {
  const { getScriptEnv } = await import('./scripts/lib/script-env.ts');
  const env = getScriptEnv();
  for (const id of ['default-pip-bread-en', 'default-pip-bread', '05d291ea-d4d3-4163-9835-c9a480928352', 'e8b71318-1a28-453a-809e-f3aaecceec7a']) {
    const blob = await env.STORIES.get(\`\${id}/index.json\`);
    const j = await blob.json();
    console.log(id, '->', j.group_id, 'lang=', j.language);
  }
})();
"
```

Expected: each line prints `... -> default-pip-bread-en lang=<two-letter>`.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-groups.ts package.json
git commit -m "Add backfill:groups for the Pip translation group"
```

---

### Task 7: Backend listStories returns groups + frontend renders grouped tiles

This task is a single atomic change — the API response shape changes, so backend + frontend ship together to keep the dev/prod builds working.

**Files:**
- Modify: `functions/api/listStories.ts` (parse `?lang=`, return `StoryGroupSummary[]`)
- Create: `apps/web/src/lang.ts` (LANG_FLAG map + helper)
- Modify: `apps/web/src/api.ts` (`listStories` takes lang and returns new shape)
- Modify: `apps/web/src/routes/HomePage.tsx` (render groups with flag row)
- Modify: `apps/web/src/styles.css` (`.flag-row` styles)

- [ ] **Step 1: Update listStories endpoint**

Replace the body of `functions/api/listStories.ts` with:

```ts
import type { Env } from './_lib/env';
import { listStoryIndexes, groupStoryIndexes } from './_lib/storage';
import { LANGS, type Lang } from './_lib/types';
import { json } from './_lib/util';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const raw = url.searchParams.get('lang');
  const preferredLang: Lang | null = raw && (LANGS as readonly string[]).includes(raw) ? (raw as Lang) : null;
  const indexes = await listStoryIndexes(env);
  return json(groupStoryIndexes(indexes, preferredLang));
};
```

(Keep the existing module shape — only the handler body changes. Verify the imports match the previous file's style.)

- [ ] **Step 2: Create the lang/flag helper**

Create `apps/web/src/lang.ts`:

```ts
import type { Lang } from './types';

export const LANG_FLAG: Record<Lang, string> = {
  en: '🇬🇧',
  sv: '🇸🇪',
  bg: '🇧🇬',
  es: '🇪🇸',
  fr: '🇫🇷',
  mk: '🇲🇰',
  'pt-BR': '🇧🇷',
  'pt-PT': '🇵🇹',
};
```

- [ ] **Step 3: Update listStories API helper**

Edit `apps/web/src/api.ts`, find the `listStories` function. Replace with a version that takes the current app lang and parses the new response shape:

```ts
import type { Lang, StoryGroupSummary } from './types';

export async function listStories(lang: Lang): Promise<StoryGroupSummary[]> {
  const res = await fetch(`/api/listStories?lang=${encodeURIComponent(lang)}`);
  if (!res.ok) throw new Error(`listStories failed: ${res.status}`);
  return res.json() as Promise<StoryGroupSummary[]>;
}
```

(Adjust the imports section of `api.ts` so `StoryGroupSummary` is in scope.)

- [ ] **Step 4: Update HomePage to render groups**

Edit `apps/web/src/routes/HomePage.tsx`. Replace the tile-rendering block (the `.recent-list` map) with grouped tiles that show the flag row:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { listStories } from '../api';
import { useT, useLang } from '../i18n';
import { LANG_FLAG } from '../lang';
import type { StoryGroupSummary } from '../types';

export function HomePage() {
  const t = useT();
  const lang = useLang();
  const [recent, setRecent] = useState<StoryGroupSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    listStories(lang)
      .then(setRecent)
      .catch(() => { /* swallow */ })
      .finally(() => setLoaded(true));
  }, [lang]);

  return (
    <Layout>
      {/* ... existing hero JSX ... */}
      <h2 style={{ marginTop: 8 }}>{t('home.recentHeading')}</h2>
      {!loaded && <div className="subtle">{t('home.recentLoading')}</div>}
      {loaded && recent.length === 0 && (
        <div className="note">{t('home.recentEmpty')}</div>
      )}
      {recent.length > 0 && (
        <div className="recent-list">
          {recent.map((g) => (
            <Link key={g.primary.id} to={`/s/${g.primary.id}`} className="recent-card">
              <div className="thumb">
                {g.primary.cover_image_url
                  ? <img src={g.primary.cover_image_url} alt={g.primary.title} />
                  : <span style={{ fontSize: 60 }}>{'\u{1F4D6}'}</span>}
              </div>
              <div className="meta">
                <b>{g.primary.title}</b>
                <span>v{g.primary.latest_version}</span>
                {g.languages.length > 1 && (
                  <span className="flag-row" aria-label={`Available languages: ${g.languages.join(', ')}`}>
                    {g.languages.map((l) => (
                      <span
                        key={l}
                        className={`flag${l === g.primary.language ? ' flag--current' : ''}`}
                        aria-hidden="true"
                      >
                        {LANG_FLAG[l]}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
```

Verify `useLang` exists in `apps/web/src/i18n` (it's likely already exported alongside `useT`); if not, look at how `Layout.tsx` reads the current lang and use the same approach inline.

- [ ] **Step 5: Add CSS for the flag row**

Edit `apps/web/src/styles.css`. Append:

```css
.flag-row {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  margin-top: 4px;
  font-size: 16px;
  line-height: 1;
}
.flag-row .flag { opacity: 0.6; font-size: 16px; }
.flag-row .flag--current { opacity: 1; font-size: 22px; }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 7: Run vitest**

Run: `npm --workspace apps/web run test`
Expected: all pass, including the `storage.test.ts` grouping tests from Task 3.

- [ ] **Step 8: Smoke-test in dev server**

Run: `npm run dev` (wrangler pages dev, which serves the SPA + functions against prod R2).
Open the served URL. Verify:
- The home page shows 1 Pip tile (not 4) with a flag row showing 4 flags.
- Switching app language via the settings cog re-fetches and shows the title in the new language when available.

(If `wrangler pages dev` complains about missing R2 bindings, the user may need to pass `--r2 STORIES=story-maker-stories --r2 MEDIA=story-maker-media` or rely on `.dev.vars` — check the project's dev setup.)

- [ ] **Step 9: Commit**

```bash
git add functions/api/listStories.ts apps/web/src/lang.ts \
        apps/web/src/api.ts apps/web/src/routes/HomePage.tsx \
        apps/web/src/styles.css
git commit -m "Group stories by translation on the home page"
```

---

### Task 8: getStory returns siblings + StoryPage adds language switcher

Same shape — backend + frontend together.

**Files:**
- Modify: `functions/api/getStory.ts` (compute and return `siblings`)
- Modify: `functions/api/_lib/types.ts` and `apps/web/src/types.ts` (extend the getStory response shape if it's typed; otherwise just StoryVersion + a separate siblings type)
- Modify: `apps/web/src/api.ts` (return type)
- Modify: `apps/web/src/routes/StoryPage.tsx` (render sibling flag row)
- Modify: `apps/web/src/styles.css` (reuse `.flag-row`, plus a `.flag-row a` rule if needed)

- [ ] **Step 1: Update getStory endpoint**

Edit `functions/api/getStory.ts`. After loading the requested version (call it `version`), compute siblings:

```ts
import { listStoryIndexes } from './_lib/storage';
import type { Lang } from './_lib/types';

// ... inside the handler, after `const version = await getStoryVersion(...);` ...
let siblings: Array<{ id: string; language: Lang }> = [];
if (version.group_id) {
  const indexes = await listStoryIndexes(env);
  siblings = indexes
    .filter((i) => i.group_id === version.group_id && i.id !== version.id)
    .map((i) => ({ id: i.id, language: i.language }));
}

return json({ ...version, siblings });
```

(If the current handler returns `version` directly, swap to `json({ ...version, siblings })`. `listStoryIndexes` already filters to `status === 'ready' && listed !== false`, so we don't have to filter again.)

- [ ] **Step 2: Update getStory response type**

In `apps/web/src/types.ts`, define the response wrapper (it doesn't need to be a stored type — only the client uses it):

```ts
export interface StoryVersionWithSiblings extends StoryVersion {
  siblings: Array<{ id: string; language: Lang }>;
}
```

(`siblings` is always an array — empty when standalone.)

- [ ] **Step 3: Update the frontend getStory helper**

Edit `apps/web/src/api.ts`. Change the `getStory` return type to `Promise<StoryVersionWithSiblings>` and update any consuming type annotations in `StoryPage.tsx` / `EditPage.tsx` to match.

- [ ] **Step 4: Render the sibling flag row on StoryPage**

Edit `apps/web/src/routes/StoryPage.tsx`. Near where the title is rendered, insert the flag row when siblings exist:

```tsx
import { Link } from 'react-router-dom';
import { LANG_FLAG } from '../lang';
import type { Lang } from '../types';

// ... inside the JSX, right after the <h1>{story.title}</h1> ...
{story.siblings.length > 0 && (
  <div className="flag-row" aria-label="Switch language">
    <span className={'flag flag--current'} aria-hidden="true">
      {LANG_FLAG[story.language as Lang]}
    </span>
    {story.siblings.map((s) => (
      <Link
        key={s.id}
        to={`/s/${s.id}`}
        className="flag"
        aria-label={`Switch to ${s.language}`}
      >
        {LANG_FLAG[s.language]}
      </Link>
    ))}
  </div>
)}
```

- [ ] **Step 5: Anchor styles for clickable flags**

Append to `apps/web/src/styles.css`:

```css
.flag-row a.flag {
  text-decoration: none;
  cursor: pointer;
}
.flag-row a.flag:hover { opacity: 1; }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 7: Smoke-test in dev server**

With `npm run dev` running, click into the Pip tile on the home page. Confirm:
- The story page shows the current language's flag bigger/brighter plus the other 3 as clickable flags.
- Clicking any of them navigates to that sibling story; flag row re-renders with the new current.
- A solo story (Bob or Sarah) shows no flag row.

- [ ] **Step 8: Commit**

```bash
git add functions/api/getStory.ts apps/web/src/types.ts \
        apps/web/src/api.ts apps/web/src/routes/StoryPage.tsx \
        apps/web/src/styles.css
git commit -m "Add inline language switcher on the story page"
```

---

### Task 9: End-to-end verification + deploy

Final manual sanity pass and ship.

**Files:** none modified directly. This is the verify step.

- [ ] **Step 1: Run the full typecheck + tests**

Run: `npm run typecheck && npm --workspace apps/web run test`
Expected: clean.

- [ ] **Step 2: Build production bundle**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Manual verification against prod data via dev server**

Run: `npm run dev`. Walk through:

- Home page in English: Pip tile renders with English title and 🇬🇧 large, with 🇸🇪 🇫🇷 🇧🇬 small alongside. Tile click goes to the en story. Bob and Sarah render as solo tiles with no flag row.
- Switch app language to Swedish via the cog. Home page re-renders; Pip tile now shows Swedish title with 🇸🇪 emphasized.
- Click into Pip in Swedish → story page shows sv title + flag row with 🇸🇪 current, others clickable. Click 🇬🇧 → navigates to en story; flag row updates.
- Open Bob's story → no flag row.
- Translate a fresh story via the existing UI to a new language. Confirm the new translation appears under the same tile (group), not as a new tile.

- [ ] **Step 4: Deploy to Cloudflare Pages**

Confirm wrangler is authenticated (`npx wrangler whoami`). Then:

Run: `npm run deploy`
Expected: "✨ Deployment complete!" with the new deploy URL.

- [ ] **Step 5: Production smoke test**

Visit `https://storytime-app.pages.dev/`. Verify the Pip tile collapses to one card with the flag row, exactly as in dev. Click through, switch languages on the story page.

- [ ] **Step 6: Push commits**

Run: `git push`
Expected: fast-forward push of the task commits to `origin/main`.

---

## Self-review notes (post-write)

- **Spec coverage:**
  - Data model (`group_id` on Version + Index, `language` on Index) → Tasks 2, 5.
  - Translate flow stamps `group_id` → Task 4.
  - Backfill for legacy Pip group → Task 6.
  - Three new langs (mk, pt-BR, pt-PT) + LANG_NAMES + i18n strings + stale literal union → Task 1.
  - Backend grouping helper + tests → Task 3.
  - Backend `listStories` shape → Task 7.
  - Backend `getStory` siblings → Task 8.
  - Frontend home tile with flag row → Task 7.
  - Frontend story-page switcher → Task 8.
  - Flag map centralized in `apps/web/src/lang.ts` → Task 7.
  - Deploy / verify → Task 9.

- **Type consistency:** `groupStoryIndexes`, `StoryGroupSummary`, `LANG_FLAG`, `flag()` names are used consistently across tasks. `siblings` field name is consistent between Task 8's backend and frontend.

- **Known runtime assumption:** Task 7 assumes the home page can access the current app language (`useLang`); if the i18n module doesn't export a `useLang` hook, Step 4 of Task 7 falls back to reading it via the same mechanism `Layout.tsx` uses.
