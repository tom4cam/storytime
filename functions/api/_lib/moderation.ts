import type { Env } from './env';
import { requireEnv } from './env';
import { classifyError, notifyAdminFailure } from './alerts';

interface ModerationResult { flagged: boolean; reasons: string[] }
interface OpenAIModerationResponse { results: Array<{ flagged: boolean; categories: Record<string, boolean> }> }

export async function moderate(env: Env, text: string): Promise<ModerationResult> {
  if (!text || !text.trim()) return { flagged: false, reasons: [] };
  const apiKey = requireEnv(env, 'OPENAI_API_KEY');
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
    });
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
  return { flagged: !!first.flagged, reasons };
}
