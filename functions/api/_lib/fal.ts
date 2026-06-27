import type { Env } from './env';
import { requireEnv } from './env';
import { classifyError, notifyAdminFailure } from './alerts';
import { recordCost } from './costs';
import { fetchWithRetry } from './retry';
import { recordCall } from './telemetry';

interface FalImageResponse {
  images: Array<{ url: string; content_type?: string }>;
  has_nsfw_concepts?: boolean[];
}

// flux/schnell: fast, cheap text-to-image. Each paragraph's image is generated
// independently from its (already style-wrapped) prompt. The style anchor and
// character descriptions are baked into the prompt by build.ts, so this stays
// a dumb pass-through.
const SCHNELL = 'https://fal.run/fal-ai/flux/schnell';

// EXPERIMENTAL: default image-to-image endpoint for reference-conditioned
// generation (see generateImageFromRef). flux/dev i2i is pricier than schnell.
const REF_DEFAULT_ENDPOINT = 'fal-ai/flux/dev/image-to-image';

// Encode raw image bytes as a data URI so a fal i2i endpoint can take them as
// the reference image_url without us needing a public URL for the bytes.
function toDataUri(data: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  const CHUNK = 0x8000; // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${contentType || 'image/jpeg'};base64,${btoa(binary)}`;
}

export interface GenerateImageOpts {
  // A fixed seed shared by every image in one story nudges flux toward a
  // consistent look across paragraphs (schnell has no image conditioning, so
  // this is the main lever for visual coherence). On a quality retry we vary
  // the seed so we don't regenerate the same broken image.
  seed?: number;
}

export async function generateImage(
  env: Env,
  prompt: string,
  opts: GenerateImageOpts = {},
): Promise<{ data: ArrayBuffer; contentType: string }> {
  const apiKey = requireEnv(env, 'FAL_KEY');
  const body: Record<string, unknown> = {
    prompt,
    image_size: 'square_hd',
    num_inference_steps: 4,
    num_images: 1,
    enable_safety_checker: true,
  };
  if (opts.seed !== undefined) body.seed = opts.seed;

  let res: Response;
  try {
    res = await recordCall(env, 'fal', 'image', () =>
      fetchWithRetry(SCHNELL, {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, { timeoutMs: 30_000 })
    );
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
  // flux/schnell: ~$0.003 per image at the published rate.
  void recordCost(env, 'fal', 'image', 0.003);
  return { data, contentType };
}

export interface GenerateImageFromRefOpts {
  seed?: number;
  // 0-1 denoise strength. Higher = follow the scene `prompt` more and the
  // reference image less. ~0.85 keeps character/palette cues while letting the
  // scene change.
  strength?: number;
}

// EXPERIMENTAL: image-to-image generation conditioned on a reference image
// (e.g. a character "reference sheet"), for stronger character consistency
// than text+seed alone. Posts to a configurable fal i2i endpoint with the
// reference passed as a data URI. Pricier than schnell — gated by the caller's
// IMAGE_REF_MODE flag.
export async function generateImageFromRef(
  env: Env,
  prompt: string,
  ref: { data: ArrayBuffer; contentType: string },
  opts: GenerateImageFromRefOpts = {},
): Promise<{ data: ArrayBuffer; contentType: string }> {
  const apiKey = requireEnv(env, 'FAL_KEY');
  const endpoint = (env.IMAGE_REF_ENDPOINT || REF_DEFAULT_ENDPOINT).replace(/^https?:\/\/fal\.run\//, '');
  const url = `https://fal.run/${endpoint}`;
  const body: Record<string, unknown> = {
    prompt,
    image_url: toDataUri(ref.data, ref.contentType),
    strength: opts.strength ?? 0.85,
    image_size: 'square_hd',
    num_inference_steps: 28,
    num_images: 1,
    enable_safety_checker: true,
  };
  if (opts.seed !== undefined) body.seed = opts.seed;

  let res: Response;
  try {
    res = await recordCall(env, 'fal', 'image', () =>
      fetchWithRetry(url, {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, { timeoutMs: 45_000 })
    );
  } catch (e) {
    await notifyAdminFailure(env, 'fal', 'network_error', (e as Error).message);
    throw e;
  }
  if (!res.ok) {
    const detail = await res.text();
    const kind = classifyError(res.status);
    if (kind) await notifyAdminFailure(env, 'fal', kind, `${res.status}: ${detail.slice(0, 500)}`);
    throw new Error(`Fal i2i generation failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const parsed = (await res.json()) as FalImageResponse;
  const first = parsed.images?.[0];
  const imgUrl = first?.url;
  if (!imgUrl) throw new Error('Fal returned no image URL');
  const imgRes = await fetchWithRetry(imgUrl, {}, { timeoutMs: 30_000 });
  if (!imgRes.ok) throw new Error(`Could not download Fal image (${imgRes.status})`);
  const data = await imgRes.arrayBuffer();
  const contentType = first.content_type || imgRes.headers.get('content-type') || 'image/jpeg';
  // flux/dev i2i: ~$0.025 per image at the published rate.
  void recordCost(env, 'fal', 'image', 0.025);
  return { data, contentType };
}
