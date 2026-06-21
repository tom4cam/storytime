import { describe, it, expect } from 'vitest';
import { collectReferencedMediaKeys, groupStoryIndexes, listStoryVersionNumbers } from './storage';
import type { Env } from './env';
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
      members: [{ id: 'solo', language: 'en' }],
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

// Minimal in-memory STORIES bucket exposing just list()/get().
function memStories(blobs: Record<string, unknown>) {
  return {
    async list({ prefix }: { prefix?: string } = {}) {
      const keys = Object.keys(blobs).filter((k) => !prefix || k.startsWith(prefix));
      return { objects: keys.map((key) => ({ key })) };
    },
    async get(key: string) {
      if (!(key in blobs)) return null;
      const val = blobs[key];
      return { async json() { return val; } };
    },
  };
}

describe('collectReferencedMediaKeys', () => {
  it('collects image + narration keys from surviving versions and excludes the deleted one', async () => {
    const blobs = {
      // v1 owns its images; v2 reuses v1-p1 (unchanged paragraph) but
      // regenerated p2 to its own key. A translation (story b) reuses a-v1-p1.
      'a/v1.json': {
        paragraphs: [
          { image_url: '/api/media?key=a-v1-p1.png&v=x' },
          { image_url: '/api/media?key=a-v1-p2.png' },
        ],
        narration_url: '/api/media?key=a-v1.mp3',
      },
      'a/v2.json': {
        paragraphs: [
          { image_url: '/api/media?key=a-v1-p1.png&v=x' },
          { image_url: '/api/media?key=a-v2-p2.png' },
        ],
        narration_url: '/api/media?key=a-v2.mp3',
      },
      'a/index.json': { not: 'a version blob' },
      'b/v1.json': {
        paragraphs: [{ image_url: '/api/media?key=a-v1-p1.png' }],
        narration_url: '/api/media?key=b-v1.mp3',
      },
    };
    const env = { STORIES: memStories(blobs) } as unknown as Env;

    // Deleting a/v2: surviving versions are a/v1 and b/v1.
    const refs = await collectReferencedMediaKeys(env, 'a/v2.json');

    // Shared / still-referenced keys are preserved.
    expect(refs.has('a-v1-p1.png')).toBe(true);
    expect(refs.has('a-v1-p2.png')).toBe(true);
    expect(refs.has('a-v1.mp3')).toBe(true);
    expect(refs.has('b-v1.mp3')).toBe(true);
    // Keys only the deleted version referenced are NOT protected.
    expect(refs.has('a-v2-p2.png')).toBe(false);
    expect(refs.has('a-v2.mp3')).toBe(false);
  });
});

describe('listStoryVersionNumbers', () => {
  it('returns only the versions that exist, ascending, after a gap', async () => {
    // v1 was deleted; v2 and v3 remain. index.json must not be counted.
    const blobs = {
      'a/v2.json': { version: 2 },
      'a/v3.json': { version: 3 },
      'a/index.json': { latest_version: 3 },
      'b/v1.json': { version: 1 }, // a different story — must be ignored
    };
    const env = { STORIES: memStories(blobs) } as unknown as Env;

    expect(await listStoryVersionNumbers(env, 'a')).toEqual([2, 3]);
  });

  it('returns an empty array for a story with no versions', async () => {
    const env = { STORIES: memStories({}) } as unknown as Env;
    expect(await listStoryVersionNumbers(env, 'a')).toEqual([]);
  });
});
