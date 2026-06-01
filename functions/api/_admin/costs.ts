// GET /api/_admin/costs
// Returns the current month's MonthlyCosts JSON. Admin-only.

import type { Env } from '../_lib/env';
import { isAdminRequest } from '../_lib/adminAuth';
import { getCurrentMonthlyCosts } from '../_lib/costs';
import { recordAdminAction } from '../_lib/adminAudit';
import { json } from '../_lib/util';

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAdminRequest(request, env)) return forbidden();
  const costs = await getCurrentMonthlyCosts(env);
  const cap = env.MONTHLY_COST_LIMIT_USD ? parseFloat(env.MONTHLY_COST_LIMIT_USD) : 10;
  void recordAdminAction(env, { action: 'list_flagged', detail: { sub: 'costs_read' } });
  return json({ costs, cap_usd: cap });
};
