// ElevenLabs text-to-speech with character-level timestamps. Returns the
// MP3 buffer plus the alignment that maps each input character to its
// audio position.

import type { CharacterAlignment } from './words';
import { requireEnv } from './util';

const DEFAULT_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9'; // Daniel
const MODEL_ID = 'eleven_multilingual_v2';

export interface SynthResult {
  audio: ArrayBuffer;
  alignment: CharacterAlignment;
}

interface ElevenLabsTimestampedResponse {
  audio_base64: string;
  alignment: CharacterAlignment;
  normalized_alignment?: CharacterAlignment;
}

export async function synthesize(text: string): Promise<SynthResult> {
  const apiKey = requireEnv('ELEVENLABS_API_KEY');
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.75,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`ElevenLabs synthesis failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as ElevenLabsTimestampedResponse;
  const audio = base64ToArrayBuffer(body.audio_base64);
  return { audio, alignment: body.alignment };
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
