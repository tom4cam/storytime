// HTTP helpers shared by Cloudflare Pages Functions.

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

// Logs the real failure for debugging but returns a generic message —
// provider error bodies and storage internals are not for end users.
export function serverError(detail: string): Response {
  console.error(`[5xx] ${detail}`);
  return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
}

export function notFound(message = 'Not found'): Response {
  return json({ error: message }, 404);
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text) throw new Error('Empty request body');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Request body is not valid JSON');
  }
}
