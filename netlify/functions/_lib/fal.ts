// Fal.ai flux/schnell wrapper. Fast and cheap, suitable for cartoon style.
// We call the synchronous /fal-ai/flux/schnell endpoint, then download the
// image to our own storage so the story remains stable.

import { requireEnv } from './util';

interface FluxResponse {
  images?: Array<{ url: string; content_type?: string }>;
}

export async function generateImage(prompt: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const apiKey = requireEnv('FAL_KEY');
  const promptText = `${prompt}. Cartoon style, bright colors, friendly faces, child friendly illustration, no text in the image, no words.`;
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: promptText,
      image_size: 'square_hd',
      num_inference_steps: 4,
      num_images: 1,
      enable_safety_checker: true,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Fal image generation failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as FluxResponse;
  const url = body.images?.[0]?.url;
  if (!url) throw new Error('Fal returned no image URL');
  const imageRes = await fetch(url);
  if (!imageRes.ok) {
    throw new Error(`Could not download Fal image (${imageRes.status})`);
  }
  const data = await imageRes.arrayBuffer();
  const contentType = body.images?.[0]?.content_type || imageRes.headers.get('content-type') || 'image/png';
  return { data, contentType };
}
