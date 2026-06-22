// GET /api/_admin/telemetry
// Returns this month's per-provider / per-kind counters plus any story
// versions still in `status=generating` more than `stuckMin` minutes old.
// Pass `?stuckMin=N` to override the default threshold (5 minutes).

import type { Env } from '../_lib/env';
import { isAdminRequest } from '../_lib/adminAuth';
import { findStuckStories, getCurrentTelemetry } from '../_lib/telemetry';
import { json } from '../_lib/util';

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAdminRequest(request, env)) return forbidden();

  const url = new URL(request.url);
  const stuckMinStr = url.searchParams.get('stuckMin');
  const stuckMin = stuckMinStr ? parseInt(stuckMinStr, 10) : 5;
  const threshold = Number.isFinite(stuckMin) && stuckMin > 0 ? stuckMin : 5;

  const [counters, stuck] = await Promise.all([
    getCurrentTelemetry(env),
    findStuckStories(env, threshold),
  ]);

  return json({
    month: counters.month,
    updated_at: counters.updated_at,
    by_provider: counters.by_provider,
    by_kind: counters.by_kind,
    stuck_stories: stuck,
    stuck_threshold_minutes: threshold,
  });
};
