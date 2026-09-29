/**
 * In-memory access token storage. NEVER persisted to localStorage/sessionStorage.
 *
 * Refresh happens via BFF /auth/refresh (HttpOnly cookie), so an app reload or
 * a phone waking from sleep has no in-memory token but may still hold a valid
 * 12h refresh cookie. `bootstrapSession()` is what turns that cookie back into
 * a usable session — screens must await it before deciding the user is signed out.
 */

let accessToken: string | null = null;
let expiresAt = 0;

/** Single-flight guard: concurrent 401s must not each hit /auth/refresh. */
let refreshInFlight: Promise<string | null> | null = null;

/** Mirrors the JWT payload so the UI can show who is signed in / attribute notes. */
export interface SessionUser {
  sub: string | null;
  name: string | null;
  username: string | null;
  roles: string[];
}

let currentUser: SessionUser | null = null;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rememberUser(token: string): void {
  const claims = decodeJwtPayload(token);
  if (!claims) return;
  const realmAccess = (claims.realm_access as { roles?: string[] } | undefined) || undefined;
  currentUser = {
    sub: (claims.sub as string) ?? null,
    name: (claims.name as string) ?? null,
    username: (claims.preferred_username as string) ?? null,
    roles: realmAccess?.roles ?? [],
  };
}

export function setAccessToken(token: string, expiresInSec: number): void {
  accessToken = token;
  expiresAt = Date.now() + expiresInSec * 1000;
  rememberUser(token);
}

/**
 * Treat a token as spent this long before it actually expires, so a request
 * cannot race the expiry mid-flight. The margin is applied at read time (not
 * baked into the stored expiry) so a caller that passes 0 — "already expired" —
 * gets an expired token, not one kept alive by the margin itself.
 */
const EXPIRY_MARGIN_MS = 30_000;

export function getAccessToken(): string | null {
  if (!accessToken) return null;
  if (Date.now() >= expiresAt - EXPIRY_MARGIN_MS) return null;
  return accessToken;
}

export function getSessionUser(): SessionUser | null {
  return currentUser;
}

/** Actor string used for API writes — the human readable name, never a raw sub. */
export function getActor(): string {
  // The actor is persisted — on ticket events, and as the user_refs foreign key
  // in ticket_attendance_logs — so it must be a stable identifier. The display
  // name is not one: it carries spaces and matches no user_refs.id, so sending
  // it makes every GPS/attendance write fail its foreign key.
  return currentUser?.username || currentUser?.sub || 'mobile';
}

export function clearAccessToken(): void {
  accessToken = null;
  expiresAt = 0;
  currentUser = null;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const resp = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!resp.ok) {
        clearAccessToken();
        return null;
      }
      const data = (await resp.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;
      setAccessToken(data.access_token, data.expires_in ?? 300);
      return data.access_token;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Establish a session on app start / resume.
 *
 * Order matters: an access token may already be in memory (same tab), the
 * callback fragment may carry a fresh one (return from Keycloak), and only if
 * neither exists do we spend a network round trip on the refresh cookie.
 */
export async function bootstrapSession(): Promise<boolean> {
  if (!getAccessToken() && !initFromCallbackFragment()) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) return false;
  }
  // The identity comes from the BFF: this realm's access token carries neither
  // preferred_username nor sub, so it cannot say who is signed in.
  if (!currentUser || !currentUser.username) await hydrateUser();
  return true;
}

/**
 * Ask the BFF who we are. The access token this realm issues carries only a
 * display name, and the app needs a stable identifier for attribution and for
 * the attendance/GPS foreign key — the BFF reads it from the ID token it holds.
 */
export async function hydrateUser(): Promise<SessionUser | null> {
  try {
    const resp = await fetch('/auth/me', { credentials: 'include' });
    if (!resp.ok) return currentUser; // keep whatever we already have
    const me = (await resp.json()) as Partial<SessionUser>;
    currentUser = {
      sub: me.sub ?? null,
      username: me.username ?? null,
      name: me.name ?? null,
      roles: me.roles ?? [],
    };
    return currentUser;
  } catch {
    return currentUser;
  }
}

export function initFromCallbackFragment(): boolean {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  const expiresIn = params.get('expires_in');
  if (token && expiresIn) {
    setAccessToken(token, Number(expiresIn));
    // Drop the fragment so the token does not linger in history / referrer.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return true;
  }
  return false;
}

export function loginRedirect(): void {
  const returnTo = window.location.pathname + window.location.search;
  const target = returnTo && returnTo !== '/login' ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
  window.location.href = `/auth/login${target}`;
}

/** Drop everything the service worker stored for this session.
 *
 * Cache Storage is keyed by URL rather than by user, so a handset that changes
 * hands must not keep the previous officer's responses. The shell is
 * re-precached on the next load, so clearing everything is safe.
 */
async function clearCachedResponses(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  } catch {
    // Storage unavailable (private mode, quota) — nothing to clear.
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    await clearCachedResponses();
    clearAccessToken();
    window.location.href = '/login';
  }
}