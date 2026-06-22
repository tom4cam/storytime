// Text-to-speech + character-level alignment.
//
// Provider preference: ElevenLabs first (when ELEVENLABS_API_KEY is set),
// OpenAI as the always-available fallback.
//
// ElevenLabs returns audio + character alignment in a single
// /with-timestamps call, so no second STT pass is needed. Its alignment
// shape (characters, character_start_times_seconds, character_end_times_seconds)
// maps 1:1 to our CharacterAlignment.
//
// OpenAI pipeline (fallback): text → /v1/audio/speech (tts-1) → MP3,
// then MP3 → /v1/audio/transcriptions (whisper-1, word timestamps).
// Whisper transcribes the audio, not the source, so word strings can drift
// (names, contractions, multilingual). alignWhisperToSource pairs Whisper
// words back to source words via Needleman-Wunsch and produces a
// CharacterAlignment over the source text, which is the shape downstream
// charsToWords expects.

import type { Env } from './env';
import type { CharacterAlignment } from './words';
import { requireEnv } from './env';
import { classifyError, notifyAdminFailure } from './alerts';
import { recordCost } from './costs';
import { fetchWithRetry } from './retry';
import { recordCall } from './telemetry';

const OPENAI_TTS_DEFAULT_MODEL = 'tts-1';
const OPENAI_STT_MODEL = 'whisper-1';
// Fable is the only British male voice in OpenAI's preset list. Matches
// the ElevenLabs default (Daniel, also British male) so the two providers
// stay in the same vocal register when one falls back to the other.
const OPENAI_DEFAULT_VOICE = 'fable';
const OPENAI_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
// Models that accept the `instructions` field for voice steering.
const OPENAI_STEERABLE_MODELS = new Set(['gpt-4o-mini-tts', 'gpt-4o-tts']);
const OPENAI_DEFAULT_STEERING =
  'Read aloud as a warm, gentle British storyteller. ' +
  'Soft RP accent, calm pacing, expressive but not theatrical — ' +
  'as if reading a bedtime story to a child.';
// Rough USD/char for budgeting. tts-1: $15/1M chars. gpt-4o-mini-tts is
// billed per token (text in + audio out); ~$18/1M source chars is a
// conservative blended estimate. Exact billing comes from OpenAI invoices.
const OPENAI_TTS_COST_PER_CHAR: Record<string, number> = {
  'tts-1': 15e-6,
  'tts-1-hd': 30e-6,
  'gpt-4o-mini-tts': 18e-6,
  'gpt-4o-tts': 30e-6,
};

const ELEVENLABS_TTS_MODEL = 'eleven_flash_v2_5';
// Fallback ElevenLabs voice when ELEVENLABS_VOICE_ID is unset and the
// caller didn't supply an EL-style voice id. "Daniel" — see .env example.
const ELEVENLABS_DEFAULT_VOICE = 'onwK4e9ZLuTAKqWW03F9';

export interface SynthResult {
  audio: ArrayBuffer;
  alignment: CharacterAlignment;
}

export interface SynthOpts {
  voiceId?: string;
  speed?: number;
}

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperResponse {
  duration?: number;
  words?: WhisperWord[];
  text?: string;
}

