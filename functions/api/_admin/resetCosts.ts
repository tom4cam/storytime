// POST /api/_admin/resetCosts
// Zeroes the current month's cost JSON. Admin-only.

import type { Env } from '../_lib/env';
import { isAdminRequest } from '../_lib/adminAuth';
import { resetMonthlyCosts } from '../_lib/costs';
import { recordAdminAction } from '../_lib/adminAudit';
import { json } from '../_lib/util';

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAdminRequest(request, env)) return forbidden();
  const fresh = await resetMonthlyCosts(env);
  void recordAdminAction(env, { action: 'reset_costs', detail: { month: fresh.month } });
  return json({ ok: true, costs: fresh });
};
