// Admin alerts for upstream API failures. Sends an email via Resend
// when an upstream returns 429/5xx or a network error escapes a fetch.
//
// Cooldown: one alert per (provider, kind) per hour, tracked in R2.
// If RESEND_API_KEY is unset the alert is a no-op (logged warning).

import type { Env } from './env';

const ADMIN_EMAIL = 'caswell.tom@gmail.com';
const SENDER = 'storytime alerts <onboarding@resend.dev>';
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export type AlertKind = 'http_429' | 'http_5xx' | 'network_error';
export type AlertProvider = 'anthropic' | 'openai' | 'fal';

export function classifyError(status: number | undefined, err?: Error): AlertKind | null {
  if (status === 429) return 'http_429';
  if (status !== undefined && status >= 500 && status < 600) return 'http_5xx';
  if (status === undefined && err) return 'network_error';
  return null;
}

interface R2Lite {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

function keyFor(provider: AlertProvider, kind: AlertKind): string {
  return `alerts/last-${provider}-${kind}.txt`;
}

async function shouldSend(bucket: R2Lite, provider: AlertProvider, kind: AlertKind): Promise<boolean> {
  const obj = await bucket.get(keyFor(provider, kind));
  if (!obj) return true;
  const last = await obj.text();
  const lastMs = Date.parse(last);
  if (Number.isNaN(lastMs)) return true;
  return Date.now() - lastMs >= COOLDOWN_MS;
}

async function markSent(bucket: R2Lite, provider: AlertProvider, kind: AlertKind): Promise<void> {
  await bucket.put(keyFor(provider, kind), new Date().toISOString(), {
    httpMetadata: { contentType: 'text/plain' },
  });
}

export async function notifyAdminFailure(
  env: Env,
  provider: AlertProvider,
  kind: AlertKind,
  detail: string
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn(`[alerts] skip (no RESEND_API_KEY): ${provider} ${kind} — ${detail.slice(0, 200)}`);
    return;
  }
  try {
    if (!(await shouldSend(env.STORIES as unknown as R2Lite, provider, kind))) return;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SENDER,
        to: [ADMIN_EMAIL],
        subject: `[storytime] ${provider} ${kind}`,
        text:
          `Provider: ${provider}\n` +
          `Kind:     ${kind}\n` +
          `Time:     ${new Date().toISOString()}\n` +
          `Detail:\n${detail.slice(0, 2000)}`,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[alerts] Resend rejected: ${res.status} ${body.slice(0, 200)}`);
      return;
    }
    await markSent(env.STORIES as unknown as R2Lite, provider, kind);
  } catch (e) {
    console.warn(`[alerts] send failed: ${(e as Error).message}`);
  }
}

// Exported only for tests.
export const __shouldSendForTest = shouldSend;
export const __markSentForTest = markSent;
