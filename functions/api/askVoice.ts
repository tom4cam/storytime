// POST /api/askVoice
// Returns an MP3 of the given (short) text spoken with the requested voice.
// Edge-cached for 24h.

import type { Env } from './_lib/env';
import { synthesize } from './_lib/tts';
import { badRequest, serverError } from './_lib/util';

interface AskVoiceRequest {
  text: string;
  language: 'en' | 'sv';
  voiceId?: string;
  speed?: number;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: AskVoiceRequest;
  try { body = (await request.json()) as AskVoiceRequest; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.text || typeof body.text !== 'string') return badRequest('text required');
  if (body.language !== 'en' && body.language !== 'sv') return badRequest('language must be en or sv');
  if (body.text.length > 500) return badRequest('text too long (max 500 chars)');
  try {
    const { audio } = await synthesize(env, body.text, { voiceId: body.voiceId, speed: body.speed });
    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (e) {
    console.error('askVoice failed', e);
    return serverError((e as Error).message);
  }
};
