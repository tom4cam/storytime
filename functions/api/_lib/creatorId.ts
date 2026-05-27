// Parse the stable per-visitor creator_id cookie out of a Request.
// The client sets this on first visit (see apps/web/src/creatorId.ts).

export function readCreatorId(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith('creator_id=')) continue;
    const raw = trimmed.slice('creator_id='.length);
    if (!raw) return null;
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  return null;
}
