// Per-upstream latency + failure counters, stored as one R2 JSON file
// per month under admin/telemetry/YYYY-MM.json. Same shape and write
// pattern as costs.ts — read/modify/write, fire-and-forget, never block
// the user-facing call on telemetry failure.
//
// Pairs with findStuckStories() (story versions left in status=generating
// past a threshold) to answer the recurring "why is this stuck" question
// without scraping Cloudflare logs.

import type { Env } from './env';
import type { StoryIndex } from './types';

export type TelemetryProvider = 'anthropic' | 'openai' | 'fal' | 'elevenlabs' | 'resend';
export type TelemetryKind =
  | 'story_gen'
  | 'translation'
  | 'tts'
  | 'whisper'
  | 'image'
  | 'moderation'
  | 'alert';

interface Bucket {
  total: number;
  errors: number;
  sum_latency_ms: number;
  max_latency_ms: number;
}

export interface MonthlyTelemetry {
  month: string;
  by_provider: Record<TelemetryProvider, Bucket>;
  by_kind: Record<TelemetryKind, Bucket>;
  updated_at: string;
}

function emptyBucket(): Bucket {
  return { total: 0, errors: 0, sum_latency_ms: 0, max_latency_ms: 0 };
}

function emptyMonth(month: string): MonthlyTelemetry {
  return {
    month,
    by_provider: {
      anthropic: emptyBucket(),
      openai: emptyBucket(),
      fal: emptyBucket(),
      elevenlabs: emptyBucket(),
      resend: emptyBucket(),
    },
    by_kind: {
      story_gen: emptyBucket(),
      translation: emptyBucket(),
      tts: emptyBucket(),
      whisper: emptyBucket(),
      image: emptyBucket(),
      moderation: emptyBucket(),
      alert: emptyBucket(),
    },
    updated_at: new Date().toISOString(),
  };
}

function currentMonth(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function telemetryKey(month: string): string {
  return `admin/telemetry/${month}.json`;
}

export async function getCurrentTelemetry(env: Env): Promise<MonthlyTelemetry> {
  const month = currentMonth();
  try {
    const obj = await env.STORIES.get(telemetryKey(month));
    if (!obj) return emptyMonth(month);
    const raw = (await obj.json()) as Partial<MonthlyTelemetry>;
    // Backfill defaults so a legacy record missing newer providers/kinds
    // doesn't NaN on increment. Same pattern as costs.ts.
    const base = emptyMonth(month);
    return {
      month: raw.month ?? month,
      by_provider: { ...base.by_provider, ...(raw.by_provider ?? {}) } as Record<TelemetryProvider, Bucket>,
      by_kind: { ...base.by_kind, ...(raw.by_kind ?? {}) } as Record<TelemetryKind, Bucket>,
      updated_at: raw.updated_at ?? base.updated_at,
    };
  } catch {
    return emptyMonth(month);
  }
}

function bump(b: Bucket, latencyMs: number, ok: boolean): Bucket {
  return {
    total: b.total + 1,
    errors: b.errors + (ok ? 0 : 1),
    sum_latency_ms: b.sum_latency_ms + latencyMs,
    max_latency_ms: Math.max(b.max_latency_ms, latencyMs),
  };
}

async function writeTelemetry(
  env: Env,
  provider: TelemetryProvider,
  kind: TelemetryKind,
  latencyMs: number,
  ok: boolean,
): Promise<void> {
  try {
    const current = await getCurrentTelemetry(env);
    const next: MonthlyTelemetry = {
      ...current,
      by_provider: { ...current.by_provider, [provider]: bump(current.by_provider[provider] ?? emptyBucket(), latencyMs, ok) },
      by_kind: { ...current.by_kind, [kind]: bump(current.by_kind[kind] ?? emptyBucket(), latencyMs, ok) },
      updated_at: new Date().toISOString(),
    };
    await env.STORIES.put(telemetryKey(currentMonth()), JSON.stringify(next), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch (e) {
    console.warn(`[telemetry] write failed: ${(e as Error).message}`);
  }
}

// Wrap any Promise-returning upstream call. Always returns the original
// result (or rethrows the original error) — telemetry is fire-and-forget.
export async function recordCall<T>(
  env: Env,
  provider: TelemetryProvider,
  kind: TelemetryKind,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  let ok = true;
  try {
    return await fn();
  } catch (e) {
    ok = false;
    throw e;
  } finally {
    void writeTelemetry(env, provider, kind, Date.now() - start, ok);
  }
}

export interface StuckStory {
  id: string;
  title: string;
  language: string;
  created_at: string;
  age_minutes: number;
  status: string;
}

// Story versions left in `generating` past `thresholdMinutes` are almost
// always a sign an upstream call hung or the worker died mid-build. The
// admin telemetry endpoint surfaces these so an operator can investigate
// or re-trigger without reading logs.
export async function findStuckStories(env: Env, thresholdMinutes: number = 5): Promise<StuckStory[]> {
  const result = await env.STORIES.list({ limit: 1000 });
  const indexKeys = result.objects.filter((o) => o.key.endsWith('/index.json'));
  const now = Date.now();
  const items = await Promise.all(
    indexKeys.map(async (o) => {
      const blob = await env.STORIES.get(o.key);
      if (!blob) return null;
      try { return (await blob.json()) as StoryIndex; } catch { return null; }
    }),
  );
  const stuck: StuckStory[] = [];
  for (const idx of items) {
    if (!idx || idx.status !== 'generating') continue;
    const created = Date.parse(idx.created_at);
    if (!Number.isFinite(created)) continue;
    const ageMin = (now - created) / 60_000;
    if (ageMin < thresholdMinutes) continue;
    stuck.push({
      id: idx.id,
      title: idx.title,
      language: idx.language,
      created_at: idx.created_at,
      age_minutes: Math.round(ageMin),
      status: idx.status,
    });
  }
  stuck.sort((a, b) => b.age_minutes - a.age_minutes);
  return stuck;
}
