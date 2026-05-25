import type { Context } from '@netlify/functions';
import { readMedia } from './_lib/storage';

// Streams a stored image or audio blob to the client. Keys look like
// "{storyId}-v{n}-p{i}.png" for images or "{storyId}-v{n}.mp3" for audio.
export default async (req: Request, _ctx: Context): Promise<Response> => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  if (!key) return new Response('Missing key', { status: 400 });
  const result = await readMedia(key);
  if (!result) return new Response('Not found', { status: 404 });
  return new Response(result.data, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      // Browser cache (per user).
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Netlify edge cache (shared across users) — repeats are served by the
      // CDN without invoking the function or hitting Blobs.
      'Netlify-CDN-Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
