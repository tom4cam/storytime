import type { Context } from '@netlify/functions';
import { moderate } from './_lib/moderation';
import { badRequest, json, readJson, serverError } from './_lib/util';

interface ModerateRequest { text: string }

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return badRequest('POST only');
  let body: ModerateRequest;
  try {
    body = await readJson<ModerateRequest>(req);
  } catch (e) {
    return badRequest((e as Error).message);
  }
  try {
    const result = await moderate(body.text || '');
    return json(result);
  } catch (e) {
    console.error('moderate failed', e);
    return serverError((e as Error).message);
  }
};
