// GET /api/getStory?id=...&version=...

import type { Env } from './_lib/env';
import { getStoryVersion, listStoryIndexes } from './_lib/storage';
import { readCreatorId } from './_lib/creatorId';
import { toPublicStory } from './_lib/publicStory';
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

  const needsIndex = !!(story.group_id || story.series_id);
  const indexes = needsIndex ? await listStoryIndexes(env) : [];

  let siblings: Array<{ id: string; language: Lang }> = [];
  if (story.group_id) {
    siblings = indexes
      .filter((i) => i.group_id === story.group_id && i.id !== story.id)
      .map((i) => ({ id: i.id, language: i.language }));
  }

  let series: {
    series_id: string;
    position: number;
    members: Array<{ id: string; position: number; title: string }>;
  } | null = null;
  if (story.series_id && story.series_position !== undefined) {
    const members = indexes
      .filter((i) => i.series_id === story.series_id)
      .map((i) => ({ id: i.id, position: i.series_position ?? 0, title: i.title }))
      .sort((a, b) => a.position - b.position);
    series = { series_id: story.series_id, position: story.series_position, members };
  }

  return json({ ...toPublicStory(story, readCreatorId(request)), siblings, series });
};
