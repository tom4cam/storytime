// GET /api/listStories

import type { Env } from './_lib/env';
import { listStoryIndexes, groupStoryIndexes } from './_lib/storage';
import { LANGS, type Lang, type StoryGroupSummary } from './_lib/types';
import { json } from './_lib/util';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const raw = url.searchParams.get('lang');
  const preferredLang: Lang | null = raw && (LANGS as readonly string[]).includes(raw) ? (raw as Lang) : null;
  const sort = url.searchParams.get('sort') === 'stars' ? 'stars' : 'recent';
  const indexes = await listStoryIndexes(env);
  const groups = groupStoryIndexes(indexes, preferredLang);
  if (sort === 'stars') {
    (groups as StoryGroupSummary[]).sort((a, b) => {
      const sa = a.primary.stars ?? 0;
      const sb = b.primary.stars ?? 0;
      if (sb !== sa) return sb - sa;
      return (b.primary.updated_at || '').localeCompare(a.primary.updated_at || '');
    });
  }
  return json(groups);
};
