// Admin override for delete operations. The admin installs themselves
// by visiting `/?admin=<ADMIN_TOKEN>` once; we lift the token into
// localStorage and strip it from the URL so it doesn't leak via copy-
// paste or referer. The api layer reads getAdminToken() and sends it
// in the X-Admin-Token header on delete requests.

const STORAGE_KEY = 'storyMaker.adminToken';
const QUERY_PARAM = 'admin';

export function getAdminToken(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function isAdmin(): boolean {
  const t = getAdminToken();
  return typeof t === 'string' && t.length > 0;
}

export function clearAdminToken(): void {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// Run once at app boot. If the URL carries `?admin=<token>`, save it
// and rewrite history to drop the param.
export function installAdminTokenFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const token = url.searchParams.get(QUERY_PARAM);
  if (!token) return;
  try { window.localStorage.setItem(STORAGE_KEY, token); } catch { /* ignore */ }
  url.searchParams.delete(QUERY_PARAM);
  window.history.replaceState({}, '', url.toString());
}
