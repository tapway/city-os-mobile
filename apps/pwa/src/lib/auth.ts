/**
 * In-memory access token storage. NEVER persisted to localStorage/sessionStorage.
 * Refresh happens via BFF /auth/refresh (HttpOnly cookie).
 */

let accessToken: string | null = null;
let expiresAt: number = 0;

export function setAccessToken(token: string, expiresInSec: number): void {
  accessToken = token;
  expiresAt = Date.now() + expiresInSec * 1000;
}

export function getAccessToken(): string | null {
  if (!accessToken) return null;
  if (Date.now() >= expiresAt) return null;
  return accessToken;
}

export function clearAccessToken(): void {
  accessToken = null;
  expiresAt = 0;
}

export async function refreshAccessToken(): Promise<string | null> {
  try {
    const resp = await fetch('/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.access_token) {
      setAccessToken(data.access_token, data.expires_in ?? 300);
      return data.access_token;
    }
    return null;
  } catch {
    return null;
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
    window.history.replaceState(null, '', window.location.pathname);
    return true;
  }
  return false;
}

export function loginRedirect(): void {
  window.location.href = '/auth/login';
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  clearAccessToken();
  window.location.href = '/login';
}