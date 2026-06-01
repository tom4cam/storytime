// GET /api/listStories

import type { Env } from './_lib/env';
import { listStoryIndexes, groupStoryIndexes } from './_lib/storage';
import { LANGS, type Lang } from './_lib/types';
import { json } from './_lib/util';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const raw = url.searchParams.get('lang');
  const preferredLang: Lang | null = raw && (LANGS as readonly string[]).includes(raw) ? (raw as Lang) : null;
  const indexes = await listStoryIndexes(env);
  return json(groupStoryIndexes(indexes, preferredLang));
};
