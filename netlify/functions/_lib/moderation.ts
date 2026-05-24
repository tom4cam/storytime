// OpenAI moderation. Used to screen kid inputs before sending to the LLM,
// and to screen LLM output before saving. Returns flagged + which categories.

import { requireEnv } from './util';

interface ModerationResult {
  flagged: boolean;
  reasons: string[];
}

interface OpenAIModerationResponse {
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
  }>;
}

export async function moderate(text: string): Promise<ModerationResult> {
  if (!text || !text.trim()) return { flagged: false, reasons: [] };
  const apiKey = requireEnv('OPENAI_API_KEY');
  const res = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'omni-moderation-latest',
      input: text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI moderation failed (${res.status}): ${detail}`);
  }
  const body = (await res.json()) as OpenAIModerationResponse;
  const first = body.results?.[0];
  if (!first) return { flagged: false, reasons: [] };
  const reasons = Object.entries(first.categories || {})
    .filter(([, v]) => !!v)
    .map(([k]) => k);
  return { flagged: !!first.flagged, reasons };
}
