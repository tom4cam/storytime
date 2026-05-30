// Append-only audit log for admin actions. One JSONL object per write,
// stored at `_admin/audit-{YYYY-MM}.log` in the STORIES bucket. We never
// read these from the app; they exist for after-the-fact review.

import type { Env } from './env';

export interface AdminAuditEntry {
  action: 'delete_story' | 'delete_story_version';
  story_id: string;
  version?: number;
  detail?: Record<string, unknown>;
  request_id?: string;
}

function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `_admin/audit-${y}-${m}.log`;
}

export async function recordAdminAction(env: Env, entry: AdminAuditEntry): Promise<void> {
  const now = new Date();
  const key = monthKey(now);
  const line = JSON.stringify({ ts: now.toISOString(), ...entry }) + '\n';
  try {
    const existing = await env.STORIES.get(key);
    const prev = existing ? await existing.text() : '';
    await env.STORIES.put(key, prev + line, {
      httpMetadata: { contentType: 'application/x-ndjson' },
    });
  } catch (e) {
    // Never block the user-facing action on audit-log failure.
    console.warn(`[audit] write failed: ${(e as Error).message}`);
  }
}
