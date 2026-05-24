import type { Context } from '@netlify/functions';
import { buildFromAnswers, ModerationError } from './_lib/build';
import type { StoryAnswer } from './_lib/types';
import { badRequest, json, readJson, serverError } from './_lib/util';

interface CreateStoryRequest {
  answers: StoryAnswer[];
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return badRequest('POST only');
  let body: CreateStoryRequest;
  try {
    body = await readJson<CreateStoryRequest>(req);
  } catch (e) {
    return badRequest((e as Error).message);
  }
  if (!Array.isArray(body.answers) || body.answers.length === 0) {
    return badRequest('answers must be a non empty array');
  }
  const trimmed = body.answers
    .filter((a) => a && typeof a.answer === 'string' && a.answer.trim().length > 0)
    .map((a) => ({ question: String(a.question || ''), answer: a.answer.trim() }));
  if (trimmed.length < 3) {
    return badRequest('At least three answers are required to make a story.');
  }
  try {
    const version = await buildFromAnswers(trimmed);
    return json(version);
  } catch (e) {
    if (e instanceof ModerationError) return json({ error: e.message }, 422);
    console.error('createStory failed', e);
    return serverError((e as Error).message);
  }
};

export const config = {
  // Story generation can take 20+ seconds (LLM + multiple images + TTS).
  path: '/.netlify/functions/createStory',
};
