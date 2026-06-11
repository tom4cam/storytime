// GET /api/media?key=...
// Streams a stored image or audio blob to the client. Edge-cached for 1 year.

import type { Env } from './_lib/env';
import { readMedia } from './_lib/storage';

// All media keys are flat names like `{id}-v{n}-p{i}.png` / `{id}-v{n}.mp3`.
// Rejecting anything else (slashes especially) keeps this endpoint from ever
// becoming an arbitrary-key reader if namespaced objects land in the bucket.
const VALID_MEDIA_KEY = /^[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp|mp3)$/;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return new Response('Missing key', { status: 400 });
  if (!VALID_MEDIA_KEY.test(key)) return new Response('Bad key', { status: 400 });
  const result = await readMedia(env, key);
  if (!result) return new Response('Not found', { status: 404 });
  return new Response(result.data, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
