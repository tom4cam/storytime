// GET /api/getStory?id=...&version=...

import type { Env } from './_lib/env';
import { getStoryVersion, listStoryIndexes } from './_lib/storage';
import type { Lang } from './_lib/types';
import { badRequest, json, notFound } from './_lib/util';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const versionStr = url.searchParams.get('version');
  if (!id) return badRequest('id required');
  const version = versionStr ? parseInt(versionStr, 10) : undefined;
  const story = await getStoryVersion(env, id, version);
  if (!story) return notFound('Story not found.');

  let siblings: Array<{ id: string; language: Lang }> = [];
  if (story.group_id) {
    const indexes = await listStoryIndexes(env);
    siblings = indexes
      .filter((i) => i.group_id === story.group_id && i.id !== story.id)
      .map((i) => ({ id: i.id, language: i.language }));
  }

  return json({ ...story, siblings });
};
