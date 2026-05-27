import type { StoryAnswer, StorySummary, StoryVersion } from './types';

const FN_BASE = '/api';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error || JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Request failed (${res.status}): ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function createStory(
  answers: StoryAnswer[],
  language: 'en' | 'sv' | 'bg' | 'es' | 'fr',
  voiceId: string
): Promise<StoryVersion> {
  const res = await fetch(`${FN_BASE}/createStory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, language, voice_id: voiceId }),
  });
  return jsonOrThrow<StoryVersion>(res);
}

export async function getStory(id: string, version?: number): Promise<StoryVersion> {
  const url = version
    ? `${FN_BASE}/getStory?id=${encodeURIComponent(id)}&version=${version}`
    : `${FN_BASE}/getStory?id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  return jsonOrThrow<StoryVersion>(res);
}

export async function listStories(): Promise<StorySummary[]> {
  const res = await fetch(`${FN_BASE}/listStories`);
  return jsonOrThrow<StorySummary[]>(res);
}

export async function updateStory(
  id: string,
  paragraphs: { text: string; image_url: string | null; image_prompt?: string; regenerate_image?: boolean }[],
  title: string,
  summary: string
): Promise<StoryVersion> {
  const res = await fetch(`${FN_BASE}/updateStory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, paragraphs, title, summary }),
  });
  return jsonOrThrow<StoryVersion>(res);
}

export async function moderateText(text: string): Promise<{ flagged: boolean; reasons: string[] }> {
  const res = await fetch(`${FN_BASE}/moderate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return jsonOrThrow(res);
}

export async function deleteStory(id: string): Promise<void> {
  const res = await fetch(`${FN_BASE}/deleteStory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    let detail = '';
    try { const body = await res.json(); detail = body?.error || JSON.stringify(body); }
    catch { detail = await res.text(); }
    throw new Error(`Delete failed (${res.status}): ${detail}`);
  }
}
