import type { Context } from '@netlify/functions';
import { synthesize } from './_lib/elevenlabs';
import { badRequest, readJson, serverError } from './_lib/util';

interface AskVoiceRequest {
  text: string;
  language: 'en' | 'sv';
  voiceId?: string;
  speed?: number;
}

// Returns an MP3 of the given (short) text spoken with the requested voice.
// Used by the create flow to read questions aloud in higher quality than
// the browser SpeechSynthesis fallback. Cached at the edge for 24h.
export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return badRequest('POST only');
  let body: AskVoiceRequest;
  try {
    body = await readJson<AskVoiceRequest>(req);
  } catch (e) {
    return badRequest((e as Error).message);
  }
  if (!body.text || typeof body.text !== 'string') return badRequest('text required');
  if (body.language !== 'en' && body.language !== 'sv') return badRequest('language must be en or sv');
  if (body.text.length > 500) return badRequest('text too long (max 500 chars)');
  try {
    const { audio } = await synthesize(body.text, { voiceId: body.voiceId, speed: body.speed });
    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
        'Netlify-CDN-Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e) {
    console.error('askVoice failed', e);
    return serverError((e as Error).message);
  }
};
