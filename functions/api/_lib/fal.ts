import type { Env } from './env';
import { requireEnv } from './env';
import { classifyError, notifyAdminFailure } from './alerts';
import { recordCost } from './costs';
import { fetchWithRetry } from './retry';

interface FalImageResponse {
  images: Array<{ url: string; content_type?: string }>;
}

export async function generateImage(env: Env, prompt: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const apiKey = requireEnv(env, 'FAL_KEY');
  const promptText = `${prompt}. Cartoon style, bright colors, friendly faces, child friendly illustration, no text in the image, no words.`;
  let res: Response;
  try {
    res = await fetchWithRetry('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: promptText,
        image_size: 'square_hd',
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: true,
      }),
    }, { timeoutMs: 30_000 });
  } catch (e) {
    await notifyAdminFailure(env, 'fal', 'network_error', (e as Error).message);
    throw e;
  }
  if (!res.ok) {
    const detail = await res.text();
    const kind = classifyError(res.status);
    if (kind) await notifyAdminFailure(env, 'fal', kind, `${res.status}: ${detail.slice(0, 500)}`);
    throw new Error(`Fal image generation failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as FalImageResponse;
  const url = body.images?.[0]?.url;
  if (!url) throw new Error('Fal returned no image URL');
  const imgRes = await fetchWithRetry(url, {}, { timeoutMs: 15_000 });
  if (!imgRes.ok) throw new Error(`Could not download Fal image (${imgRes.status})`);
  const data = await imgRes.arrayBuffer();
  const contentType = body.images[0].content_type || imgRes.headers.get('content-type') || 'image/png';
  // Fal flux/schnell: $0.02 per image.
  void recordCost(env, 'fal', 'image', 0.02);
  return { data, contentType };
}
