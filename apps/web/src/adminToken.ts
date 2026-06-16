// Admin override for delete operations. The admin installs themselves
// by visiting `/?admin=<ADMIN_TOKEN>` once; we lift the token into
// localStorage and strip it from the URL so it doesn't leak via copy-
// paste or referer. The api layer reads getAdminToken() and sends it
// in the X-Admin-Token header on delete requests.

const STORAGE_KEY = 'storyMaker.adminToken';
// The /admin page signs in via sessionStorage under this key. We fall back to
// it so a single sign-in (either flow) powers admin actions everywhere —
// otherwise signing in on /admin leaves the story-page delete button dead, and
// a rotated token leaves a stale localStorage value silently 403-ing.
const SESSION_KEY = 'storyMaker.adminSessionToken';
const QUERY_PARAM = 'admin';

export function getAdminToken(): string | null {
  try {
    const persistent = window.localStorage.getItem(STORAGE_KEY);
    if (persistent) return persistent;
  } catch { /* ignore */ }
  try { return window.sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}

export function isAdmin(): boolean {
  const t = getAdminToken();
  return typeof t === 'string' && t.length > 0;
}

// Clear both stores. Called when an admin request is rejected (403) so a stale
// or rotated token stops being resent and the operator is prompted to re-auth.
export function clearAdminToken(): void {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
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
