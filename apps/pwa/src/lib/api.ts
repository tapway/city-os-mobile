/**
 * Auth-aware fetch wrapper with auto-refresh on 401.
 * Uses the BFF proxy for all API calls. The BFF injects the access token
 * into upstream requests to City Help.
 */
import { getAccessToken, refreshAccessToken } from './auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('Content-Type', 'application/json');

  const resp = await fetch(input, { ...init, headers, credentials: 'include' });

  if (resp.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      return fetch(input, { ...init, headers, credentials: 'include' });
    }
    throw new ApiError(401, 'Session expired — please log in again');
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new ApiError(resp.status, `API error ${resp.status}`, text);
  }

  return resp;
}

export async function apiJson<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  const resp = await apiFetch(input, init);
  return resp.json() as Promise<T>;
}