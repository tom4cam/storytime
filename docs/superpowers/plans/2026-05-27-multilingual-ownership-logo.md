# storytime v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v3 feature batch — five-language support with story translation, cookie-gated ownership for delete/list/filter, native share, an open-book SVG logo, and a collapsible audio bar.

**Architecture:** Layer changes into the existing Cloudflare Pages + R2 stack. New types fields, new server helpers (`creatorId`), two new endpoints (`translateStory`, `updateStoryListing`), three new i18n string tables, four new components (`BookLogo`, `ShareButton`, `TranslatePicker`, `ListedToggle`). No new third-party dependencies.

**Tech Stack:** TypeScript, React 18, Vite, Cloudflare Pages Functions, R2, Anthropic SDK, OpenAI tts-1+whisper-1, vitest.

**Spec:** `docs/superpowers/specs/2026-05-27-multilingual-ownership-logo-design.md`

---

## Phase A — Data model + server ownership

### Task 1: Widen `Lang` type and `LANG_NAMES` map

**Files:**
- Modify: `apps/web/src/i18n/index.tsx:5` (Lang type)
- Modify: `apps/web/src/types.ts:35` (StoryVersion language field)
- Modify: `functions/api/_lib/types.ts:35` (mirror)
- Modify: `functions/api/_lib/anthropic.ts` (LANG_NAMES map)
- Modify: `apps/web/src/routes/StoryPage.tsx:271-279` (formatDate locale map)
- Modify: `apps/web/src/api.ts:21` (createStory signature)

- [ ] **Step 1: Widen the Lang type**

Edit `apps/web/src/i18n/index.tsx` line 5:
```ts
export type Lang = 'en' | 'sv' | 'bg' | 'es' | 'fr';
```

- [ ] **Step 2: Widen the StoryVersion language field in both type files**

In `apps/web/src/types.ts` and `functions/api/_lib/types.ts`, change `language: 'en' | 'sv';` to:
```ts
language: 'en' | 'sv' | 'bg' | 'es' | 'fr';
```

- [ ] **Step 3: Widen LANG_NAMES**

In `functions/api/_lib/anthropic.ts`, find `LANG_NAMES` and replace with:
```ts
const LANG_NAMES: Record<'en' | 'sv' | 'bg' | 'es' | 'fr', string> = {
  en: 'English',
  sv: 'Swedish',
  bg: 'Bulgarian',
  es: 'simple, warm Spanish (Latin American)',
  fr: 'simple, warm French (European)',
};
```
Also widen the `language` parameter type in `generateStory`'s signature to the same 5-member union.

- [ ] **Step 4: Map lang to locale in formatDate**

In `apps/web/src/routes/StoryPage.tsx`, replace `formatDate` with:
```ts
function formatDate(s: string, lang: 'en' | 'sv' | 'bg' | 'es' | 'fr'): string {
  const LOCALES = { en: 'en-US', sv: 'sv-SE', bg: 'bg-BG', es: 'es-419', fr: 'fr-FR' } as const;
  try {
    const d = new Date(s);
    return d.toLocaleDateString(LOCALES[lang], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return s; }
}
```

- [ ] **Step 5: Widen `createStory` client signature**

In `apps/web/src/api.ts`, change `language: 'en' | 'sv'` to `language: 'en' | 'sv' | 'bg' | 'es' | 'fr'` in the `createStory` function signature.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (existing call sites still use 'en' or 'sv', which are still valid).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/i18n/index.tsx apps/web/src/types.ts apps/web/src/api.ts apps/web/src/routes/StoryPage.tsx functions/api/_lib/types.ts functions/api/_lib/anthropic.ts
git commit -m "Widen Lang type and locale map to include bg, es, fr"
```

---

### Task 2: Add `creator_id` and `listed` to `StoryVersion`

**Files:**
- Modify: `apps/web/src/types.ts` (StoryVersion + StorySummary)
- Modify: `functions/api/_lib/types.ts` (mirror)

- [ ] **Step 1: Add fields to both StoryVersion definitions**

Append these two lines to the `StoryVersion` interface in both `apps/web/src/types.ts` and `functions/api/_lib/types.ts`:
```ts
  creator_id?: string;
  listed?: boolean;
```

- [ ] **Step 2: Add `creator_id` to `StoryIndex` (functions side) and `StorySummary` (web side)**

In both files, locate the StoryIndex/StorySummary interface and add:
```ts
  creator_id?: string;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (fields are optional, so nothing else breaks).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/types.ts functions/api/_lib/types.ts
git commit -m "Add optional creator_id and listed fields to StoryVersion/StoryIndex"
```

---

### Task 3: Server-side creator-id parser with tests (TDD)

**Files:**
- Create: `functions/api/_lib/creatorId.ts`
- Create: `functions/api/_lib/creatorId.test.ts`

- [ ] **Step 1: Write failing tests**

Create `functions/api/_lib/creatorId.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readCreatorId } from './creatorId';

function req(cookieHeader: string | null): Request {
  const headers = new Headers();
  if (cookieHeader !== null) headers.set('Cookie', cookieHeader);
  return new Request('https://x.test', { headers });
}

