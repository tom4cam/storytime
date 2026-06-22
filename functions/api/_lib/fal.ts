import type { Env } from './env';
import { requireEnv } from './env';
import { classifyError, notifyAdminFailure } from './alerts';
import { recordCost } from './costs';
import { fetchWithRetry } from './retry';

interface FalImageResponse {
  images: Array<{ url: string; content_type?: string }>;
  has_nsfw_concepts?: boolean[];
}

export interface GenerateImageOpts {
  // When set, calls flux-pro/kontext to condition the new image on this
  // reference. Used to keep characters visually consistent across the
  // paragraphs of one story: paragraph 1 is generated text-to-image, then
  // 2..N reference 1's image. Must be a fully-qualified URL fal can fetch.
  referenceImageUrl?: string;
}

const KONTEXT_T2I = 'https://fal.run/fal-ai/flux-pro/kontext/text-to-image';
const KONTEXT_EDIT = 'https://fal.run/fal-ai/flux-pro/kontext';

export async function generateImage(
  env: Env,
  prompt: string,
  opts: GenerateImageOpts = {},
): Promise<{ data: ArrayBuffer; contentType: string; sourceUrl: string }> {
  const apiKey = requireEnv(env, 'FAL_KEY');
  const isConditioned = !!opts.referenceImageUrl;
  const endpoint = isConditioned ? KONTEXT_EDIT : KONTEXT_T2I;
  const body: Record<string, unknown> = {
    prompt,
    aspect_ratio: '1:1',
    output_format: 'jpeg',
    safety_tolerance: '2',
    num_images: 1,
  };
  if (isConditioned) body.image_url = opts.referenceImageUrl;

  let res: Response;
  try {
    res = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, { timeoutMs: 60_000 });
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
  const parsed = (await res.json()) as FalImageResponse;
  const first = parsed.images?.[0];
  const url = first?.url;
  if (!url) throw new Error('Fal returned no image URL');
  const imgRes = await fetchWithRetry(url, {}, { timeoutMs: 30_000 });
  if (!imgRes.ok) throw new Error(`Could not download Fal image (${imgRes.status})`);
  const data = await imgRes.arrayBuffer();
  const contentType = first.content_type || imgRes.headers.get('content-type') || 'image/jpeg';
  // flux-pro/kontext (both variants): $0.04 per image at the published rate.
  void recordCost(env, 'fal', 'image', 0.04);
  return { data, contentType, sourceUrl: url };
}
