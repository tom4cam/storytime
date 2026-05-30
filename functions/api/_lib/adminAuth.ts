// Admin override. Requests presenting `X-Admin-Token: <env.ADMIN_TOKEN>`
// are treated as the admin and bypass cookie-based ownership checks.
// When ADMIN_TOKEN is unset, no request can authenticate as admin.

import type { Env } from './env';

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAdminRequest(request: Request, env: Env): boolean {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return false;
  const presented = request.headers.get('X-Admin-Token');
  if (!presented) return false;
  return constantTimeEqual(presented, expected);
}
