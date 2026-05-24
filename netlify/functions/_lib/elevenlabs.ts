// ElevenLabs text to speech. Returns the MP3 buffer for the full narration.

import { requireEnv } from './util';

const DEFAULT_VOICE_ID = 'onwK4e9ZLuTAKqWW03oN'; // Daniel
const MODEL_ID = 'eleven_multilingual_v2';

export async function synthesize(text: string): Promise<ArrayBuffer> {
  const apiKey = requireEnv('ELEVENLABS_API_KEY');
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
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
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`ElevenLabs synthesis failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.arrayBuffer();
}
