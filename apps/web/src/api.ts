import { clearAdminToken, getAdminToken } from './adminToken';
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
  rhyme = false,
  series_id?: string,
): Promise<StoryVersion> {
  const res = await fetch(`${FN_BASE}/createStory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, language, voice_id: voiceId, rhyme, ...(series_id ? { series_id } : {}) }),
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

export async function listStories(lang: Lang, sort?: 'stars' | 'recent'): Promise<StoryGroupSummary[]> {
  const params = new URLSearchParams({ lang });
  if (sort && sort !== 'recent') params.set('sort', sort);
  const res = await fetch(`${FN_BASE}/listStories?${params}`);
  return jsonOrThrow<StoryGroupSummary[]>(res);
}

export async function setStars(id: string, stars: number | null): Promise<{ ok: boolean; stars: number | null }> {
  const res = await fetch(`${FN_BASE}/setStars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, stars }),
  });
  return jsonOrThrow<{ ok: boolean; stars: number | null }>(res);
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
  // A 403 here means the stored admin token is missing/stale (e.g. rotated).
  // Drop it so the next attempt prompts a fresh sign-in instead of resending.
  if (res.status === 403) clearAdminToken();
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

// --- Admin API (requires X-Admin-Token header) ---

export interface MonthlyCosts {
  month: string;
  total_usd: number;
  by_provider: { anthropic: number; openai: number; fal: number; elevenlabs: number };
  by_kind: { story_gen: number; translation: number; tts: number; image: number; moderation: number };
  count_by_kind: { story_gen: number; translation: number; tts: number; image: number; moderation: number };
  cost_alerted: boolean;
  updated_at: string;
}

export interface FlaggedStorySummary {
  id: string;
  title: string;
  language: string;
  created_at: string;
  creator_id: string | null;
  status: string;
  error?: string;
}

function adminAuthHeaders(token: string): Record<string, string> {
  return { 'X-Admin-Token': token, 'Content-Type': 'application/json' };
}

export async function adminGetCosts(token: string): Promise<{ costs: MonthlyCosts; cap_usd: number }> {
  const res = await fetch(`${FN_BASE}/_admin/costs`, {
    headers: { 'X-Admin-Token': token },
  });
  return jsonOrThrow(res);
}

export async function adminResetCosts(token: string): Promise<{ ok: boolean; costs: MonthlyCosts }> {
  const res = await fetch(`${FN_BASE}/_admin/resetCosts`, {
    method: 'POST',
    headers: adminAuthHeaders(token),
    body: '{}',
  });
  return jsonOrThrow(res);
}

export async function adminListFlagged(token: string): Promise<{ flagged: FlaggedStorySummary[] }> {
  const res = await fetch(`${FN_BASE}/_admin/listFlagged`, {
    headers: { 'X-Admin-Token': token },
  });
  return jsonOrThrow(res);
}

export interface AdminVersionSummary {
  version: number;
  title: string;
  status: string;
  created_at: string;
  is_latest: boolean;
}

export async function adminListStoryVersions(
  token: string,
  id: string
): Promise<{ id: string; latest_version: number; versions: AdminVersionSummary[] }> {
  const res = await fetch(`${FN_BASE}/_admin/listStoryVersions?id=${encodeURIComponent(id)}`, {
    headers: { 'X-Admin-Token': token },
  });
  return jsonOrThrow(res);
}

export async function adminRestoreStory(token: string, id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${FN_BASE}/_admin/restoreStory`, {
    method: 'POST',
    headers: adminAuthHeaders(token),
    body: JSON.stringify({ id }),
  });
  return jsonOrThrow(res);
}

export async function adminDeleteStory(token: string, id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${FN_BASE}/deleteStory`, {
    method: 'POST',
    headers: adminAuthHeaders(token),
    body: JSON.stringify({ id }),
  });
  return jsonOrThrow(res);
}
