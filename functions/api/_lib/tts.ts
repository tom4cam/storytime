// Text-to-speech + word-level alignment via OpenAI.
//
// Pipeline: text → /v1/audio/speech (tts-1) → MP3, then
// MP3 → /v1/audio/transcriptions (whisper-1, word timestamps) → words.
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

const TTS_MODEL = 'tts-1';
const STT_MODEL = 'whisper-1';
const DEFAULT_VOICE = 'nova';
const OPENAI_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);

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

export async function synthesize(env: Env, text: string, opts: SynthOpts = {}): Promise<SynthResult> {
  const apiKey = requireEnv(env, 'OPENAI_API_KEY');
  const voice = pickVoice(opts.voiceId);

  let ttsRes: Response;
  try {
    ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice,
        input: text,
        response_format: 'mp3',
        ...(opts.speed != null ? { speed: opts.speed } : {}),
      }),
    });
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
  form.append('model', STT_MODEL);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  // Bias Whisper toward the source spellings / names. 224 tokens is the
  // documented prompt cap; chars is a conservative proxy.
  form.append('prompt', text.slice(0, 224));

  let whRes: Response;
  try {
    whRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
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
  // OpenAI TTS-1: $15 / 1_000_000 chars.
  void recordCost(env, 'openai', 'tts', text.length * 15e-6);
  return { audio, alignment };
}

function pickVoice(voiceId: string | undefined): string {
  if (voiceId && OPENAI_VOICES.has(voiceId)) return voiceId;
  // Legacy ElevenLabs voice ids (and anything unknown) fall back to nova
  // so old stories keep playing without re-narration.
  return DEFAULT_VOICE;
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

  if (whisper.length > 0 && tokens.length > 0) {
    const matched = alignSequences(
      tokens.map((t) => t.normalized),
      whisper.map((w) => normalize(w.word))
    );
    for (let i = 0; i < tokens.length; i += 1) {
      const m = matched[i];
      if (m >= 0) {
        boundary[tokens[i].startChar] = whisper[m].start;
        boundary[tokens[i].endChar] = whisper[m].end;
      }
    }
  } else if (tokens.length > 0) {
    // No whisper output — distribute tokens uniformly over totalDur.
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
