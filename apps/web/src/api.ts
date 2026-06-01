import { getAdminToken } from './adminToken';
import type { Lang, StoryAnswer, StoryGroupSummary, StoryVersion, StoryVersionWithSiblings } from './types';

const FN_BASE = '/api';

function adminHeaders(): Record<string, string> {
  const t = getAdminToken();
  return t ? { 'X-Admin-Token': t } : {};
}

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`Request failed (${status}): ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error || JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export async function createStory(
  answers: StoryAnswer[],
  language: Lang,
  voiceId?: string,
  rhyme = false
): Promise<StoryVersion> {
  const res = await fetch(`${FN_BASE}/createStory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, language, voice_id: voiceId, rhyme }),
  });
  return jsonOrThrow<StoryVersion>(res);
}

export async function getStory(id: string, version?: number): Promise<StoryVersionWithSiblings> {
  const url = version
    ? `${FN_BASE}/getStory?id=${encodeURIComponent(id)}&version=${version}`
    : `${FN_BASE}/getStory?id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  return jsonOrThrow<StoryVersionWithSiblings>(res);
}

export async function listStories(lang: Lang): Promise<StoryGroupSummary[]> {
  const res = await fetch(`${FN_BASE}/listStories?lang=${encodeURIComponent(lang)}`);
  return jsonOrThrow<StoryGroupSummary[]>(res);
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

export async function updateStoryListing(id: string, listed: boolean): Promise<StoryVersion> {
  const res = await fetch(`${FN_BASE}/updateStoryListing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, listed }),
  });
  return jsonOrThrow<StoryVersion>(res);
}

export async function deleteStory(id: string): Promise<void> {
  const res = await fetch(`${FN_BASE}/deleteStory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    let detail = '';
    try { const body = await res.json(); detail = body?.error || JSON.stringify(body); }
    catch { detail = await res.text(); }
    throw new Error(`Delete failed (${res.status}): ${detail}`);
  }
}

export interface DeleteVersionResponse {
  ok: true;
  removedStory: boolean;
  newLatest?: number;
  mediaDeleted: number;
}

export async function deleteStoryVersion(id: string, version: number): Promise<DeleteVersionResponse> {
  const res = await fetch(`${FN_BASE}/deleteStoryVersion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify({ id, version }),
  });
  return jsonOrThrow<DeleteVersionResponse>(res);
}

export async function translateStory(
  id: string,
  targetLanguage: Lang,
  version?: number
): Promise<StoryVersion> {
  const res = await fetch(`${FN_BASE}/translateStory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, version, target_language: targetLanguage }),
  });
  return jsonOrThrow<StoryVersion>(res);
}