describe('readCreatorId', () => {
  it('returns the creator_id value when present', () => {
    expect(readCreatorId(req('creator_id=abc-123'))).toBe('abc-123');
  });
  it('parses creator_id when other cookies are also present', () => {
    expect(readCreatorId(req('foo=bar; creator_id=uuid-here; baz=qux'))).toBe('uuid-here');
  });
  it('returns null when the cookie is missing', () => {
    expect(readCreatorId(req('foo=bar'))).toBeNull();
  });
  it('returns null when no Cookie header is present', () => {
    expect(readCreatorId(req(null))).toBeNull();
  });
  it('returns null for an empty creator_id value', () => {
    expect(readCreatorId(req('creator_id='))).toBeNull();
  });
  it('decodes URL-encoded values', () => {
    expect(readCreatorId(req('creator_id=a%20b'))).toBe('a b');
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/web && npx vitest run ../../functions/api/_lib/creatorId.test.ts --reporter=basic`
Expected: FAIL with "Failed to load url ./creatorId" — file does not exist.

- [ ] **Step 3: Implement**

Create `functions/api/_lib/creatorId.ts`:
```ts
// Parse the stable per-visitor creator_id cookie out of a Request.
// The client sets this on first visit (see apps/web/src/creatorId.ts).

export function readCreatorId(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith('creator_id=')) continue;
    const raw = trimmed.slice('creator_id='.length);
    if (!raw) return null;
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  return null;
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd apps/web && npx vitest run ../../functions/api/_lib/creatorId.test.ts --reporter=basic`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/creatorId.ts functions/api/_lib/creatorId.test.ts
git commit -m "Add server-side creator_id cookie parser with tests"
```

---

### Task 4: `createStory` stamps `creator_id` from cookie

**Files:**
- Modify: `functions/api/createStory.ts`
- Modify: `functions/api/_lib/build.ts` (BuildOptions, saveGeneratingStub, saveFailedVersion to accept creator_id + listed)

- [ ] **Step 1: Extend `BuildOptions` and stub savers to carry creator_id + listed**

In `functions/api/_lib/build.ts`, edit `saveGeneratingStub` and `saveFailedVersion` to accept optional `creator_id?: string` and `listed?: boolean` in their opts argument, and to spread them onto the saved record:
```ts
export async function saveGeneratingStub(env: Env, opts: {
  id: string;
  version: number;
  sourceAnswers: StoryAnswer[];
  language: 'en' | 'sv' | 'bg' | 'es' | 'fr';
  voiceId?: string;
  creator_id?: string;
  listed?: boolean;
}): Promise<StoryVersion> {
  const stub: StoryVersion = {
    id: opts.id,
    version: opts.version,
    title: 'Your new story',
    paragraphs: [],
    narration_url: null,
    source_answers: opts.sourceAnswers,
    created_at: new Date().toISOString(),
    status: 'generating',
    language: opts.language,
    ...(opts.voiceId ? { voice_id: opts.voiceId } : {}),
    ...(opts.creator_id ? { creator_id: opts.creator_id } : {}),
    ...(opts.listed !== undefined ? { listed: opts.listed } : {}),
  };
  await saveStoryVersion(env, stub);
  return stub;
}
```
Apply the same pattern to `saveFailedVersion`. Also widen `language: 'en' | 'sv'` everywhere it appears in `build.ts` to the 5-member union (BuildOptions, buildFromAnswers, etc.).

Add `creator_id?: string` and `listed?: boolean` to `BuildOptions`. In `buildAndSaveVersion`, spread them onto the saved `StoryVersion`:
```ts
const version: StoryVersion = {
  // ...existing fields
  ...(opts.creator_id ? { creator_id: opts.creator_id } : {}),
  ...(opts.listed !== undefined ? { listed: opts.listed } : {}),
};
```

Update `buildFromAnswers` to take and pass through `creator_id?: string`.

- [ ] **Step 2: Read creator_id in `createStory.ts` and pass through**

Edit `functions/api/createStory.ts`:
```ts
import type { Env } from './_lib/env';
import { ModerationError, buildFromAnswers, moderateAnswers, saveFailedVersion, saveGeneratingStub } from './_lib/build';
import type { StoryAnswer } from './_lib/types';
import { badRequest, json, serverError } from './_lib/util';
import { readCreatorId } from './_lib/creatorId';

interface CreateStoryRequest {
  answers: StoryAnswer[];
  language: 'en' | 'sv' | 'bg' | 'es' | 'fr';
  voice_id?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: CreateStoryRequest;
  try { body = (await request.json()) as CreateStoryRequest; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!Array.isArray(body.answers) || body.answers.length === 0) return badRequest('answers required');
  const validLangs: Array<'en'|'sv'|'bg'|'es'|'fr'> = ['en','sv','bg','es','fr'];
  if (!validLangs.includes(body.language)) return badRequest('language must be en, sv, bg, es, or fr');
  const trimmed = body.answers.filter((a) => a.answer && a.answer.trim().length > 0);
  if (trimmed.length === 0) return badRequest('answers required');

  const id = crypto.randomUUID();
  const voiceId = typeof body.voice_id === 'string' && body.voice_id ? body.voice_id : undefined;
  const creator_id = readCreatorId(request) ?? undefined;

  try { await saveGeneratingStub(env, { id, version: 1, sourceAnswers: trimmed, language: body.language, voiceId, creator_id, listed: true }); }
  catch (e) {
    console.error('saveGeneratingStub failed', e);
    return serverError((e as Error).message);
  }

  try {
    const story = await buildFromAnswers(env, id, trimmed, body.language, voiceId, creator_id);
    return json(story);
  } catch (e) {
    const message = e instanceof ModerationError ? e.message : (e as Error).message;
    try {
      await saveFailedVersion(env, {
        id, version: 1, sourceAnswers: trimmed, language: body.language, voiceId, error: message, creator_id, listed: true,
      });
    } catch (saveErr) { console.error('saveFailedVersion failed', saveErr); }
    return serverError(message);
  }
};
```

Update `buildFromAnswers` signature in `_lib/build.ts` to accept and forward `creator_id`:
```ts
export async function buildFromAnswers(
  env: Env,
  id: string,
  answers: StoryAnswer[],
  language: 'en' | 'sv' | 'bg' | 'es' | 'fr',
  voiceId?: string,
  creator_id?: string
): Promise<StoryVersion> {
  await moderateAnswers(env, answers);
  const generated = await safelyGenerate(env, answers, language);
  return buildAndSaveVersion(env, {
    id,
    version: 1,
    title: generated.title,
    sourceAnswers: answers,
    language,
    voiceId,
    creator_id,
    listed: true,
    paragraphs: generated.paragraphs.map((p) => ({ text: p.text, image_prompt: p.image_prompt, image_url: null })),
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/api/createStory.ts functions/api/_lib/build.ts
git commit -m "Stamp creator_id and listed:true on every new story"
```

---

### Task 5: `deleteStory` enforces ownership

**Files:**
- Modify: `functions/api/deleteStory.ts`

- [ ] **Step 1: Replace deleteStory with owner-gated version**

Edit `functions/api/deleteStory.ts`:
```ts
// POST /api/deleteStory

import type { Env } from './_lib/env';
import { getStoryVersion } from './_lib/storage';
import { deleteStoryAndMedia } from './_lib/storage';
import { readCreatorId } from './_lib/creatorId';
import { badRequest, json, serverError } from './_lib/util';

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { id?: string };
  try { body = (await request.json()) as { id?: string }; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.id || typeof body.id !== 'string') return badRequest('id required');

  const cookieId = readCreatorId(request);
  const latest = await getStoryVersion(env, body.id);
  if (!latest) return badRequest('story not found');

  // System stories (or legacy ones with no creator_id) are never deletable.
  if (!latest.creator_id || latest.creator_id === 'system') {
    return forbidden("This is a default story and can't be deleted");
  }
  if (!cookieId || cookieId !== latest.creator_id) {
    return forbidden('Only the creator can delete this story');
  }

  try {
    const counts = await deleteStoryAndMedia(env, body.id);
    return json({ ok: true, deleted: counts });
  } catch (e) {
    console.error('deleteStory failed', e);
    return serverError((e as Error).message);
  }
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add functions/api/deleteStory.ts
git commit -m "Gate deleteStory on creator_id cookie match"
```

---

### Task 6: `listStories` exposes `creator_id`, filters hidden

**Files:**
- Modify: `functions/api/_lib/storage.ts` (saveStoryVersion writes creator_id+listed into the index; listStoryIndexes filters)
- Modify: `functions/api/listStories.ts` (response shape — already returns StoryIndex)
- Modify: `apps/web/src/types.ts` StorySummary already extended in Task 2

- [ ] **Step 1: Persist creator_id and listed onto the index**

In `functions/api/_lib/storage.ts`, inside `saveStoryVersion`, extend the `idx` object:
```ts
const idx: StoryIndex = {
  id: version.id,
  title: version.title,
  latest_version: version.version,
  cover_image_url: version.paragraphs[0]?.image_url ?? null,
  updated_at: version.created_at,
  created_at: createdAt,
  status: version.status,
  ...(version.creator_id ? { creator_id: version.creator_id } : {}),
  ...(version.listed !== undefined ? { listed: version.listed } : {}),
};
```
Also widen `StoryIndex` in `functions/api/_lib/types.ts` to include `listed?: boolean` (you already added `creator_id?: string` in Task 2; add `listed?: boolean` here).

- [ ] **Step 2: Filter `listed === false` in listStoryIndexes**

In the same file, change the final filter chain to:
```ts
return items
  .filter((x): x is StoryIndex => !!x && x.status === 'ready' && x.listed !== false)
  .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/api/_lib/storage.ts functions/api/_lib/types.ts
git commit -m "Persist creator_id+listed on index; filter listed:false from listStories"
```

---

### Task 7: New endpoint `updateStoryListing`

**Files:**
- Create: `functions/api/updateStoryListing.ts`
- Modify: `functions/api/_lib/storage.ts` (helper `setStoryListed` that updates without bumping version)
- Modify: `apps/web/src/api.ts` (client wrapper)

- [ ] **Step 1: Add storage helper**

Append to `functions/api/_lib/storage.ts`:
```ts
// Flip the latest version's `listed` flag in-place (no new version).
export async function setStoryListed(env: Env, id: string, listed: boolean): Promise<StoryVersion | null> {
  const latest = await getStoryVersion(env, id);
  if (!latest) return null;
  const updated: StoryVersion = { ...latest, listed };
  await saveStoryVersion(env, updated);
  return updated;
}
```

- [ ] **Step 2: Create the endpoint**

Create `functions/api/updateStoryListing.ts`:
```ts
// POST /api/updateStoryListing  { id: string, listed: boolean }
// Owner-gated. Updates the latest version's listed flag in place.

import type { Env } from './_lib/env';
import { getStoryVersion, setStoryListed } from './_lib/storage';
import { readCreatorId } from './_lib/creatorId';
import { badRequest, json, serverError } from './_lib/util';

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { id?: string; listed?: boolean };
  try { body = await request.json(); }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.id || typeof body.id !== 'string') return badRequest('id required');
  if (typeof body.listed !== 'boolean') return badRequest('listed must be boolean');

  const cookieId = readCreatorId(request);
  const latest = await getStoryVersion(env, body.id);
  if (!latest) return badRequest('story not found');

  if (!latest.creator_id || latest.creator_id === 'system') {
    return forbidden("This is a default story and can't be changed");
  }
  if (!cookieId || cookieId !== latest.creator_id) {
    return forbidden('Only the creator can change this');
  }

  try {
    const updated = await setStoryListed(env, body.id, body.listed);
    return json(updated);
  } catch (e) {
    console.error('updateStoryListing failed', e);
    return serverError((e as Error).message);
  }
};
```

- [ ] **Step 3: Add client wrapper**

Append to `apps/web/src/api.ts`:
```ts
export async function updateStoryListing(id: string, listed: boolean): Promise<StoryVersion> {
  const res = await fetch(`${FN_BASE}/updateStoryListing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, listed }),
  });
  return jsonOrThrow<StoryVersion>(res);
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/updateStoryListing.ts functions/api/_lib/storage.ts apps/web/src/api.ts
git commit -m "Add updateStoryListing endpoint (owner-gated)"
```

---

## Phase B — Client ownership + i18n

### Task 8: Client-side `creatorId` helper with tests (TDD)

**Files:**
- Create: `apps/web/src/creatorId.ts`
- Create: `apps/web/src/creatorId.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/src/creatorId.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCreatorId, COOKIE_NAME, STORAGE_KEY } from './creatorId';