interface ElevenLabsResponse {
  audio_base64: string;
  alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
  normalized_alignment?: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

export async function synthesize(env: Env, text: string, opts: SynthOpts = {}): Promise<SynthResult> {
  if (env.ELEVENLABS_API_KEY) {
    try {
      return await synthesizeWithElevenLabs(env, text, opts);
    } catch (e) {
      // Surface to logs so we know the fallback fired, but don't propagate —
      // the user-facing call should keep working as long as OpenAI is up.
      console.warn(`[tts] ElevenLabs failed, falling back to OpenAI: ${(e as Error).message}`);
    }
  }
  return synthesizeWithOpenAI(env, text, opts);
}

async function synthesizeWithElevenLabs(env: Env, text: string, opts: SynthOpts): Promise<SynthResult> {
  const apiKey = requireEnv(env, 'ELEVENLABS_API_KEY');
  const voiceId = pickElevenLabsVoice(env, opts.voiceId);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`;

  let res: Response;
  try {
    res = await recordCall(env, 'elevenlabs', 'tts', () =>
      fetchWithRetry(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_TTS_MODEL,
          output_format: 'mp3_44100_128',
        }),
      }, { attempts: 2 })
    );
  } catch (e) {
    await notifyAdminFailure(env, 'elevenlabs', 'network_error', (e as Error).message);
    throw e;
  }
  if (!res.ok) {
    const detail = await res.text();
    const kind = classifyError(res.status);
    if (kind) await notifyAdminFailure(env, 'elevenlabs', kind, `${res.status}: ${detail.slice(0, 500)}`);
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as ElevenLabsResponse;
  if (!body.audio_base64) throw new Error('ElevenLabs response missing audio_base64');

  const audio = decodeBase64ToArrayBuffer(body.audio_base64);
  const alignment = elevenLabsAlignment(text, body);
  // ElevenLabs Flash v2.5 published rate is ~$30 per 1M characters. This is
  // an estimate for budgeting; exact billing depends on plan + credit usage.
  void recordCost(env, 'elevenlabs', 'tts', text.length * 30e-6);
  return { audio, alignment };
}

async function synthesizeWithOpenAI(env: Env, text: string, opts: SynthOpts): Promise<SynthResult> {
  const apiKey = requireEnv(env, 'OPENAI_API_KEY');
  const voice = pickOpenAIVoice(opts.voiceId);
  const model = env.OPENAI_TTS_MODEL || OPENAI_TTS_DEFAULT_MODEL;
  const steerable = OPENAI_STEERABLE_MODELS.has(model);
  const instructions = steerable
    ? (env.OPENAI_TTS_INSTRUCTIONS || OPENAI_DEFAULT_STEERING)
    : undefined;

  let ttsRes: Response;
  try {
    ttsRes = await recordCall(env, 'openai', 'tts', () =>
      fetchWithRetry('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          voice,
          input: text,
          response_format: 'mp3',
          ...(instructions ? { instructions } : {}),
          ...(opts.speed != null ? { speed: opts.speed } : {}),
        }),
      })
    );
  } catch (e) {
    await notifyAdminFailure(env, 'openai', 'network_error', (e as Error).message);
    throw e;
  }
  if (!ttsRes.ok) {
    const detail = await ttsRes.text();
    const kind = classifyError(ttsRes.status);
    if (kind) await notifyAdminFailure(env, 'openai', kind, `${ttsRes.status}: ${detail.slice(0, 500)}`);
    throw new Error(`OpenAI TTS failed (${ttsRes.status}): ${detail.slice(0, 300)}`);
  }
  const audio = await ttsRes.arrayBuffer();

  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'narration.mp3');
  form.append('model', OPENAI_STT_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  // Bias Whisper toward the source spellings / names. 224 tokens is the
  // documented prompt cap; chars is a conservative proxy.
  form.append('prompt', text.slice(0, 224));

  let whRes: Response;
  try {
    whRes = await recordCall(env, 'openai', 'whisper', () =>
      fetchWithRetry('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      })
    );
  } catch (e) {
    await notifyAdminFailure(env, 'openai', 'network_error', (e as Error).message);
    throw e;
  }
  if (!whRes.ok) {
    const detail = await whRes.text();
    const kind = classifyError(whRes.status);
    if (kind) await notifyAdminFailure(env, 'openai', kind, `${whRes.status}: ${detail.slice(0, 500)}`);
    throw new Error(`OpenAI Whisper failed (${whRes.status}): ${detail.slice(0, 300)}`);
  }
  const wh = (await whRes.json()) as WhisperResponse;

  const alignment = alignWhisperToSource(text, wh.words ?? [], { totalDuration: wh.duration });
  const ratePerChar = OPENAI_TTS_COST_PER_CHAR[model] ?? OPENAI_TTS_COST_PER_CHAR['tts-1'];
  void recordCost(env, 'openai', 'tts', text.length * ratePerChar);
  return { audio, alignment };
}

function pickOpenAIVoice(voiceId: string | undefined): string {
  if (voiceId && OPENAI_VOICES.has(voiceId)) return voiceId;
  // ElevenLabs-style ids (and anything unknown) fall back to nova so old
  // stories and EL-only voice choices keep playing on the OpenAI path.
  return OPENAI_DEFAULT_VOICE;
}

function pickElevenLabsVoice(env: Env, voiceId: string | undefined): string {
  // OpenAI preset names aren't EL voice ids — substitute the env default.
  if (voiceId && !OPENAI_VOICES.has(voiceId)) return voiceId;
  return env.ELEVENLABS_VOICE_ID || ELEVENLABS_DEFAULT_VOICE;
}

function decodeBase64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Re-key ElevenLabs' alignment back to the original `text`. ElevenLabs
// usually returns the source characters verbatim, but if normalization
// trimmed or expanded the input (e.g. number expansion: "5" → "five")
// we fall back to interpolating timings across the original text.
function elevenLabsAlignment(text: string, body: ElevenLabsResponse): CharacterAlignment {
  const a = body.alignment ?? body.normalized_alignment;
  const source = [...text];
  if (!a || !a.characters || a.characters.length === 0) {
    return {
      characters: source,
      character_start_times_seconds: new Array(source.length).fill(0),
      character_end_times_seconds: new Array(source.length).fill(0),
    };
  }
  if (a.characters.length === source.length && a.characters.join('') === text) {
    // Exact length match: pass through directly.
    return {
      characters: source,
      character_start_times_seconds: a.character_start_times_seconds.slice(),
      character_end_times_seconds: a.character_end_times_seconds.slice(),
    };
  }
  // Length mismatch — interpolate to fit. Use the same machinery that
  // backstops Whisper so the downstream charsToWords contract holds.
  const totalDur = a.character_end_times_seconds[a.character_end_times_seconds.length - 1] ?? 0;
  return alignWhisperToSource(text, [], { totalDuration: totalDur });
}

// --- alignment -------------------------------------------------------------

interface AlignOpts {
  totalDuration?: number;
}

interface SourceToken {
  raw: string;
  normalized: string;
  startChar: number;
  endChar: number;
}

export function alignWhisperToSource(
  source: string,
  whisper: WhisperWord[],
  opts: AlignOpts = {}
): CharacterAlignment {
  const characters = [...source];
  const n = characters.length;
  if (n === 0) {
    return { characters, character_start_times_seconds: [], character_end_times_seconds: [] };
  }

  const tokens = tokenize(source);
  const totalDur = opts.totalDuration ?? (whisper.length > 0 ? whisper[whisper.length - 1].end : 0);

  const boundary: (number | null)[] = new Array(n + 1).fill(null);
  boundary[0] = 0;
  boundary[n] = totalDur;

  let usedWhisperAnchors = 0;
  if (whisper.length > 0 && tokens.length > 0 && totalDur > 0) {
    const matched = alignSequences(
      tokens.map((t) => t.normalized),
      whisper.map((w) => normalize(w.word))
    );
    // Validate each matched Whisper anchor against a character-uniform
    // baseline derived from totalDur. Anchors whose timestamps disagree
    // with their source character position by more than `tol` are dropped.
    // This protects against the failure mode where Whisper loses a chunk
    // of audio (e.g. a quiet intro) and reports surviving words starting
    // at t=0, which would otherwise stamp a long run of leading source
    // characters with boundary=0 via interpolation.
    let lastAcceptedEnd = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      const m = matched[i];
      if (m < 0) continue;
      const tok = tokens[i];
      const w = whisper[m];
      const expectedStart = (tok.startChar / n) * totalDur;
      const expectedEnd = (tok.endChar / n) * totalDur;
      // Tolerance: max(3s, 40% of the larger expected timestamp). The 3s
      // floor keeps short stories permissive; the 40% scales for long ones.
      const tol = Math.max(3, Math.max(expectedStart, expectedEnd) * 0.4);
      if (Math.abs(w.start - expectedStart) > tol) continue;
      if (Math.abs(w.end - expectedEnd) > tol) continue;
      // Monotonicity: an anchor that moves backwards in time vs the last
      // accepted anchor is almost certainly Whisper losing track of the
      // clock. Drop it rather than letting interpolation flip.
      if (w.start + 0.05 < lastAcceptedEnd) continue;
      boundary[tok.startChar] = w.start;
      boundary[tok.endChar] = w.end;
      lastAcceptedEnd = w.end;
      usedWhisperAnchors += 1;
    }
  }
  if (usedWhisperAnchors === 0 && tokens.length > 0 && totalDur > 0) {
    // No usable Whisper anchors — fall back to per-token uniform
    // distribution across totalDur. Same as the "no whisper output" path.
    const per = totalDur / tokens.length;
    for (let i = 0; i < tokens.length; i += 1) {
      const s = i * per;
      const e = (i + 1) * per;
      if (boundary[tokens[i].startChar] === null) boundary[tokens[i].startChar] = s;
      if (boundary[tokens[i].endChar] === null) boundary[tokens[i].endChar] = e;
    }
  }

  // Fill unknown boundaries by linear interpolation between known ones.
  let lastKnown = 0;
  for (let b = 1; b <= n; b += 1) {
    if (boundary[b] !== null) {
      const startT = boundary[lastKnown] as number;
      const endT = boundary[b] as number;
      const span = b - lastKnown;
      for (let k = lastKnown + 1; k < b; k += 1) {
        boundary[k] = startT + ((k - lastKnown) / span) * (endT - startT);
      }
      lastKnown = b;
    }
  }

  // Cheap safety pass against FP drift or anchors that landed slightly
  // out of order: clamp each boundary to be at least the previous one.
  for (let i = 1; i <= n; i += 1) {
    if ((boundary[i] as number) < (boundary[i - 1] as number)) {
      boundary[i] = boundary[i - 1];
    }
  }

  const starts = new Array<number>(n);
  const ends = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    starts[i] = boundary[i] as number;
    ends[i] = boundary[i + 1] as number;
  }
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

function tokenize(source: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  let i = 0;
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i])) i += 1;
    if (i >= source.length) break;
    const start = i;
    while (i < source.length && !/\s/.test(source[i])) i += 1;
    const raw = source.slice(start, i);
    const normalized = normalize(raw);
    if (normalized.length > 0) {
      tokens.push({ raw, normalized, startChar: start, endChar: i });
    }
  }
  return tokens;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

// Needleman-Wunsch. MATCH=2, MISMATCH=0 (so a substitution is still
// preferred over an insert+delete pair, which gives positional pairing
// when Whisper substitutes a similar-sounding word), GAP=-1.
function alignSequences(src: string[], wh: string[]): number[] {
  const n = src.length;
  const m = wh.length;
  const MATCH = 2;
  const MISMATCH = 0;
  const GAP = -1;

  const dp: number[][] = [];
  for (let i = 0; i <= n; i += 1) {
    dp.push(new Array(m + 1).fill(0));
    dp[i][0] = i * GAP;
  }
  for (let j = 0; j <= m; j += 1) dp[0][j] = j * GAP;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const score = src[i - 1] === wh[j - 1] ? MATCH : MISMATCH;
      dp[i][j] = Math.max(
        dp[i - 1][j - 1] + score,
        dp[i - 1][j] + GAP,
        dp[i][j - 1] + GAP
      );
    }
  }

  const matched = new Array<number>(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const score = src[i - 1] === wh[j - 1] ? MATCH : MISMATCH;
      if (dp[i][j] === dp[i - 1][j - 1] + score) {
        matched[i - 1] = j - 1;
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && (j === 0 || dp[i][j] === dp[i - 1][j] + GAP)) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return matched;
}
