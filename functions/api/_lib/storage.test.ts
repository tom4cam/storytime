import { describe, it, expect } from 'vitest';
import { groupStoryIndexes } from './storage';
import type { StoryIndex } from './types';

function idx(overrides: Partial<StoryIndex> & Pick<StoryIndex, 'id' | 'language'>): StoryIndex {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    latest_version: overrides.latest_version ?? 1,
    cover_image_url: overrides.cover_image_url ?? null,
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    status: overrides.status ?? 'ready',
    language: overrides.language,
    ...(overrides.group_id ? { group_id: overrides.group_id } : {}),
  };
}

describe('groupStoryIndexes', () => {
  it('returns [] for empty input', () => {
    expect(groupStoryIndexes([], 'en')).toEqual([]);
  });

  it('treats a story with no group_id as a group of one', () => {
    const s = idx({ id: 'solo', language: 'en' });
    const result = groupStoryIndexes([s], 'en');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      group_id: null,
      primary: s,
      languages: ['en'],
    });
  });

  it('groups indexes that share a group_id', () => {
    const en = idx({ id: 'pip-en', language: 'en', group_id: 'pip' });
    const sv = idx({ id: 'pip-sv', language: 'sv', group_id: 'pip' });
    const result = groupStoryIndexes([en, sv], 'en');
    expect(result).toHaveLength(1);
    expect(result[0].group_id).toBe('pip');
    expect(result[0].languages.sort()).toEqual(['en', 'sv']);
  });

  it('picks the preferred-language member as primary', () => {
    const en = idx({ id: 'pip-en', language: 'en', group_id: 'pip' });
    const sv = idx({ id: 'pip-sv', language: 'sv', group_id: 'pip' });
    const result = groupStoryIndexes([en, sv], 'sv');
    expect(result[0].primary.id).toBe('pip-sv');
  });

  it('falls back to en when preferred is absent', () => {
    const en = idx({ id: 'pip-en', language: 'en', group_id: 'pip' });
    const fr = idx({ id: 'pip-fr', language: 'fr', group_id: 'pip' });
    const result = groupStoryIndexes([en, fr], 'sv');
    expect(result[0].primary.id).toBe('pip-en');
  });

  it('falls back to most-recently-updated when neither preferred nor en exists', () => {
    const fr = idx({ id: 'pip-fr', language: 'fr', group_id: 'pip', updated_at: '2026-02-01T00:00:00Z' });
    const bg = idx({ id: 'pip-bg', language: 'bg', group_id: 'pip', updated_at: '2026-03-01T00:00:00Z' });
    const result = groupStoryIndexes([fr, bg], 'sv');
    expect(result[0].primary.id).toBe('pip-bg');
  });

  it('handles a mix of grouped and solo stories', () => {
    const en = idx({ id: 'pip-en', language: 'en', group_id: 'pip' });
    const sv = idx({ id: 'pip-sv', language: 'sv', group_id: 'pip' });
    const solo = idx({ id: 'bob', language: 'sv' });
    const result = groupStoryIndexes([en, sv, solo], 'en');
    expect(result).toHaveLength(2);
    const groupIds = result.map((g) => g.group_id).sort();
    expect(groupIds).toEqual([null, 'pip']);
  });

  it('sorts groups by primary.updated_at descending', () => {
    const old = idx({ id: 'old', language: 'en', updated_at: '2026-01-01T00:00:00Z' });
    const recent = idx({ id: 'recent', language: 'en', updated_at: '2026-05-01T00:00:00Z' });
    const result = groupStoryIndexes([old, recent], 'en');
    expect(result.map((g) => g.primary.id)).toEqual(['recent', 'old']);
  });
});