beforeEach(() => {
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; path=/`;
  window.localStorage.removeItem(STORAGE_KEY);
});

describe('getCreatorId', () => {
  it('generates and persists an id on first call', () => {
    const id = getCreatorId();
    expect(id).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(document.cookie).toContain(`${COOKIE_NAME}=${id}`);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(id);
  });

  it('returns the same id on subsequent calls', () => {
    const a = getCreatorId();
    const b = getCreatorId();
    expect(a).toBe(b);
  });

  it('recovers from localStorage if cookie was cleared', () => {
    window.localStorage.setItem(STORAGE_KEY, 'stored-id-123');
    expect(getCreatorId()).toBe('stored-id-123');
    expect(document.cookie).toContain('creator_id=stored-id-123');
  });

  it('recovers from cookie if localStorage was cleared', () => {
    document.cookie = `${COOKIE_NAME}=cookie-id-456; path=/`;
    expect(getCreatorId()).toBe('cookie-id-456');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('cookie-id-456');
  });
});
```

Also add the jsdom environment to vitest. Check `apps/web/vitest.config.ts` — if `environment: 'node'`, change to `environment: 'jsdom'` and run `npm --workspace apps/web install --save-dev jsdom` if not installed. If installing jsdom is too invasive, instead create a separate config file `creatorId.test.ts` line: `// @vitest-environment jsdom` at the top.

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/web && npx vitest run src/creatorId.test.ts --reporter=basic`
Expected: FAIL with "Failed to load url ./creatorId".

- [ ] **Step 3: Implement**

Create `apps/web/src/creatorId.ts`:
```ts
// Stable per-visitor id. Stored in a 1-year first-party cookie (read
// by the server) and mirrored to localStorage as a self-heal fallback
// in case one storage gets cleared but not the other.

export const COOKIE_NAME = 'creator_id';
export const STORAGE_KEY = 'storyMaker.creatorId';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function readCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${COOKIE_NAME}=`)) continue;
    const raw = trimmed.slice(COOKIE_NAME.length + 1);
    if (!raw) return null;
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  return null;
}

function writeCookie(id: string): void {
  if (typeof document === 'undefined') return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

function readStorage(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function writeStorage(id: string): void {
  try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
}

export function getCreatorId(): string {
  let id = readCookie() ?? readStorage();
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `cid-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
  writeCookie(id);
  writeStorage(id);
  return id;
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd apps/web && npx vitest run src/creatorId.test.ts --reporter=basic`
Expected: 4 tests pass. If jsdom isn't available, add `// @vitest-environment jsdom` to the top of the test file (and install jsdom).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/creatorId.ts apps/web/src/creatorId.test.ts apps/web/vitest.config.ts apps/web/package.json apps/web/package-lock.json
git commit -m "Add client creatorId helper (cookie + localStorage)"
```

---

### Task 9: Bootstrap creatorId on app start and pass through createStory

**Files:**
- Modify: `apps/web/src/main.tsx` (call getCreatorId once on boot)
- Note: server reads creator_id from the cookie header automatically; the createStory client signature does not need a new parameter.

- [ ] **Step 1: Call getCreatorId on boot**

In `apps/web/src/main.tsx`, near the top after imports add:
```ts
import { getCreatorId } from './creatorId';
getCreatorId(); // ensure the cookie+localStorage are seeded on first visit
```

- [ ] **Step 2: Build + typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/main.tsx
git commit -m "Seed creator_id cookie on app boot"
```

---

### Task 10: Generate i18n string tables for bg/es/fr via Claude

**Files:**
- Create: `scripts/translate-i18n.ts`
- Create: `apps/web/src/i18n/strings/bg.ts`
- Create: `apps/web/src/i18n/strings/es.ts`
- Create: `apps/web/src/i18n/strings/fr.ts`
- Modify: `apps/web/src/i18n/index.tsx` (extend TABLES)
- Modify: `apps/web/src/i18n/index.tsx` (extend resolveInitialLang)

- [ ] **Step 1: Write the translation script**

Create `scripts/translate-i18n.ts`:
```ts
// Translates the en.ts string table into Bulgarian, Spanish (Latin
// American), and French (European) via Claude. Reads en.ts at runtime,
// writes apps/web/src/i18n/strings/{bg,es,fr}.ts. Idempotent: re-running
// re-translates and overwrites. Requires ANTHROPIC_API_KEY in env.

import Anthropic from '@anthropic-ai/sdk';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { en } from '../apps/web/src/i18n/strings/en';

interface Target { code: 'bg' | 'es' | 'fr'; name: string; varName: string }
const TARGETS: Target[] = [
  { code: 'bg', name: 'Bulgarian (Български)', varName: 'bg' },
  { code: 'es', name: 'simple, warm Spanish (Latin American Spanish, neutral)', varName: 'es' },
  { code: 'fr', name: 'simple, warm French (European French / fr-FR)', varName: 'fr' },
];

async function translateOne(client: Anthropic, model: string, name: string): Promise<Record<string, string>> {
  const sourceJson = JSON.stringify(en, null, 2);
  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    system:
      `Translate every value in the given JSON object into ${name}. ` +
      `This is the UI for a children's story-making web app for kids aged 3-8. ` +
      `Keep names like "storytime", "Daniel", "Rachel", "Sanna", "Adam", "Brennan", "Linnéa" unchanged. ` +
      `Translations should be short, warm, and kid-friendly. Preserve punctuation style. ` +
      `Do NOT translate keys, only values. Return strict JSON with the same keys. No code fences, no prose outside JSON.`,
    messages: [{ role: 'user', content: sourceJson }],
  });
  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error(`Claude returned no text for ${name}`);
  const raw = block.text.trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return JSON.parse(raw.slice(start, end + 1));
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  for (const t of TARGETS) {
    console.log(`Translating to ${t.name}...`);
    const translated = await translateOne(client, model, t.name);
    // Verify shape: every en key must be present
    const missing = Object.keys(en).filter((k) => !(k in translated));
    if (missing.length > 0) throw new Error(`${t.code}: missing keys: ${missing.join(', ')}`);
    const out = `export const ${t.varName} = ${JSON.stringify(translated, null, 2)} as const;\n`;
    const path = resolve(__dirname, `../apps/web/src/i18n/strings/${t.code}.ts`);
    await writeFile(path, out, 'utf8');
    console.log(`  wrote ${path}`);
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add an npm script to run it**

In root `package.json`, add to `scripts`:
```json
"translate:i18n": "tsx --env-file-if-exists=.env scripts/translate-i18n.ts"
```

- [ ] **Step 3: Run it**

Run: `npm run translate:i18n`
Expected: writes `apps/web/src/i18n/strings/{bg,es,fr}.ts` files. Inspect each briefly — values should be in the target language and reference identical keys to `en.ts`. If a file is missing keys, the script throws.

- [ ] **Step 4: Wire the new tables into TABLES and resolveInitialLang**

In `apps/web/src/i18n/index.tsx`:
```ts
import { en } from './strings/en';
import { sv } from './strings/sv';
import { bg } from './strings/bg';
import { es } from './strings/es';
import { fr } from './strings/fr';

const TABLES: Record<Lang, Record<StringKey, string>> = { en, sv, bg, es, fr };

export function resolveInitialLang(navigatorLang: string, stored: string | null): Lang {
  if (stored === 'en' || stored === 'sv' || stored === 'bg' || stored === 'es' || stored === 'fr') return stored;
  const lower = (navigatorLang || '').toLowerCase();
  if (lower.startsWith('sv')) return 'sv';
  if (lower.startsWith('bg')) return 'bg';
  if (lower.startsWith('es')) return 'es';
  if (lower.startsWith('fr')) return 'fr';
  return 'en';
}
```

- [ ] **Step 5: Update `i18n/index.test.ts` to cover the new languages**

In `apps/web/src/i18n/index.test.ts`, find the resolveInitialLang test cases and add coverage for bg, es, fr. The exact existing structure varies — add at least three new cases asserting that 'bg', 'es-MX', 'fr-CA' resolve to bg, es, fr respectively.

- [ ] **Step 6: Typecheck + test**

Run: `npm run typecheck && cd apps/web && npx vitest run --reporter=basic`
Expected: PASS for typecheck and all tests.

- [ ] **Step 7: Commit**

```bash
git add scripts/translate-i18n.ts package.json apps/web/src/i18n/strings/bg.ts apps/web/src/i18n/strings/es.ts apps/web/src/i18n/strings/fr.ts apps/web/src/i18n/index.tsx apps/web/src/i18n/index.test.ts
git commit -m "Add bg/es/fr i18n string tables and translation script"
```

---

### Task 11: 5-pill language picker in SettingsCog

**Files:**
- Modify: `apps/web/src/components/SettingsCog.tsx`
- Modify: `apps/web/src/i18n/strings/en.ts` (add settings.languageBg/Es/Fr keys)
- Modify: `apps/web/src/i18n/strings/sv.ts`, bg, es, fr (add same keys; minimal translation)
- Modify: `apps/web/src/styles.css` (style for cog-pills grid if needed)

- [ ] **Step 1: Add the 3 new label keys to each string table**

In `en.ts` near the existing `settings.languageEn`, add:
```ts
  'settings.languageBg': 'Български',
  'settings.languageEs': 'Español',
  'settings.languageFr': 'Français',
```
Mirror the same keys in `sv.ts`, `bg.ts`, `es.ts`, `fr.ts` — values are the native names (same across languages: 'Български', 'Español', 'Français').

Also add `'settings.languageEn'` and `'settings.languageSv'` if not already present; values are 'English' and 'Svenska' respectively.

- [ ] **Step 2: Replace the 2-button toggle with a 5-pill grid**

In `apps/web/src/components/SettingsCog.tsx`, replace the language `cog-segmented` block with:
```tsx
<div className="cog-row">
  <span className="cog-label">{t('settings.language')}</span>
  <div className="cog-pills">
    {(['en', 'sv', 'bg', 'es', 'fr'] as const).map((code) => (
      <button
        key={code}
        type="button"
        className={lang === code ? 'on' : ''}
        onClick={() => setLang(code)}
        aria-pressed={lang === code}
      >
        {t(`settings.language${code[0].toUpperCase()}${code[1]}` as 'settings.languageEn')}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 3: Add CSS for cog-pills**

In `apps/web/src/styles.css`, add (near `.cog-segmented`):
```css
.cog-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cog-pills button {
  border: 2px solid var(--ink);
  background: var(--paper);
  border-radius: 14px;
  padding: 4px 10px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.cog-pills button.on {
  background: var(--sun);
  font-weight: 700;
}
```

- [ ] **Step 4: Typecheck + test**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/SettingsCog.tsx apps/web/src/i18n/strings/*.ts apps/web/src/styles.css
git commit -m "Replace 2-button language toggle with 5-pill picker"
```

---

### Task 12: 5-language step in CreatePage

**Files:**
- Modify: `apps/web/src/routes/CreatePage.tsx`
- Modify: each `i18n/strings/*.ts` to add `create.langStepBg/Es/Fr` keys

- [ ] **Step 1: Add 3 new keys**

In each string table, add (after the existing langStepEn / langStepSv):
- `'create.langStepBg': 'Български (Bulgarian)'`
- `'create.langStepEs': 'Español (Spanish)'`
- `'create.langStepFr': 'Français (French)'`

Native-name values are identical across all 5 string tables.

- [ ] **Step 2: Replace the 2-button step with a 5-button grid**

In `apps/web/src/routes/CreatePage.tsx`, find the `if (!storyLang)` block (around line 113) and replace its inner button row with:
```tsx
<div className="lang-grid" style={{ marginTop: 16 }}>
  {(['en','sv','bg','es','fr'] as const).map((code) => (
    <button
      key={code}
      type="button"
      className={`btn${uiLang === code ? ' sun' : ''}`}
      onClick={() => { setStoryLang(code); setVoiceKey(defaultVoiceFor(code).key); setStepKind('opener'); }}
    >
      {t(`create.langStep${code[0].toUpperCase()}${code[1]}` as 'create.langStepEn')}
    </button>
  ))}
</div>
```

In `apps/web/src/styles.css`, add:
```css
.lang-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/CreatePage.tsx apps/web/src/i18n/strings/*.ts apps/web/src/styles.css
git commit -m "Show all 5 languages in CreatePage language step"
```

---

### Task 13: HomePage "All / Just mine" filter

**Files:**
- Modify: `apps/web/src/routes/HomePage.tsx`
- Modify: each i18n string table (add filter labels)

- [ ] **Step 1: Add labels**

To each string table, add:
- `'home.filterAll': 'All recent'`
- `'home.filterMine': 'Just mine'`

For Swedish: 'Alla senaste' / 'Mina egna'. For bg/es/fr the translate-i18n script should have populated them — if not, hand-translate (Bulgarian: 'Всички наскоро' / 'Само мои'; Spanish: 'Todas recientes' / 'Sólo mías'; French: 'Toutes récentes' / 'Seulement les miennes'). Re-run `npm run translate:i18n` if more efficient.

- [ ] **Step 2: Wire the filter**

In `apps/web/src/routes/HomePage.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { listStories } from '../api';
import { useT } from '../i18n';
import { getCreatorId } from '../creatorId';
import type { StorySummary } from '../types';

export function HomePage() {
  const t = useT();
  const [recent, setRecent] = useState<StorySummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showMineOnly, setShowMineOnly] = useState(false);
  const myId = getCreatorId();

  useEffect(() => {
    listStories()
      .then((items) => setRecent(items))
      .catch(() => { /* swallow */ })
      .finally(() => setLoaded(true));
  }, []);

  const ownedCount = useMemo(() => recent.filter((s) => s.creator_id === myId).length, [recent, myId]);
  const visible = useMemo(
    () => (showMineOnly ? recent.filter((s) => s.creator_id === myId) : recent),
    [recent, myId, showMineOnly]
  );

  return (
    <Layout>
      <div className="hero">
        <h1>{t('home.heroTitle')}</h1>
        <p>{t('home.heroBody')}</p>
        <Link to="/create" className="btn sun">{t('home.heroCta')}</Link>
      </div>

      <h2 style={{ marginTop: 8 }}>{t('home.recentHeading')}</h2>
      {ownedCount > 0 && (
        <div className="filter-pills">
          <button
            type="button"
            className={showMineOnly ? '' : 'on'}
            onClick={() => setShowMineOnly(false)}
            aria-pressed={!showMineOnly}
          >
            {t('home.filterAll')}
          </button>
          <button
            type="button"
            className={showMineOnly ? 'on' : ''}
            onClick={() => setShowMineOnly(true)}
            aria-pressed={showMineOnly}
          >
            {t('home.filterMine')} ({ownedCount})
          </button>
        </div>
      )}

      {!loaded && <div className="subtle">{t('home.recentLoading')}</div>}
      {loaded && visible.length === 0 && (
        <div className="note">{t('home.recentEmpty')}</div>
      )}
      {visible.length > 0 && (
        <div className="recent-list">
          {visible.map((s) => (
            <Link key={s.id} to={`/s/${s.id}`} className="recent-card">
              <div className="thumb">
                {s.cover_image_url
                  ? <img src={s.cover_image_url} alt={s.title} />
                  : <span style={{ fontSize: 60 }}>{'\u{1F4D6}'}</span>}
              </div>
              <div className="meta">
                <b>{s.title}</b>
                <span>v{s.latest_version}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
```

- [ ] **Step 3: Style the pills**

In `apps/web/src/styles.css` add:
```css
.filter-pills {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.filter-pills button {
  border: 3px solid var(--ink);
  background: var(--paper);
  border-radius: 16px;
  padding: 6px 14px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.filter-pills button.on {
  background: var(--sun);
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/HomePage.tsx apps/web/src/i18n/strings/*.ts apps/web/src/styles.css
git commit -m "Add All/Just-mine filter to HomePage recent list"
```

---

### Task 14: StoryPage: owner-gated delete + Listed toggle

**Files:**
- Modify: `apps/web/src/routes/StoryPage.tsx`
- Modify: i18n tables — add `story.listed`, `story.unlisted`, `story.listingFailed`, `story.notOwnerDelete`

- [ ] **Step 1: Add new keys**

Add to each string table:
- `'story.listed': 'Listed on home page'`
- `'story.unlisted': 'Hidden from home page'`
- `'story.listingFailed': "Couldn't update — try again."`

Translate via the script or by hand for non-en.

- [ ] **Step 2: Hide delete button for non-owners, add Listed toggle**

In `apps/web/src/routes/StoryPage.tsx`:
- Add at top of component: `import { getCreatorId } from '../creatorId';` and `import { updateStoryListing } from '../api';`
- Inside the component:
  ```tsx
  const myId = getCreatorId();
  const isOwner = !!story?.creator_id && story.creator_id !== 'system' && story.creator_id === myId;
  const [listed, setListedLocal] = useState<boolean>(story?.listed !== false);
  const [listingError, setListingError] = useState<string | null>(null);
  ```
  When `story` changes, sync `listed` from `story.listed !== false`:
  ```tsx
  useEffect(() => {
    if (story) setListedLocal(story.listed !== false);
  }, [story?.id, story?.listed]);
  ```
- Replace the delete row with:
  ```tsx
  {isOwner && !confirmingDelete && (
    <div className="row no-print" style={{ justifyContent: 'center', marginTop: 16 }}>
      <button
        type="button"
        className="btn ghost"
        onClick={async () => {
          if (!story) return;
          const next = !listed;
          setListedLocal(next);
          setListingError(null);
          try {
            await updateStoryListing(story.id, next);
          } catch (e) {
            setListedLocal(!next);
            setListingError(`${t('story.listingFailed')} (${(e as Error).message})`);
          }
        }}
      >
        {listed ? t('story.listed') : t('story.unlisted')}
      </button>
      <button type="button" className="btn danger-ghost" onClick={() => setConfirmingDelete(true)}>
        {t('story.delete')}
      </button>
    </div>
  )}
  {listingError && <div className="error">{listingError}</div>}
  ```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/StoryPage.tsx apps/web/src/i18n/strings/*.ts
git commit -m "Add Listed toggle and owner-gated delete on StoryPage"
```

---

## Phase C — Translation

### Task 15: Server-side `translate()` helper with tests (TDD)

**Files:**
- Modify: `functions/api/_lib/anthropic.ts` (add `translateStory`)
- Create: `functions/api/_lib/anthropic.test.ts`

- [ ] **Step 1: Write failing test**

Create `functions/api/_lib/anthropic.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

// We only test the parse step of translateStory — the network call is
// mocked. The full request shape is hand-verified.
import { __parseTranslation } from './anthropic';

describe('__parseTranslation', () => {
  it('extracts JSON object from a raw Claude response', () => {
    const out = __parseTranslation(`Here is the translation:\n{"title":"Hej","paragraphs":["A","B"]}\n`);
    expect(out).toEqual({ title: 'Hej', paragraphs: ['A', 'B'] });
  });
  it('handles code-fenced JSON', () => {
    const out = __parseTranslation('```json\n{"title":"X","paragraphs":["Y"]}\n```');
    expect(out).toEqual({ title: 'X', paragraphs: ['Y'] });
  });
  it('throws on malformed input', () => {
    expect(() => __parseTranslation('no json here')).toThrow(/translation/i);
  });
  it('throws when paragraphs is missing', () => {
    expect(() => __parseTranslation('{"title":"x"}')).toThrow(/paragraphs/i);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd apps/web && npx vitest run ../../functions/api/_lib/anthropic.test.ts --reporter=basic`
Expected: FAIL — `__parseTranslation` not exported.

- [ ] **Step 3: Implement**

Append to `functions/api/_lib/anthropic.ts`:
```ts
export interface TranslatedStoryPayload {
  title: string;
  paragraphs: string[];
}

// Exported only for tests.
export function __parseTranslation(raw: string): TranslatedStoryPayload {
  const text = raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`translation: no JSON object found`);
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!parsed.title || !Array.isArray(parsed.paragraphs)) {
    throw new Error('translation: missing title or paragraphs');
  }
  return { title: String(parsed.title), paragraphs: parsed.paragraphs.map(String) };
}

export async function translateStory(
  env: Env,
  source: { title: string; paragraphs: string[]; sourceLanguage: string },
  targetLanguage: 'en' | 'sv' | 'bg' | 'es' | 'fr'
): Promise<TranslatedStoryPayload> {
  const apiKey = requireEnv(env, 'ANTHROPIC_API_KEY');
  const model = env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  const targetName = LANG_NAMES[targetLanguage];
  const body = source.paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');

  const res = await client.messages.create({
    model,
    max_tokens: 3000,
    system:
      `Translate the given children's story into ${targetName} suitable for ages 3-8. ` +
      `Keep proper names (Pip, Marta, Bob, Brennan, Linnéa, etc.) unchanged. ` +
      `Return strict JSON with this shape: {"title": "...", "paragraphs": ["...", "...", ...]}. ` +
      `No prose outside JSON, no code fences. Same number of paragraphs as the source.`,
    messages: [{ role: 'user', content: `Title: ${source.title}\n\n${body}\n\nReturn JSON.` }],
  });
  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('translation: Claude returned no text');
  const parsed = __parseTranslation(block.text);
  if (parsed.paragraphs.length !== source.paragraphs.length) {
    throw new Error(`translation: expected ${source.paragraphs.length} paragraphs, got ${parsed.paragraphs.length}`);
  }
  return parsed;
}
```

You'll need to make sure `LANG_NAMES` and `requireEnv` are visible at this point in the file. Reorder imports if needed.

- [ ] **Step 4: Run, confirm pass**

Run: `cd apps/web && npx vitest run ../../functions/api/_lib/anthropic.test.ts --reporter=basic`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/anthropic.ts functions/api/_lib/anthropic.test.ts
git commit -m "Add translateStory helper with parse tests"
```

---

### Task 16: `translateStory` endpoint

**Files:**
- Create: `functions/api/translateStory.ts`
- Modify: `apps/web/src/api.ts` (client wrapper)

- [ ] **Step 1: Create the endpoint**

Create `functions/api/translateStory.ts`:
```ts
// POST /api/translateStory
// Body: { id: string, version?: number, target_language: 'en'|'sv'|'bg'|'es'|'fr' }
// Returns a brand-new StoryVersion (its own id) in the target language,
// reusing the source story's images and original voice id. Re-synthesizes
// narration in the target language.

import type { Env } from './_lib/env';
import { translateStory as runTranslation } from './_lib/anthropic';
import { buildAndSaveVersion } from './_lib/build';
import { getStoryVersion } from './_lib/storage';
import { readCreatorId } from './_lib/creatorId';
import { badRequest, json, serverError } from './_lib/util';

interface TranslateRequest {
  id?: string;
  version?: number;
  target_language?: string;
}

const VALID_LANGS: Array<'en'|'sv'|'bg'|'es'|'fr'> = ['en','sv','bg','es','fr'];

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: TranslateRequest;
  try { body = await request.json(); }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.id || typeof body.id !== 'string') return badRequest('id required');
  const target = body.target_language as 'en'|'sv'|'bg'|'es'|'fr';
  if (!VALID_LANGS.includes(target)) return badRequest('target_language must be en, sv, bg, es, or fr');

  try {
    const source = await getStoryVersion(env, body.id, body.version);
    if (!source) return badRequest('source story not found');
    if (source.language === target) return badRequest('target_language must differ from source');

    const translated = await runTranslation(env, {
      title: source.title,
      paragraphs: source.paragraphs.map((p) => p.text),
      sourceLanguage: source.language,
    }, target);

    const creator_id = readCreatorId(request) ?? source.creator_id ?? undefined;
    const newId = crypto.randomUUID();

    const newVersion = await buildAndSaveVersion(env, {
      id: newId,
      version: 1,
      title: translated.title,
      sourceAnswers: [{ question: 'Translated from', answer: `${source.id} (${source.language} → ${target})` }],
      language: target,
      voiceId: source.voice_id,
      creator_id,
      listed: true,
      // Reuse images: pass existing urls and prompts, no regenerate flag.
      paragraphs: source.paragraphs.map((p, i) => ({
        text: translated.paragraphs[i],
        image_prompt: p.image_prompt,
        image_url: p.image_url,
      })),
    });

    return json(newVersion);
  } catch (e) {
    console.error('translateStory failed', e);
    return serverError((e as Error).message);
  }
};
```

- [ ] **Step 2: Add client wrapper**

Append to `apps/web/src/api.ts`:
```ts
export async function translateStory(
  id: string,
  targetLanguage: 'en' | 'sv' | 'bg' | 'es' | 'fr',
  version?: number
): Promise<StoryVersion> {
  const res = await fetch(`${FN_BASE}/translateStory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, version, target_language: targetLanguage }),
  });
  return jsonOrThrow<StoryVersion>(res);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/api/translateStory.ts apps/web/src/api.ts
git commit -m "Add translateStory endpoint that produces a new story in the target language"
```

---

### Task 17: Translate UI on StoryPage

**Files:**
- Modify: `apps/web/src/routes/StoryPage.tsx`
- Modify: i18n tables (add `story.translate`, `story.translateChoose`, `story.translating`, `story.translateError`)

- [ ] **Step 1: Add labels**

To each string table, add:
- `'story.translate': 'Translate'`
- `'story.translateChoose': 'Translate into:'`
- `'story.translating': 'Translating...'`
- `'story.translateError': 'Translation failed — try again.'`

Translate via script or by hand.

- [ ] **Step 2: Add the Translate button + inline picker to StoryPage**

In `apps/web/src/routes/StoryPage.tsx`, near the existing action row (between Edit, Print, Make Another):
```tsx
import { translateStory as apiTranslate } from '../api';
// ...inside component
const [translatePickerOpen, setTranslatePickerOpen] = useState(false);
const [translating, setTranslating] = useState(false);
const [translateError, setTranslateError] = useState<string | null>(null);

const onPickTranslation = async (target: 'en' | 'sv' | 'bg' | 'es' | 'fr') => {
  if (!story) return;
  setTranslating(true);
  setTranslateError(null);
  try {
    const next = await apiTranslate(story.id, target);
    navigate(`/s/${next.id}`);
  } catch (e) {
    setTranslating(false);
    setTranslateError(`${t('story.translateError')} (${(e as Error).message})`);
  }
};
```

Add to the bottom-action row, after the Edit button:
```tsx
<button type="button" className="btn ghost" onClick={() => setTranslatePickerOpen((v) => !v)}>
  {t('story.translate')}
</button>
```

Below that row, render the inline picker:
```tsx
{translatePickerOpen && (
  <div className="card no-print" style={{ marginTop: 12 }}>
    <div className="question">{t('story.translateChoose')}</div>
    {translating && <div className="subtle">{t('story.translating')}</div>}
    {translateError && <div className="error">{translateError}</div>}
    <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
      {(['en','sv','bg','es','fr'] as const)
        .filter((c) => c !== story.language)
        .map((code) => (
          <button
            key={code}
            type="button"
            className="btn"
            disabled={translating}
            onClick={() => onPickTranslation(code)}
          >
            {t(`settings.language${code[0].toUpperCase()}${code[1]}` as 'settings.languageEn')}
          </button>
        ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/StoryPage.tsx apps/web/src/i18n/strings/*.ts
git commit -m "Add Translate action with language picker on StoryPage"
```

---

## Phase D — Visual polish

### Task 18: BookLogo component + Layout integration

**Files:**
- Create: `apps/web/src/components/BookLogo.tsx`
- Modify: `apps/web/src/components/Layout.tsx`
- Modify: `apps/web/src/styles.css` (brand layout)

- [ ] **Step 1: Create BookLogo**

Create `apps/web/src/components/BookLogo.tsx`:
```tsx
interface Props {
  size?: number;
  className?: string;
}

export function BookLogo({ size = 48, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 14 Q8 10 12 10 L30 10 Q32 12 32 14 L32 54 Q32 52 30 52 L12 52 Q8 52 8 54 Z"
        fill="var(--sun)"
        stroke="var(--ink)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M56 14 Q56 10 52 10 L34 10 Q32 12 32 14 L32 54 Q32 52 34 52 L52 52 Q56 52 56 54 Z"
        fill="var(--accent)"
        stroke="var(--ink)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <line x1="14" y1="22" x2="26" y2="22" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <line x1="14" y1="30" x2="26" y2="30" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <line x1="38" y1="22" x2="50" y2="22" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <line x1="38" y1="30" x2="50" y2="30" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 2: Use it in Layout**

Edit `apps/web/src/components/Layout.tsx`:
```tsx
import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { SettingsCog } from './SettingsCog';
import { BookLogo } from './BookLogo';

// ...
<Link to="/" className="brand">
  <BookLogo size={44} className="brand-logo" />
  <span className="brand-text">
    {t('brand.name')}
    <small>{t('brand.tagline')}</small>
  </span>
</Link>
```

- [ ] **Step 3: Style the brand layout**

In `apps/web/src/styles.css`, find the `.brand` rule and update:
```css
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ink);
  text-decoration: none;
}
.brand-logo { flex: 0 0 auto; }
.brand-text { display: inline-flex; flex-direction: column; line-height: 1.05; }
.brand-text small { color: var(--ink-soft); margin-top: 2px; }
@media (max-width: 480px) {
  .brand-logo { width: 36px; height: 36px; }
}
```

If the existing `.brand small` rule is present, keep its existing styles where they don't conflict with the new `.brand-text small`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/BookLogo.tsx apps/web/src/components/Layout.tsx apps/web/src/styles.css
git commit -m "Add inline-SVG open-book logo to the header"
```

---

### Task 19: ShareButton + toast

**Files:**
- Create: `apps/web/src/components/ShareButton.tsx`
- Modify: `apps/web/src/routes/StoryPage.tsx`
- Modify: i18n tables: `story.share`, `story.shareCopied`

- [ ] **Step 1: Add labels**

To each string table:
- `'story.share': 'Share'`
- `'story.shareCopied': 'Link copied!'`

- [ ] **Step 2: Create the component**

Create `apps/web/src/components/ShareButton.tsx`:
```tsx
import { useState } from 'react';
import { useT } from '../i18n';

interface Props {
  title: string;
  url?: string;
}

export function ShareButton({ title, url }: Props) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    const shareUrl = url ?? window.location.href;
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try { await navigator.share({ title, url: shareUrl }); return; }
      catch { /* user cancelled — fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* if even clipboard fails there's nothing graceful left */ }
  };

  return (
    <span style={{ position: 'relative' }}>
      <button type="button" className="btn ghost" onClick={onClick}>
        {t('story.share')}
      </button>
      {copied && (
        <span className="share-toast" role="status">
          {t('story.shareCopied')}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 3: Add toast CSS**

In `apps/web/src/styles.css`:
```css
.share-toast {
  position: absolute;
  top: -36px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--ink);
  color: var(--paper);
  padding: 4px 10px;
  border-radius: 10px;
  font-size: 14px;
  white-space: nowrap;
  pointer-events: none;
  animation: toast-fade 2s ease forwards;
}
@keyframes toast-fade {
  0% { opacity: 0; transform: translate(-50%, 6px); }
  10% { opacity: 1; transform: translate(-50%, 0); }
  85% { opacity: 1; transform: translate(-50%, 0); }
  100% { opacity: 0; transform: translate(-50%, -6px); }
}
```

- [ ] **Step 4: Use in StoryPage**

In `apps/web/src/routes/StoryPage.tsx`, import the component and add it to the action row near Edit/Print/Make Another:
```tsx
import { ShareButton } from '../components/ShareButton';
// ...
<ShareButton title={story.title} />
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ShareButton.tsx apps/web/src/routes/StoryPage.tsx apps/web/src/styles.css apps/web/src/i18n/strings/*.ts
git commit -m "Add Share button with native share + clipboard fallback"
```

---

### Task 20: Collapsible audio bar with persisted preference

**Files:**
- Modify: `apps/web/src/components/AudioBar.tsx`
- Modify: `apps/web/src/prefs.ts` (add audioBarCollapsed)
- Modify: i18n tables: `audio.collapse`, `audio.expand`

- [ ] **Step 1: Extend Prefs**

In `apps/web/src/prefs.ts`:
```ts
export interface Prefs {
  slow: boolean;
  audioBarCollapsed: boolean;
}

const KEY = 'storyMaker.prefs';
const DEFAULT: Prefs = { slow: false, audioBarCollapsed: false };
```
(Keep the rest of the file.)

- [ ] **Step 2: Add labels**

To each string table:
- `'audio.collapse': 'Hide player'`
- `'audio.expand': 'Show player'`

- [ ] **Step 3: Add collapse toggle to AudioBar**

In `apps/web/src/components/AudioBar.tsx`, near the top of the rendered JSX add a chevron toggle. The exact JSX depends on the existing AudioBar shape; the principle is:
- Read `prefs.audioBarCollapsed`.
- If collapsed, render a slim row with only ▶︎/⏸︎ and the progress bar (no time, no extra controls), and a small "▴ {t('audio.expand')}" button.
- If expanded, render the existing full bar with a "▾ {t('audio.collapse')}" button in the corner.
- Toggle calls `setPrefs({ audioBarCollapsed: !prefs.audioBarCollapsed })`.

If `AudioBar.tsx` uses forwardRef, leave the ref handle unchanged — only the rendered chrome changes.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/AudioBar.tsx apps/web/src/prefs.ts apps/web/src/i18n/strings/*.ts
git commit -m "Make the audio bar collapsible; persist preference"
```

---

## Phase E — Migration + verification

### Task 21: Backfill script to stamp seeded defaults as system

**Files:**
- Create: `scripts/backfill-system-stories.ts`

- [ ] **Step 1: Write the script**

Create `scripts/backfill-system-stories.ts`:
```ts
// One-shot: stamp the three seeded default stories with
// creator_id: 'system' and listed: true so they're permanent and
// always visible on the home page. Idempotent (running it twice is
// a no-op aside from rewriting identical content).
//
//   npm run backfill:system

import { getStoryVersion, saveStoryVersion } from '../functions/api/_lib/storage';
import { getScriptEnv } from './lib/script-env';

const env = getScriptEnv();
const SYSTEM_IDS = ['default-bobs-butter', 'default-pip-bread', 'default-pip-bread-en'];

async function backfillOne(id: string): Promise<void> {
  const latest = await getStoryVersion(env, id);
  if (!latest) {
    console.warn(`[skip] ${id}: not found`);
    return;
  }
  if (latest.creator_id === 'system' && latest.listed !== false) {
    console.log(`[skip] ${id}: already system+listed`);
    return;
  }
  const updated = { ...latest, creator_id: 'system', listed: true };
  await saveStoryVersion(env, updated);
  console.log(`[ok]   ${id}: stamped system+listed`);
}

async function main() {
  for (const id of SYSTEM_IDS) await backfillOne(id);
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

In root `package.json` `scripts`:
```json
"backfill:system": "tsx --env-file-if-exists=.env scripts/backfill-system-stories.ts"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-system-stories.ts package.json
git commit -m "Add one-shot backfill script to stamp seeded defaults as system"
```

---

### Task 22: Run backfill + smoke verification

This is a verification-only task. No code changes.

- [ ] **Step 1: Run the backfill**

Run: `npm run backfill:system`
Expected: each id reports either `[ok]` (first run) or `[skip]` (subsequent).

- [ ] **Step 2: Build + deploy**

```bash
npm run build
npm run deploy
```
Expected: deploy succeeds, prints a preview URL.

- [ ] **Step 3: Smoke /api/listStories**

```bash
curl -s https://storytime-app.pages.dev/api/listStories | python3 -m json.tool | head -50
```
Expected: 3 stories, each with `creator_id: "system"`.

- [ ] **Step 4: Smoke /api/deleteStory for a system story (must 403)**

```bash
curl -s -X POST -H "Content-Type: application/json" -d '{"id":"default-bobs-butter"}' \
  -w "\nHTTP %{http_code}\n" https://storytime-app.pages.dev/api/deleteStory
```
Expected: HTTP 403 and a body like `{"error":"This is a default story and can't be deleted"}`.

- [ ] **Step 5: Smoke /api/translateStory**

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"id":"default-pip-bread-en","target_language":"fr"}' \
  -w "\nHTTP %{http_code}\n" https://storytime-app.pages.dev/api/translateStory | head -c 800
```
Expected: HTTP 200 and a new StoryVersion with `language: "fr"`. Test takes ~10-20s due to Claude + tts-1 + whisper-1.

- [ ] **Step 6: Manual UI walkthrough**

Open https://storytime-app.pages.dev/ and check:
- Logo: open-book SVG renders in the header.
- Settings cog: 5 language pills, switching changes copy.
- HomePage: "All / Just mine" pills do NOT appear (no owned stories yet for this visitor).
- Open a story → Share button works (copy fallback on desktop, native sheet on mobile).
- System story (Bob): no delete button visible (you don't own it).
- Audio bar: chevron toggles collapse; reload page → still collapsed.
- /create → new story in each of bg, es, fr (one quick test each: a one-sentence opener, one answer, "Make my story") then verify the resulting story shows in the target language.
- On a created story: delete button visible; tap "Hidden" → reload home page → story no longer in list. Toggle back to listed → reload → reappears.
- Translate button on a created story: pick a different language → land on a new story in that language with the same images.

If any item fails, surface it and stop before claiming done.

- [ ] **Step 7: Final commit + push**

After verification, push everything:
```bash
git push origin main
```

---

---

### Task 23: Admin email alerts for upstream API failures (Resend)

Added 2026-05-27 after planning. Wraps every upstream HTTP call so a 429
or 5xx fires a short email to the admin. R2-backed per-(provider, kind)
cooldown keeps volume low. Resend is the email provider; the API key
goes through a new optional `RESEND_API_KEY` secret.

**Files:**
- Create: `functions/api/_lib/alerts.ts`
- Create: `functions/api/_lib/alerts.test.ts`
- Modify: `functions/api/_lib/env.ts` (add `RESEND_API_KEY?: string`)
- Modify: `functions/api/_lib/anthropic.ts` (wrap upstream calls)
- Modify: `functions/api/_lib/tts.ts` (wrap upstream calls)
- Modify: `functions/api/_lib/moderation.ts` (wrap upstream calls)
- Modify: `functions/api/_lib/fal.ts` (wrap upstream calls)
- Modify: `.env.example` (document new var)
- Modify: `README.md` (document new var + Resend setup)

- [ ] **Step 1: Add the env var slot**

In `functions/api/_lib/env.ts`, inside the `Env` interface, add:
```ts
  // Optional alerting (Resend). When unset, alerts log a warning and no-op.
  RESEND_API_KEY?: string;
```

- [ ] **Step 2: Write failing tests for cooldown logic**

Create `functions/api/_lib/alerts.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __shouldSendForTest, __markSentForTest, classifyError } from './alerts';

function makeR2Stub() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return { async text() { return v; } };
    },
    async put(key: string, value: string) { store.set(key, value); },
  };
}

describe('alerts cooldown', () => {
  let r2: ReturnType<typeof makeR2Stub>;
  beforeEach(() => { r2 = makeR2Stub(); });

  it('allows the first send for a new (provider, kind)', async () => {
    expect(await __shouldSendForTest(r2 as never, 'openai', 'http_429')).toBe(true);
  });

  it('blocks repeat send inside the cooldown window', async () => {
    await __markSentForTest(r2 as never, 'openai', 'http_429');
    expect(await __shouldSendForTest(r2 as never, 'openai', 'http_429')).toBe(false);
  });

  it('allows send after the cooldown window passes', async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    r2.store.set('alerts/last-openai-http_429.txt', past);
    expect(await __shouldSendForTest(r2 as never, 'openai', 'http_429')).toBe(true);
  });

  it('separate (provider, kind) keys do not interfere', async () => {
    await __markSentForTest(r2 as never, 'openai', 'http_429');
    expect(await __shouldSendForTest(r2 as never, 'anthropic', 'http_429')).toBe(true);
    expect(await __shouldSendForTest(r2 as never, 'openai', 'http_5xx')).toBe(true);
  });
});

describe('classifyError', () => {
  it('maps 429 to http_429', () => { expect(classifyError(429)).toBe('http_429'); });
  it('maps 500 to http_5xx', () => { expect(classifyError(500)).toBe('http_5xx'); });
  it('maps 503 to http_5xx', () => { expect(classifyError(503)).toBe('http_5xx'); });
  it('returns null for 200', () => { expect(classifyError(200)).toBeNull(); });
  it('returns null for 400', () => { expect(classifyError(400)).toBeNull(); });
  it('maps a thrown error to network_error when no status', () => {
    expect(classifyError(undefined, new Error('econnreset'))).toBe('network_error');
  });
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `cd apps/web && npx vitest run ../../functions/api/_lib/alerts.test.ts --reporter=basic`
Expected: FAIL with `Failed to load url ./alerts`.

- [ ] **Step 4: Implement alerts.ts**

Create `functions/api/_lib/alerts.ts`:
```ts
// Admin alerts for upstream API failures. Sends an email via Resend
// when an upstream returns 429/5xx or a network error escapes a fetch.
//
// Cooldown: one alert per (provider, kind) per hour, tracked in R2.
// If RESEND_API_KEY is unset the alert is a no-op (logged warning).

import type { Env } from './env';

const ADMIN_EMAIL = 'caswell.tom@gmail.com';
const SENDER = 'storytime alerts <onboarding@resend.dev>';
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export type AlertKind = 'http_429' | 'http_5xx' | 'network_error';
export type AlertProvider = 'anthropic' | 'openai' | 'fal';

export function classifyError(status: number | undefined, err?: Error): AlertKind | null {
  if (status === 429) return 'http_429';
  if (status !== undefined && status >= 500 && status < 600) return 'http_5xx';
  if (status === undefined && err) return 'network_error';
  return null;
}

interface R2Lite {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

function keyFor(provider: AlertProvider, kind: AlertKind): string {
  return `alerts/last-${provider}-${kind}.txt`;
}

async function shouldSend(bucket: R2Lite, provider: AlertProvider, kind: AlertKind): Promise<boolean> {
  const obj = await bucket.get(keyFor(provider, kind));
  if (!obj) return true;
  const last = await obj.text();
  const lastMs = Date.parse(last);
  if (Number.isNaN(lastMs)) return true;
  return Date.now() - lastMs >= COOLDOWN_MS;
}

async function markSent(bucket: R2Lite, provider: AlertProvider, kind: AlertKind): Promise<void> {
  await bucket.put(keyFor(provider, kind), new Date().toISOString(), {
    httpMetadata: { contentType: 'text/plain' },
  });
}

export async function notifyAdminFailure(
  env: Env,
  provider: AlertProvider,
  kind: AlertKind,
  detail: string
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn(`[alerts] skip (no RESEND_API_KEY): ${provider} ${kind} — ${detail.slice(0, 200)}`);
    return;
  }
  try {
    if (!(await shouldSend(env.STORIES as unknown as R2Lite, provider, kind))) return;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SENDER,
        to: [ADMIN_EMAIL],
        subject: `[storytime] ${provider} ${kind}`,
        text:
          `Provider: ${provider}\n` +
          `Kind:     ${kind}\n` +
          `Time:     ${new Date().toISOString()}\n` +
          `Detail:\n${detail.slice(0, 2000)}`,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[alerts] Resend rejected: ${res.status} ${body.slice(0, 200)}`);
      return;
    }
    await markSent(env.STORIES as unknown as R2Lite, provider, kind);
  } catch (e) {
    console.warn(`[alerts] send failed: ${(e as Error).message}`);
  }
}

// Exported only for tests.
export const __shouldSendForTest = shouldSend;
export const __markSentForTest = markSent;
```

- [ ] **Step 5: Run, confirm pass**

Run: `cd apps/web && npx vitest run ../../functions/api/_lib/alerts.test.ts --reporter=basic`
Expected: 10 tests pass.

- [ ] **Step 6: Wrap each upstream provider**

For each of `functions/api/_lib/anthropic.ts`, `tts.ts`, `moderation.ts`, `fal.ts`: at every `fetch(...)` call, after detecting a non-OK response (existing code does this), classify and notify:

Pattern:
```ts
import { classifyError, notifyAdminFailure } from './alerts';
// ...
const res = await fetch(...);
if (!res.ok) {
  const detail = await res.text();
  const kind = classifyError(res.status);
  if (kind) await notifyAdminFailure(env, '<provider>', kind, `${res.status}: ${detail.slice(0, 500)}`);
  throw new Error(`<existing message>`);
}
```

Provider strings:
- `anthropic.ts` → provider `'anthropic'`
- `tts.ts` → provider `'openai'` (both TTS and Whisper calls)
- `moderation.ts` → provider `'openai'`
- `fal.ts` → provider `'fal'`

Be precise: the existing throw messages and `detail.slice(0, 300)` truncations must stay unchanged. Only insert the alert call between the failure detection and the throw.

For thrown/network errors (no res object), wrap the fetch in try/catch and notify with `kind = 'network_error'`:
```ts
let res: Response;
try { res = await fetch(...); }
catch (e) {
  await notifyAdminFailure(env, '<provider>', 'network_error', (e as Error).message);
  throw e;
}
```
Apply this pattern only at the outermost fetch in each helper. Don't catch errors inside JSON parsing — those are bugs, not alerts.

- [ ] **Step 7: Update env files + docs**

In `.env.example`, append:
```
# Resend (admin alerting). Optional. If unset, upstream-API failure
# alerts log to stderr instead of emailing.
RESEND_API_KEY=
```

In `README.md`, under "Required environment variables", add to the Optional list:
- `RESEND_API_KEY`: enables admin failure-alert emails (Resend). Send-from is `onboarding@resend.dev`; to use a custom domain, verify it in the Resend dashboard and update `SENDER` in `functions/api/_lib/alerts.ts`.

- [ ] **Step 8: Typecheck + full tests**

Run: `npm run typecheck && cd apps/web && npx vitest run --reporter=basic`
Expected: PASS for typecheck and all tests (existing + new alerts tests).

- [ ] **Step 9: Commit**

```bash
git add functions/api/_lib/alerts.ts functions/api/_lib/alerts.test.ts functions/api/_lib/env.ts functions/api/_lib/anthropic.ts functions/api/_lib/tts.ts functions/api/_lib/moderation.ts functions/api/_lib/fal.ts .env.example README.md
git commit -m "Add admin email alerts via Resend for upstream API failures"
```

---

## Self-review notes

- Spec coverage: every spec section maps to one or more tasks above (model in T1+T2; creatorId server+client in T3+T8; create stamps in T4; delete enforcement in T5; listed filter in T6; updateStoryListing in T7; main.tsx seed in T9; i18n in T10+T11+T12; HomePage filter in T13; StoryPage owner-gated delete+listed in T14; translate helper in T15; translate endpoint in T16; translate UI in T17; logo in T18; share in T19; audio bar collapse in T20; backfill+verification in T21+T22).
- No placeholders: every code block is complete; no "TBD"/"TODO" steps.
- Type consistency: `Lang` is consistently the 5-member union; `creator_id`/`listed` are optional everywhere they appear; function signatures (`buildAndSaveVersion`, `buildFromAnswers`, `saveGeneratingStub`, `saveFailedVersion`) carry the new fields end-to-end.
- Tests precede implementation for: server creatorId (T3), client creatorId (T8), translate parser (T15). UI tasks rely on typecheck + a final hand-walkthrough (T22).
