# storytime v3 — multilingual, ownership, sharing, and a real logo

**Date:** 2026-05-27
**Owner:** Tom Caswell
**Status:** Approved, ready for implementation

A feature batch that takes storytime from "two-language, fully-public,
text-brand" to "five-language with translation, owner-gated stories,
shareable links, and an actual logo."

## Goals

1. **Five languages, end to end.** Add Bulgarian (bg), Spanish (Latin
   American), and French (European) alongside the existing English and
   Swedish. Story text, UI chrome, voice narration, and date formatting
   all switch with the chosen language.
2. **Translate an existing story.** A "Translate" action on the story
   page that produces a new story (its own id and link) in the target
   language, reusing the source story's images and original voice id.
3. **Owner-gated stories via a stable creator id.** Each visitor gets a
   stable random id stored in a cookie (mirrored into localStorage).
   New stories stamp it server-side; the delete endpoint enforces a
   match. Seeded defaults are marked `creator_id: "system"` and are
   never deletable.
4. **Story visibility & share.** Stories default to *listed* on the home
   page. Owners can flip a per-story "hide from list" toggle and share
   the link via the native share sheet (or copy-to-clipboard fallback).
   Owners can filter the home page to "Just mine" using the cookie.
5. **A real logo.** Replace the text-only brand with an inline-SVG open
   book (direction A from the brainstorm) sitting to the left of the
   wordmark, in the existing palette.
6. **Collapsible audio bar.** A chevron on the sticky audio bar
   collapses it to a thin strip; preference persists.

## Non-goals

- Real accounts or per-kid identity. The creator-id is one cookie per
  browser; sharing a device shares an identity.
- Server-side rate limiting or abuse mitigation beyond ownership.
- Translating the four seeded default voice-sample MP3s.
- More than 5 languages.
- A scrubber UX richer than the current progress bar.

## Architecture overview

The whole stack stays as-is — Cloudflare Pages Functions in TS, React on
the front, R2 for story JSON and media. The changes are layered into
the existing modules rather than adding new top-level concerns.

```
apps/web/src/
  i18n/strings/{en,sv,bg,es,fr}.ts          # +3 string tables
  i18n/index.tsx                            # Lang = 'en' | 'sv' | 'bg' | 'es' | 'fr'
  creatorId.ts                              # NEW: cookie+localStorage helper
  components/BookLogo.tsx                   # NEW: inline SVG
  components/ShareButton.tsx                # NEW: navigator.share + copy fallback
  components/AudioBar.tsx                   # +collapse toggle
  components/SettingsCog.tsx                # 2-button → 5-pill language picker
  routes/HomePage.tsx                       # +"All / Just mine" filter pill row
  routes/StoryPage.tsx                      # +Share, +Translate, +Listed toggle, owner-gated delete
  routes/CreatePage.tsx                     # 2-button → 5-pill language step
  voices.ts                                 # unchanged
  prefs.ts                                  # +audioBarCollapsed
functions/api/
  _lib/env.ts                               # no changes
  _lib/types.ts                             # StoryVersion +creator_id, +listed
  _lib/storage.ts                           # listStories filters listed === false
  _lib/anthropic.ts                         # LANG_NAMES extended; new translate() helper
  _lib/creatorId.ts                         # NEW: read/parse creator_id cookie
  createStory.ts                            # stamps creator_id from cookie
  deleteStory.ts                            # 403 unless creator_id matches
  updateStoryListing.ts                     # NEW: POST {id, listed}, owner-gated
  translateStory.ts                         # NEW: POST {id, version?, target_language}
  _admin/seedDefault.ts                     # stamps creator_id: "system"
scripts/
  seed-default-stories.ts                   # stamps creator_id: "system", listed: true
  backfill-system-stories.ts                # NEW: one-shot mark Bob/Pip-en/Pip-sv as system
```

## Data model changes

`StoryVersion` (in `functions/api/_lib/types.ts`) gains two optional
fields:

```ts
interface StoryVersion {
  // ...existing
  language: 'en' | 'sv' | 'bg' | 'es' | 'fr';     // widened
  creator_id?: string;     // missing on legacy → treated as "system" (un-deletable)
  listed?: boolean;        // missing → treated as listed (default true)
}
```

The `StoryIndex` listing entry returned by `listStories` gains
`creator_id` so the client can decide locally whether the current user
owns it (for filter + delete-button visibility).

### Migration

Legacy R2 records have neither field. Two protections:

- **Server reads:** missing `creator_id` is normalized to `"system"` in
  `getStory` / `listStories` projections so the rest of the code sees a
  consistent shape.
- **Backfill:** A one-shot `scripts/backfill-system-stories.ts` lists
  every story id, re-writes each with `creator_id: "system"`,
  `listed: true`. Idempotent. Run once after deploy.

## Components

