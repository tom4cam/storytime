// Per-paragraph narration synthesis with cross-version reuse.
//
// On every save we hash each paragraph's text + voice. If a paragraph's
// hash matches the same-index paragraph from the prior version, we reuse
// the prior per-paragraph MP3 + CharacterAlignment instead of asking the
// TTS provider for the bytes again. The full-narration MP3 is built by
// byte-concatenating the per-paragraph clips, and the full alignment by
// offsetting each clip's character timings by the cumulative duration.
//
// Both ElevenLabs `mp3_44100_128` and OpenAI `tts-1` produce raw CBR MPEG
// frames that concatenate cleanly without re-encoding.

import type { Env } from './env';
import type { Paragraph, WordTiming } from './types';
import type { CharacterAlignment } from './words';
import { synthesize } from './tts';
import { charsToWords } from './words';
import { storeMedia, readMedia } from './storage';

export interface ParagraphAudio {
  url: string;
  hash: string;
  chars: CharacterAlignment;
}

export interface StoryNarration {
  narrationUrl: string;
  words: WordTiming[];
  perParagraph: ParagraphAudio[];
}

export async function hashParagraph(voiceId: string | undefined, text: string): Promise<string> {
  const input = `${voiceId ?? ''}:${text}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (const b of arr) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function mediaKeyFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = /[?&]key=([^&]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

async function loadPriorAudio(
  env: Env,
  prior: Paragraph | undefined,
): Promise<ArrayBuffer | null> {
  const key = mediaKeyFromUrl(prior?.narration_url);
  if (!key) return null;
  const blob = await readMedia(env, key);
  return blob?.data ?? null;
}

export function __stitchAlignments(
  paragraphs: string[],
  perPara: CharacterAlignment[],
  joiner = '\n\n',
): CharacterAlignment {
  return stitchAlignments(paragraphs, perPara, joiner);
}

function stitchAlignments(
  paragraphs: string[],
  perPara: CharacterAlignment[],
  joiner = '\n\n',
): CharacterAlignment {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < perPara.length; i += 1) {
    const a = perPara[i];
    for (let k = 0; k < a.characters.length; k += 1) {
      chars.push(a.characters[k]);
      starts.push((a.character_start_times_seconds[k] ?? 0) + cumulative);
      ends.push((a.character_end_times_seconds[k] ?? 0) + cumulative);
    }
    const dur = a.character_end_times_seconds[a.character_end_times_seconds.length - 1] ?? 0;
    cumulative += dur;
    if (i < perPara.length - 1) {
      for (const c of joiner) {
        chars.push(c);
        starts.push(cumulative);
        ends.push(cumulative);
      }
    }
  }
  void paragraphs; // referenced only via the joiner pattern above
  return {
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

function concatMp3s(parts: ArrayBuffer[]): ArrayBuffer {
  const total = parts.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of parts) {
    out.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return out.buffer;
}

export async function synthesizeStory(
  env: Env,
  storyId: string,
  version: number,
  paragraphs: string[],
  voiceId: string | undefined,
  previous?: Paragraph[],
): Promise<StoryNarration> {
  const hashes = await Promise.all(paragraphs.map((t) => hashParagraph(voiceId, t)));

  // Plan reuse per paragraph index. A reused paragraph carries its prior
  // URL forward (multiple StoryVersions can reference the same R2 key);
  // a missed paragraph is synthesised below.
  type PlanItem =
    | { kind: 'reuse'; url: string; hash: string; chars: CharacterAlignment }
    | { kind: 'synth'; text: string; hash: string; index: number };
  const plan: PlanItem[] = paragraphs.map((text, i) => {
    const prior = previous?.[i];
    if (
      prior &&
      prior.narration_hash &&
      prior.narration_hash === hashes[i] &&
      prior.narration_url &&
      prior.narration_chars &&
      prior.narration_chars.characters?.length > 0
    ) {
      return {
        kind: 'reuse',
        url: prior.narration_url,
        hash: hashes[i],
        chars: prior.narration_chars,
      };
    }
    return { kind: 'synth', text, hash: hashes[i], index: i };
  });

  // Fire all synth calls in parallel.
  const synthTargets = plan
    .map((p, i) => (p.kind === 'synth' ? { plan: p, idx: i } : null))
    .filter((x): x is { plan: Extract<PlanItem, { kind: 'synth' }>; idx: number } => !!x);

  const synthResults = await Promise.all(
    synthTargets.map(async (t) => {
      const { audio, alignment } = await synthesize(env, t.plan.text, { voiceId });
      const key = `${storyId}-v${version}-p${t.idx + 1}.mp3`;
      const url = await storeMedia(env, key, audio, 'audio/mpeg');
      return { idx: t.idx, audio, alignment, url };
    }),
  );

  const perParagraph: ParagraphAudio[] = new Array(plan.length);
  const audioParts: ArrayBuffer[] = new Array(plan.length);

  for (const r of synthResults) {
    perParagraph[r.idx] = { url: r.url, hash: hashes[r.idx], chars: r.alignment };
    audioParts[r.idx] = r.audio;
  }

  // Reused paragraphs: pull their bytes out of R2 so we can rebuild the
  // concatenated narration MP3. The alignment is already in hand.
  await Promise.all(
    plan.map(async (p, i) => {
      if (p.kind !== 'reuse') return;
      perParagraph[i] = { url: p.url, hash: p.hash, chars: p.chars };
      const bytes = await loadPriorAudio(env, previous?.[i]);
      if (!bytes) {
        // R2 lost the per-paragraph clip — fall back to a fresh synth so
        // the build never silently produces a story missing audio.
        const { audio, alignment } = await synthesize(env, paragraphs[i], { voiceId });
        const key = `${storyId}-v${version}-p${i + 1}.mp3`;
        const url = await storeMedia(env, key, audio, 'audio/mpeg');
        perParagraph[i] = { url, hash: hashes[i], chars: alignment };
        audioParts[i] = audio;
        return;
      }
      audioParts[i] = bytes;
    }),
  );

  const fullAudio = concatMp3s(audioParts);
  const narrationKey = `${storyId}-v${version}.mp3`;
  const narrationUrl = await storeMedia(env, narrationKey, fullAudio, 'audio/mpeg');

  const stitched = stitchAlignments(paragraphs, perParagraph.map((p) => p.chars));
  const words = charsToWords(paragraphs, stitched);

  return { narrationUrl, words, perParagraph };
}
