# storytime

A small web app that lets kids make their own illustrated, narrated stories in English or Swedish.

A kid picks a language, answers a few simple questions (by voice or by typing), and the app writes a short story, draws a cartoon for each paragraph, and reads it out loud. Each story gets its own link, and stories can be edited into new versions later.

Built with love by Uncle Tom for Brennan and Linnéa's birthdays.

Live at [https://storytime-app.pages.dev](https://storytime-app.pages.dev).

## How it works

1. Home screen: explainer, big "Start a new story" button, and a carousel of
   recent stories.
2. Create flow (`/create`): the app asks two to six adaptive questions.
   Required: who is the hero, where does it happen, what does the hero want.
   Optional follow ups: friend or helper, the problem, the ending style.
   Each question is read aloud (browser speech synthesis) and accepts either
   spoken answers (Web Speech API) or typed answers (always available).
3. After the kid taps "Make my story":
   * Inputs are screened with OpenAI moderation.
   * Claude (Sonnet 4.6) writes a 5 to 8 paragraph G rated story.
   * The generated text is moderated again before saving.
   * For each paragraph, Fal flux/schnell draws a cartoon illustration.
   * The full text is synthesized into an MP3 narration with OpenAI
     `tts-1`, and Whisper (`whisper-1`) aligns the audio back to the source
     text to drive the word-by-word karaoke highlight.
   * Everything is saved to Cloudflare R2 and the user is redirected to
     `/s/:id`.
4. Story page (`/s/:id` or `/s/:id/v/:n`): shows the title, audio bar,
   paragraph text, and an illustration for each paragraph. Old versions are
   linked at the top.
5. Edit page (`/s/:id/edit`): edit the title and any paragraph text, and
   optionally regenerate any illustration. Saving creates a new version
   (v2, v3, ...). Old versions stay accessible.

## Stack

* Frontend: Vite, React 18, TypeScript, plain CSS, React Router.
* Backend: Cloudflare Pages Functions (TypeScript, Workers runtime).
* Storage: Cloudflare R2 — one bucket for story JSON, one for media.
* Story text: Anthropic Claude (default model: claude-sonnet-4-6).
* Images: Fal.ai flux/schnell (square_hd, cartoon style).
* Narration: OpenAI `tts-1`. Four voice slots map to OpenAI voices
  (Daniel→onyx, Rachel→nova, Sanna→shimmer, Adam→echo).
* Word timing: OpenAI Whisper (`whisper-1`) with `timestamp_granularities`.
* Moderation: OpenAI omni-moderation-latest.
* Speech in the browser: SpeechSynthesis (TTS for questions) and Web Speech
  API (STT for answers, with a typed fallback).
* Languages: English and Swedish, picked per story. UI language is bilingual
  and detected from the browser, overridable via the settings cog.

The old Netlify site issues a permanent 301 to the Cloudflare URL so legacy
story links keep working; see `netlify.toml`.

## Repository layout

```
apps/web/                Vite React app (the UI)
functions/api/           Cloudflare Pages Functions (one file per endpoint)
functions/api/_lib/      Shared helpers (storage, LLM, TTS, moderation)
scripts/                 Standalone Node scripts (seed, revert)
docs/PROMPTS.md          Prompt templates with notes for tuning
wrangler.toml            Cloudflare Pages config (R2 bindings, build dir)
netlify.toml             Permanent redirect from the old Netlify origin
.env.example             Required environment variables
```

## Required environment variables

On the Cloudflare Pages project set these as secrets via
`wrangler pages secret put NAME`:

* `ANTHROPIC_API_KEY`: Claude story generation.
* `OPENAI_API_KEY`: OpenAI moderation, TTS (`tts-1`), and Whisper alignment.
* `FAL_KEY`: Fal.ai image generation.

Optional:

* `ANTHROPIC_MODEL`: override the default model.
* `RESEND_API_KEY`: enables admin failure-alert emails (Resend). Send-from is `onboarding@resend.dev`; to use a custom domain, verify it in the Resend dashboard and update `SENDER` in `functions/api/_lib/alerts.ts`.

For local development put the same three keys in a top-level `.env` file
(gitignored). `wrangler pages dev` reads `.env` automatically.

The seed script needs three additional values to talk to R2 from a Node
process; see `.env.example`:

* `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — R2
  S3-compatible API credentials, created under R2 → Manage R2 API Tokens
  with read+write on both buckets.

## Run locally

```bash
npm install
# Fill .env with the four API keys.
npm run dev
```

`wrangler pages dev` serves the Vite build on http://localhost:8788, runs
the Pages Functions in `functions/api/`, and provides a local R2 emulation
for the `STORIES` and `MEDIA` bindings.

## Seeding default content

Two one-shot scripts populate the home page with seed content:

```bash
# Generate the 4 voice-sample MP3s for the voice picker. Run once,
# then commit the result.
npm run seed:samples
git add apps/web/public/voice-samples/
git commit -m "Add voice samples"

# Seed Bob's Big Butter Adventure (en) and Pip Draken (sv) as defaults.
# Idempotent; re-running overwrites the same fixed ids.
npm run seed:stories                  # both
npm run seed:stories -- --only=bob    # just Bob
npm run seed:stories -- --only=pip    # just Pip (sv)
```

`seed:stories` reads `.env` and additionally requires the three `R2_*`
values listed above so it can write directly to the production R2 buckets
over the S3-compatible API.

## Deploy

The Cloudflare Pages project is `storytime-app`. First-time setup:

```bash
# Create the project (one-time).
npx wrangler pages project create storytime-app --production-branch main

# Create the R2 buckets (one-time, names match wrangler.toml).
npx wrangler r2 bucket create story-maker-stories
npx wrangler r2 bucket create story-maker-media

# Put each secret (one per command).
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name storytime-app
npx wrangler pages secret put OPENAI_API_KEY    --project-name storytime-app
npx wrangler pages secret put FAL_KEY           --project-name storytime-app
```

After that, deploy from a fresh checkout with:

```bash
npm run build
npm run deploy
```

R2 bucket bindings are declared in `wrangler.toml` and attach automatically.

## API endpoints

All under `/api/` on the deployed site:

* `POST createStory`: body `{ answers: [{ question, answer }], language,
  voice_id? }`, returns the new `StoryVersion` (v1).
* `GET  getStory?id=...&version=...`: returns a `StoryVersion`.
* `POST updateStory`: body `{ id, title, paragraphs: [{ text, image_url,
  regenerate_image }], summary? }`, returns the new `StoryVersion` (v + 1).
* `POST deleteStory`: body `{ id }`, deletes every version and all media.
* `GET  listStories`: returns up to 30 recent `StoryIndex` records.
* `POST moderate`: body `{ text }`, returns `{ flagged, reasons }`.
* `POST askVoice`: body `{ text, language, voiceId?, speed? }`, returns
  `audio/mpeg` for the create-flow question prompts.
* `GET  media?key=...`: streams a stored image or audio file.

## Style notes

* No accounts. Stories are public by link. A future version can add per kid
  namespacing.
* All copy is plain and warm. No hyphens or em dashes in user facing text.
* Big buttons, big text, friendly pastel palette, sticky audio bar.

## Known follow ups (v1 cuts)

* No accounts or per kid namespacing.
* Audio is regenerated on every save (no partial reuse).
* No per image regenerate button on the view page; you have to go through
  edit mode to redraw one image.
* No scrubber UX beyond the native audio control.
* `createStory` is synchronous and depends on each upstream API responding
  before the Workers subrequest cap is hit. If end-to-end latency grows,
  switch to a queued / background worker.
