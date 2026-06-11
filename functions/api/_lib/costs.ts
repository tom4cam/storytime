// Cost tracking helper. Reads/writes monthly cost JSON from R2.
//
// Storage path: admin/costs/YYYY-MM.json
// One record per month; updated after each API call.
//
// concurrency note: R2 read-modify-write is not atomic. For this low-traffic
// personal app the chance of a lost write is acceptable. A future improvement
// would be to use Durable Objects or a KV counter.

import type { Env } from './env';
import { notifyAdminFailure } from './alerts';

export type CostProvider = 'anthropic' | 'openai' | 'fal' | 'elevenlabs';
export type CostKind =
  | 'story_gen'
  | 'translation'
  | 'tts'
  | 'image'
  | 'moderation';

export interface MonthlyCosts {
  month: string; // "YYYY-MM"
  total_usd: number;
  by_provider: {
    anthropic: number;
    openai: number;
    fal: number;
    elevenlabs: number;
  };
  by_kind: {
    story_gen: number;
    translation: number;
    tts: number;
    image: number;
    moderation: number;
  };
  count_by_kind: {
    story_gen: number;
    translation: number;
    tts: number;
    image: number;
    moderation: number;
  };
  cost_alerted: boolean;
  updated_at: string;
}

function currentMonth(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function costKey(month: string): string {
  return `admin/costs/${month}.json`;
}

function emptyMonth(month: string): MonthlyCosts {
  return {
    month,
    total_usd: 0,
    by_provider: { anthropic: 0, openai: 0, fal: 0, elevenlabs: 0 },
    by_kind: { story_gen: 0, translation: 0, tts: 0, image: 0, moderation: 0 },
    count_by_kind: { story_gen: 0, translation: 0, tts: 0, image: 0, moderation: 0 },
    cost_alerted: false,
    updated_at: new Date().toISOString(),
  };
}

export async function getCurrentMonthlyCosts(env: Env): Promise<MonthlyCosts> {
  const month = currentMonth();
  const key = costKey(month);
  try {
    const obj = await env.STORIES.get(key);
    if (!obj) return emptyMonth(month);
    return (await obj.json()) as MonthlyCosts;
  } catch {
    return emptyMonth(month);
  }
}

export async function resetMonthlyCosts(env: Env): Promise<MonthlyCosts> {
  const month = currentMonth();
  const fresh = emptyMonth(month);
  await env.STORIES.put(costKey(month), JSON.stringify(fresh), {
    httpMetadata: { contentType: 'application/json' },
  });
  return fresh;
}

const DEFAULT_CAP_USD = 10;

export function monthlyCapUsd(env: Env): number {
  const capStr = env.MONTHLY_COST_LIMIT_USD;
  const cap = capStr ? parseFloat(capStr) : DEFAULT_CAP_USD;
  return Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_CAP_USD;
}

// Circuit breaker: true when this month's recorded spend has reached the cap.
// Call before kicking off any paid pipeline (story build, translation, TTS).
// The cap alert in recordCost only emails the admin; this is the part that
// actually stops new spending. Fails open on read errors — a broken R2 read
// shouldn't take the whole app down.
export async function isOverMonthlyCap(env: Env): Promise<boolean> {
  try {
    const costs = await getCurrentMonthlyCosts(env);
    return costs.total_usd >= monthlyCapUsd(env);
  } catch {
    return false;
  }
}

// Friendly 429 body shared by the endpoints that gate on the cap.
export const CAP_REACHED_MESSAGE =
  'The story maker has reached its monthly budget. New stories will be possible again next month.';

export async function recordCost(
  env: Env,
  provider: CostProvider,
  kind: CostKind,
  usd: number,
): Promise<void> {
  // Fire and forget in call sites — never throw to the caller.
  try {
    const month = currentMonth();
    const key = costKey(month);

    const obj = await env.STORIES.get(key);
    const current: MonthlyCosts = obj
      ? ((await obj.json()) as MonthlyCosts)
      : emptyMonth(month);

    // Backfill defaults so a legacy record missing newer providers
    // (e.g. elevenlabs added after R2 already held this month's file)
    // picks up zeros instead of producing NaN on the increment.
    // Object.assign over spread to silence the duplicate-key TS warning.
    const providerBase = Object.assign(
      { anthropic: 0, openai: 0, fal: 0, elevenlabs: 0 },
      current.by_provider,
    );
    const updated: MonthlyCosts = {
      ...current,
      total_usd: current.total_usd + usd,
      by_provider: { ...providerBase, [provider]: providerBase[provider] + usd },
      by_kind: {
        ...current.by_kind,
        [kind]: current.by_kind[kind] + usd,
      },
      count_by_kind: {
        ...current.count_by_kind,
        [kind]: current.count_by_kind[kind] + 1,
      },
      updated_at: new Date().toISOString(),
    };

    await env.STORIES.put(key, JSON.stringify(updated), {
      httpMetadata: { contentType: 'application/json' },
    });

    // Check monthly cap and send alert if crossed for the first time.
    const cap = monthlyCapUsd(env);
    if (!updated.cost_alerted && updated.total_usd >= cap) {
      await sendCostCapAlert(env, updated, cap);
      // Flip the alerted flag.
      updated.cost_alerted = true;
      await env.STORIES.put(key, JSON.stringify(updated), {
        httpMetadata: { contentType: 'application/json' },
      });
    }
  } catch (e) {
    // Never block the user-facing call on cost tracking failure.
    console.warn(`[costs] recordCost failed: ${(e as Error).message}`);
  }
}

async function sendCostCapAlert(env: Env, costs: MonthlyCosts, cap: number): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn(`[costs] Monthly cap hit ($${costs.total_usd.toFixed(4)}) but RESEND_API_KEY not set`);
    return;
  }
  try {
    const ADMIN_EMAIL = 'caswell.tom@gmail.com';
    const SENDER = 'storytime alerts <onboarding@resend.dev>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SENDER,
        to: [ADMIN_EMAIL],
        subject: `[storytime] Monthly cost cap reached: $${costs.total_usd.toFixed(4)} / $${cap}`,
        text:
          `Monthly cost cap has been reached.\n\n` +
          `Month:   ${costs.month}\n` +
          `Total:   $${costs.total_usd.toFixed(4)} (cap: $${cap})\n\n` +
          `By provider:\n` +
          `  anthropic:  $${(costs.by_provider.anthropic ?? 0).toFixed(4)}\n` +
          `  openai:     $${(costs.by_provider.openai ?? 0).toFixed(4)}\n` +
          `  fal:        $${(costs.by_provider.fal ?? 0).toFixed(4)}\n` +
          `  elevenlabs: $${(costs.by_provider.elevenlabs ?? 0).toFixed(4)}\n\n` +
          `By kind:\n` +
          `  story_gen:   $${costs.by_kind.story_gen.toFixed(4)} (${costs.count_by_kind.story_gen}x)\n` +
          `  translation: $${costs.by_kind.translation.toFixed(4)} (${costs.count_by_kind.translation}x)\n` +
          `  tts:         $${costs.by_kind.tts.toFixed(4)} (${costs.count_by_kind.tts}x)\n` +
          `  image:       $${costs.by_kind.image.toFixed(4)} (${costs.count_by_kind.image}x)\n` +
          `  moderation:  $${costs.by_kind.moderation.toFixed(4)} (${costs.count_by_kind.moderation}x)\n`,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[costs] Resend rejected cost alert: ${res.status} ${body.slice(0, 200)}`);
    }
  } catch (e) {
    console.warn(`[costs] cost alert send failed: ${(e as Error).message}`);
  }
}
