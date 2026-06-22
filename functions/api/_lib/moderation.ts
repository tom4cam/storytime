import type { Env } from './env';
import { requireEnv } from './env';
import { classifyError, notifyAdminFailure } from './alerts';
import { recordCost } from './costs';
import { fetchWithRetry } from './retry';
import { recordCall } from './telemetry';

interface ModerationResult { flagged: boolean; reasons: string[] }
interface OpenAIModerationResponse { results: Array<{ flagged: boolean; categories: Record<string, boolean> }> }

export async function moderate(env: Env, text: string): Promise<ModerationResult> {
  if (!text || !text.trim()) return { flagged: false, reasons: [] };
  const apiKey = requireEnv(env, 'OPENAI_API_KEY');
  let res: Response;
  try {
    res = await recordCall(env, 'openai', 'moderation', () =>
      fetchWithRetry('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
      }, { timeoutMs: 15_000 })
    );
  } catch (e) {
    await notifyAdminFailure(env, 'openai', 'network_error', (e as Error).message);
    throw e;
  }
  if (!res.ok) {
    const detail = await res.text();
    const kind = classifyError(res.status);
    if (kind) await notifyAdminFailure(env, 'openai', kind, `${res.status}: ${detail.slice(0, 500)}`);
    throw new Error(`OpenAI moderation failed (${res.status}): ${detail}`);
  }
  const body = (await res.json()) as OpenAIModerationResponse;
  const first = body.results?.[0];
  if (!first) return { flagged: false, reasons: [] };
  const reasons = Object.entries(first.categories || {}).filter(([, v]) => !!v).map(([k]) => k);
  // OpenAI moderation is free — record $0 so call counts appear in the dashboard.
  void recordCost(env, 'openai', 'moderation', 0);
  return { flagged: !!first.flagged, reasons };
}
