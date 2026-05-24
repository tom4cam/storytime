import type { Context } from '@netlify/functions';
import { buildAndSaveVersion } from './_lib/build';
import { getStoryIndex, getStoryVersion } from './_lib/storage';
import { badRequest, json, notFound, readJson, serverError } from './_lib/util';

interface UpdateStoryRequest {
  id: string;
  title: string;
  paragraphs: { text: string; image_url: string | null; image_prompt?: string; regenerate_image?: boolean }[];
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== 'POST') return badRequest('POST only');
  let body: UpdateStoryRequest;
  try {
    body = await readJson<UpdateStoryRequest>(req);
  } catch (e) {
    return badRequest((e as Error).message);
  }
  if (!body.id) return badRequest('Missing story id');
  if (!Array.isArray(body.paragraphs) || body.paragraphs.length === 0) {
    return badRequest('paragraphs must be a non empty array');
  }
  const idx = await getStoryIndex(body.id);
  if (!idx) return notFound('That story does not exist.');
  const previous = await getStoryVersion(body.id, idx.latest_version);
  try {
    const next = await buildAndSaveVersion({
      id: body.id,
      version: idx.latest_version + 1,
      title: body.title || idx.title,
      sourceAnswers: previous?.source_answers ?? [],
      paragraphs: body.paragraphs.map((p) => ({
        text: p.text,
        image_url: p.image_url ?? null,
        image_prompt: p.image_prompt,
        regenerate_image: !!p.regenerate_image,
      })),
    });
    return json(next);
  } catch (e) {
    console.error('updateStory failed', e);
    return serverError((e as Error).message);
  }
};
