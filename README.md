# Brennan's Story Maker

A small web app that lets kids make their own illustrated, narrated stories.
A kid answers a few simple questions (by voice or by typing), and the app
writes a short story, draws a cartoon for each paragraph, and reads it out
loud. Each story gets its own link, and stories can be edited into new
versions later.

Built for Brennan, by Tom Caswell.

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
   * The full text is synthesized into an MP3 narration with ElevenLabs
     using the Daniel voice.
   * Everything is saved to Netlify Blobs and the user is redirected to
     `/s/:id`.
4. Story page (`/s/:id` or `/s/:id/v/:n`): shows the title, audio bar,
   paragraph text, and an illustration for each paragraph. Old versions are
   linked at the top.
5. Edit page (`/s/:id/edit`): edit the title and any paragraph text, and
   optionally regenerate any illustration. Saving creates a new version
   (v2, v3, ...). Old versions stay accessible.

## Stack

* Frontend: Vite, React 18, TypeScript, plain CSS, React Router.
* Backend: Netlify Functions (TypeScript, esbuild bundler).
* Storage: Netlify Blobs (one namespace for story JSON, one for media).
* Story text: Anthropic Claude (default model: claude-sonnet-4-6).
* Images: Fal.ai flux/schnell (square_hd, cartoon style).
* Narration: ElevenLabs Daniel voice (voice id onwK4e9ZLuTAKqWW03oN).
* Moderation: OpenAI omni-moderation-latest.
* Speech in the browser: SpeechSynthesis (TTS for questions) and Web Speech
  API (STT for answers, with a typed fallback).

## Repository layout

```
apps/web/                Vite React app (the UI)
netlify/functions/       Serverless API (one file per endpoint)
netlify/functions/_lib/  Shared helpers (storage, LLM, TTS, moderation)
docs/PROMPTS.md          Prompt templates with notes for tuning
netlify.toml             Build, dev, and functions config
.env.example             Required environment variables
```

## Required environment variables

Set these on the Netlify site (or in a local `.env` for `netlify dev`):

* `ANTHROPIC_API_KEY`: Claude story generation.
* `OPENAI_API_KEY`: OpenAI moderation API.
* `FAL_KEY`: Fal.ai image generation.
* `ELEVENLABS_API_KEY`: ElevenLabs narration.

Optional:

* `ANTHROPIC_MODEL`: override the default model.
* `ELEVENLABS_VOICE_ID`: override the default voice (Daniel).

## Run locally

```bash
npm install
# Put the four keys above into a top level .env file (gitignored).
npx netlify dev
```

The dev server serves the Vite app on http://localhost:8888 and proxies
`/.netlify/functions/*` to the local functions runtime.

## Deploy

The repo is wired to deploy on Netlify. After the first push:

1. Link the GitHub repo as the site source on Netlify.
2. Set the four env vars on the site.
3. Trigger a deploy.

The included `netlify.toml` already configures the build command, publish
directory, and functions directory.

## API endpoints

All under `/.netlify/functions/`:

* `POST createStory`: body `{ answers: [{ question, answer }] }`, returns
  the new `StoryVersion` (v1).
* `GET getStory?id=...&version=...`: returns a `StoryVersion`.
* `POST updateStory`: body `{ id, title, paragraphs: [{ text, image_url,
  regenerate_image }] }`, returns the new `StoryVersion` (v + 1).
* `GET listStories`: returns up to 30 recent `StoryIndex` records.
* `POST moderate`: body `{ text }`, returns `{ flagged, reasons }`.
* `GET media?key=...`: streams a stored image or audio file.

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
* Background story generation is synchronous and depends on each API
  responding within the Netlify function timeout (~26 seconds). If stories
  start timing out, switch `createStory` to a background function and add a
  small polling loop in the UI.
