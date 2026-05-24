import type { Context } from '@netlify/functions';
import { listStoryIndexes } from './_lib/storage';
import { json, serverError } from './_lib/util';

export default async (_req: Request, _ctx: Context): Promise<Response> => {
  try {
    const items = await listStoryIndexes();
    return json(items.slice(0, 30));
  } catch (e) {
    console.error('listStories failed', e);
    return serverError((e as Error).message);
  }
};
