# Prompt templates

This document describes the prompts the app sends to the LLM and the image
model. Editing prompts in production means editing the corresponding file
in `functions/api/_lib/`; this doc explains what each prompt is doing
and what to watch for when tuning.

## Story generation (Anthropic Claude)

File: `functions/api/_lib/anthropic.ts`, exported as
`STORY_SYSTEM_PROMPT`.

### Goal

Turn the kid's two to six short answers into a fully structured story in
strict JSON.

### Current system prompt

```
You are a warm, playful storyteller writing for kids ages 5 to 9. Your job is to turn a few simple answers into a short illustrated story.

Strict rules:
- G rated only. No violence, no real fear, no romance, no mean characters, no bathroom humor, no scary monsters.
- Use simple words a 6 year old can understand.
- The story has 5 to 8 short paragraphs. Each paragraph is 2 to 4 sentences.
- Include a small, age appropriate problem and a kind, satisfying ending.
- Keep the tone warm and a little playful.
- Do not use hyphens or em dashes or emojis. Prefer commas and periods.
- Output strict JSON. No prose outside the JSON. No code fences.

JSON shape:
{
  "title": "A short, fun title under 8 words",
  "paragraphs": [
    {
      "text": "The paragraph text.",
      "image_prompt": "One sentence describing the scene for a cartoon illustrator. Bright colors, friendly faces, cartoon style, no text in the image."
    }
  ]
}

Image prompts: describe one clear scene per paragraph in cartoon style, child friendly, around 20 words. Mention the main character and the setting each time so the illustrator stays consistent.
```

### User message

```
Here are the kid's answers. Use them to write the story.

<question 1>
<answer 1>

<question 2>
<answer 2>

...

Return only the JSON object.
```

### Things to watch when tuning

* If stories run long, lower `max_tokens` (currently 2500) or tighten the
  paragraph limit in the prompt.
* If JSON parsing keeps failing, add a one shot example. The fallback
  parser already trims to the first `{` and last `}`, but very chatty
  models can still slip in commentary inside the JSON.
* If the model keeps emitting hyphens or em dashes, add a stronger ban or
  do a post processing pass.
* To make characters more consistent across illustrations, restate the
  hero's name and description in every image prompt explicitly.

## Image prompts (Fal.ai flux/schnell)

File: `functions/api/_lib/fal.ts`.

The prompt the model gets is the per paragraph `image_prompt` from the
story step, plus a constant suffix:

```
<paragraph image prompt>. Cartoon style, bright colors, friendly faces, child friendly illustration, no text in the image, no words.
```

### Things to watch

* If text artifacts keep appearing in the images, strengthen the no text
  clause or post filter.
* If style drifts between paragraphs, prepend a fixed style header (for
  example "Storybook cartoon, soft outlines, watercolor textures") and
  make sure every image_prompt names the hero and the setting.
* `num_inference_steps` is set to 4 (schnell default). Bumping to 8 makes
  images more detailed at roughly double the cost.

## Image prompt regeneration (Claude, edit flow)

File: `functions/api/_lib/anthropic.ts`, function
`regenerateImagePrompt`.

Used when a kid edits a paragraph and asks for a new illustration. The
system prompt is short:

```
Return one short sentence describing the scene for a cartoon illustrator. Bright colors, friendly faces, cartoon style, no text in the image. Around 20 words. No quotes, no prefix.
```

The user message is just the story title and the new paragraph text.

## Narration (OpenAI TTS + Whisper alignment)

File: `functions/api/_lib/tts.ts`.

There is no LLM prompt for narration. The full story text is concatenated
and sent to `tts-1` with the picked voice:

```
model: tts-1
voice: onyx | nova | shimmer | echo  (mapped from Daniel | Rachel | Sanna | Adam)
response_format: mp3
```

The returned MP3 is then sent to `whisper-1` with word-level timestamps
to drive the karaoke-style word highlight on the story page:

```
model: whisper-1
response_format: verbose_json
timestamp_granularities: ["word"]
prompt: <first 224 chars of the source>  // biases Whisper toward source spellings
```

### Drift mitigation

Whisper transcribes the audio, not the source. Names, contractions, and
multilingual words can come back slightly different. `alignWhisperToSource`
pairs Whisper words to source words via Needleman-Wunsch (match=2,
mismatch=0, gap=-1), uses each matched word's start/end as a hard anchor,
and linearly interpolates per-character times between anchors. Whisper
words with no source match are dropped; source words with no Whisper match
get their times from the surrounding anchors. The result is a
`CharacterAlignment` over the source text, the shape `charsToWords` (the
old ElevenLabs alignment consumer) already expects.

### Things to watch

* Unknown voice ids (e.g., legacy ElevenLabs ids on old stories) fall back
  to `nova` so the audio still plays.
* If `tts-1` quality is too flat, try `tts-1-hd` (slower, ~2x cost).
* If the highlight drifts on long stories, the issue is almost always at
  Whisper word boundaries; check `wh.words` against the source text in
  isolation before tweaking the alignment scoring.