### 1. Languages (en, sv, bg, es, fr)

- `Lang` type widened in `apps/web/src/i18n/index.tsx`.
- `resolveInitialLang` checks `navigator.language` prefix against the 5
  codes; default `'en'`.
- New string tables `bg.ts`, `es.ts`, `fr.ts` mirror the keys in `en.ts`.
  All ~150 keys are translated using Claude in a one-shot script
  (`scripts/translate-i18n.ts`, NEW, idempotent), reviewed by hand
  before commit. The script is committed for repeatability but not run
  in CI.
- `functions/api/_lib/anthropic.ts` `LANG_NAMES` extended:
  ```ts
  const LANG_NAMES = {
    en: 'English',
    sv: 'Swedish',
    bg: 'Bulgarian',
    es: 'simple, warm Spanish (Latin American)',
    fr: 'simple, warm French (European)',
  };
  ```
- `SettingsCog`: replaces the 2-button cog-segmented with a 5-pill
  responsive grid (wraps on narrow). Labels: English / Svenska /
  Български / Español / Français.
- `CreatePage` language step: same 5-pill grid in place of the two big
  buttons.
- `formatDate` (StoryPage): map `lang → locale` for en-US, sv-SE, bg-BG,
  es-419, fr-FR.

### 2. Translation

`POST /api/translateStory`

- **Body:** `{ id: string, version?: number, target_language: Lang }`
- **Behavior:**
  1. Resolve source `StoryVersion` (latest or specified version).
  2. 400 if `target_language === source.language`.
  3. Call `translate(env, source, target_language)` in `anthropic.ts`:
     one prompt that returns `{ title, paragraphs: string[] }` in JSON,
     same shape as the existing pip-sv translation in the admin seeder.
     Image prompts are NOT translated (kept English for the image
     model).
  4. Build a new story:
     - `id = crypto.randomUUID()`
     - `creator_id` = caller's creator_id from cookie (if missing, fall
       back to source's creator_id; if that's also missing, "system").
       This means anyone can translate any story; translation creates
       *their* new story.
     - `voice_id` = source's voice_id (caller can switch later via edit).
     - `paragraphs[i].image_url` = source's image_url (no Fal calls).
     - `paragraphs[i].image_prompt` = source's image_prompt.
     - `language` = target.
     - `listed` = true (default).
     - Title and paragraph text from the translation result.
  5. Run `synthesize()` for narration in the target language (this is
     the expensive step — one TTS + one Whisper call per story).
  6. Save and return the new `StoryVersion`.
- **Errors:** 400 invalid body / same-language; 404 source not found;
  5xx on translation or synth failure.

**UI:** A "Translate" button on `StoryPage` (between Edit and Make
Another). Click → small popover with 4 language pills (excluding the
story's current language). Pick one → POST translateStory → redirect
to `/s/<new id>`. While the call is in flight (~5-15 s), show a spinner
in the popover.

### 3. Creator id & ownership

**Client (`apps/web/src/creatorId.ts`):**

```ts
export function getCreatorId(): string;  // ensures one exists, returns it
```

On first call:
- Read `creator_id` from `document.cookie`.
- If absent, read from `localStorage.storyMaker.creatorId`.
- If absent, generate `crypto.randomUUID()`.
- Always write to both cookie (1-year, SameSite=Lax, Path=/) and
  localStorage so they self-heal.

The cookie is what the API sees. The localStorage mirror is insurance.

**Server (`functions/api/_lib/creatorId.ts`):**

```ts
export function readCreatorId(request: Request): string | null;
```

Parses the `Cookie` header for `creator_id=<uuid>`. Returns null if
missing.

**Stamping on create:**

`createStory.ts` calls `readCreatorId(request)`; if present, attaches
to the new `StoryVersion`. If absent, leaves `creator_id` unset (the
client should always send one, so this is a fallback for edge cases).

**Delete enforcement:**

`deleteStory.ts` reads creator_id from cookie:
- If story's `creator_id === "system"` (or missing) → 403 ("This is a
  default story and can't be deleted").
- If cookie `creator_id !== story.creator_id` → 403.
- Otherwise delete.

**UI:**

`StoryPage` and `HomePage` read the local creator_id and compare to
each story's `creator_id`. The delete button is hidden when not the
owner. The "Listed" toggle is hidden when not the owner.

### 4. Listed flag & home-page filter

**`listed: boolean` on StoryVersion.** Default `true`. Stored at the
version level, but `listStories` only reads each story's latest
version, so a single listed value is effectively per-story.

`functions/api/_lib/storage.ts` `listStories`: filters out
`listed === false`.

**Toggle UI:** A small "Listed ✓ / Hidden" pill button on `StoryPage`,
visible only to the owner. Tap → `POST /api/updateStoryListing
{ id, listed }`. Server validates ownership and updates the latest
version's `listed` field in place (a metadata-only update, no new
version created).

