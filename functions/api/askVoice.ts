// POST /api/askVoice
// Returns an MP3 of the given (short) text spoken with the requested voice.
// Edge-cached for 24h.

import type { Env } from './_lib/env';
import { CAP_REACHED_MESSAGE, isOverMonthlyCap } from './_lib/costs';
import { LANGS } from './_lib/types';
import type { Lang } from './_lib/types';
import { synthesize } from './_lib/tts';
import { badRequest, json, serverError } from './_lib/util';

interface AskVoiceRequest {
  text: string;
  language: Lang;
  voiceId?: string;
  speed?: number;
}

const VALID_LANGS = new Set(LANGS);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: AskVoiceRequest;
  try { body = (await request.json()) as AskVoiceRequest; }
  catch (e) { return badRequest((e as Error).message || 'Bad JSON'); }
  if (!body.text || typeof body.text !== 'string') return badRequest('text required');
  if (!VALID_LANGS.has(body.language)) return badRequest('language must be one of: en, sv, bg, es, fr');
  if (body.text.length > 500) return badRequest('text too long (max 500 chars)');
  if (await isOverMonthlyCap(env)) return json({ error: CAP_REACHED_MESSAGE }, 429);
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
