// HTTP helpers: consistent JSON responses, request body parsing, CORS.

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

export function serverError(message: string): Response {
  return json({ error: message }, 500);
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

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
