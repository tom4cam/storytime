import type { Context } from '@netlify/functions';
import { getStoryVersion } from './_lib/storage';
import { badRequest, json, notFound, serverError } from './_lib/util';

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const versionParam = url.searchParams.get('version');
  if (!id) return badRequest('Missing id');
  const version = versionParam ? parseInt(versionParam, 10) : undefined;
  if (versionParam && (Number.isNaN(version) || version! < 1)) {
    return badRequest('version must be a positive integer');
  }
  try {
    const story = await getStoryVersion(id, version);
    if (!story) return notFound('Story not found');
    return json(story);
  } catch (e) {
    console.error('getStory failed', e);
    return serverError((e as Error).message);
  }
};