**"All / Just mine" filter on HomePage:** Two pills above the recent
list, only rendered if at least one story in the response has
`creator_id === myCreatorId`. Filter is client-side. Default is "All".

### 5. Share

A `ShareButton` component on `StoryPage`. Click handler:

```ts
const url = window.location.href;
const title = story.title;
if (navigator.share) {
  await navigator.share({ title, url });
} else {
  await navigator.clipboard.writeText(url);
  // flash "Copied!" toast for 2s
}
```

Toast is a small absolutely-positioned div that fades in/out. No new
dependency.

### 6. Open-book logo

A new `BookLogo.tsx` component renders the SVG from the brainstorm
direction A: two-page open book, left page sun yellow, right page
accent pink, deep navy stroke. Sits to the left of the wordmark in
`Layout` header. The component takes an optional `size` prop (default
48px on desktop, scales down on narrow viewports via CSS).

The text wordmark + tagline stay in their current font/colors; only the
glyph is new.

### 7. Audio bar collapse

`AudioBar` gains a "▾" chevron in its top-right corner. Click → toggles
between full and collapsed mode. Collapsed mode shows only ▶︎/⏸︎ +
scrubber on one row (no time display, no extra controls).

Collapse state persisted in `prefs` (`audioBarCollapsed: boolean`,
default false), so the choice survives reloads.

## Data flow examples

### Creating a story (with creator_id)

1. Client: `getCreatorId()` ensures cookie + localStorage have the id.
2. Client: `POST /api/createStory` (cookie attached automatically).
3. Server: `readCreatorId(request)` → uuid.
4. Server: `saveGeneratingStub({..., creator_id, listed: true})`.
5. Server: kicks off `buildFromAnswers` as today.

### Translating a story

1. Client: tap Translate → pick language → POST `/api/translateStory`.
2. Server: load source story, validate target ≠ source language.
3. Server: call Claude with the translate prompt (existing pattern from
   `_admin/seedDefault.translatePipToSwedish`).
4. Server: `buildAndSaveVersion` with new id, reusing image urls and
   voice id, skipping image generation, running synth once for the new
   language.
5. Server returns new story JSON; client navigates to it.

### Deleting (owner)

1. Client: tap Delete → confirm → `POST /api/deleteStory { id }`.
2. Server: load story, compare `creator_id`. Match → delete media +
   versions. Mismatch → 403. Missing/system → 403.

## Error handling

- Translation: any failure in Claude or synth → store the new story
  with `status: 'failed'` and the error message, same as createStory.
- Listed toggle: 403 / 404 surfaces as a small inline error on the
  toggle pill ("Couldn't update — try again").
- Share fallback: if both `navigator.share` and `clipboard.writeText`
  fail (rare), show the URL in a small selectable text input as the
  ultimate fallback.
- Cookie disabled: `document.cookie =` is a no-op silently; the
  localStorage mirror still works, but server-side ownership won't.
  Best-effort: surface a one-time banner on first story creation if
  cookies are blocked.

## Testing strategy

**Unit (vitest):**
- `creatorId.ts` (client): generates a new id when none exists; reads
  cookie when present; mirrors to both stores.
- `_lib/creatorId.ts` (server): parses well-formed and malformed cookie
  headers.
- `anthropic.ts translate()`: with a mocked Claude response, returns
  the parsed shape; throws on shape mismatch.
- `_lib/storage.ts listStories`: filters out `listed: false`.

**Endpoint smoke (manual via curl after deploy):**
- `POST /api/translateStory` for each (source, target) language pair
  (small sample).
- `POST /api/deleteStory` with wrong cookie → 403.
- `POST /api/updateStoryListing` with wrong cookie → 403.

**UI hand-verification (dev server, browser):**
- Settings cog: 5 languages render, switching changes copy.
- Translate flow: pick a language, redirect lands on a story in that
  language.
- Logo: renders in header at sane size on desktop + mobile widths.
- Share button: native share triggers on iOS Safari simulator (or any
  mobile Chrome); falls back to copy toast on desktop.
- Audio bar collapse: state persists across reload.
- Just-mine filter only appears once the visitor has at least one
  cookie-owned story.

## Open questions

None blocking implementation. The known soft edges (kids sharing a
device share an identity, cookie-blocked browsers can't enforce
ownership, translation reuses the source voice which may not match the
new language's typical voice gender expectation) are accepted.

## Rollout

1. Land the data model + creator_id helpers + backfill script first as
   a no-UI-change deploy.
2. Run the backfill against R2 to stamp Bob + Pip-en + Pip-sv with
   `creator_id: "system"`.
3. Land the multilingual i18n + translateStory + UI changes.
4. Re-deploy.
5. Smoke-test all 5 languages on storytime-app.pages.dev.
