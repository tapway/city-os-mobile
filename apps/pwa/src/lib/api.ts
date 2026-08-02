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

function buildHeaders(init: RequestInit, token: string | null): Headers {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Only set Content-Type for requests with a body (POST/PATCH/PUT)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers = buildHeaders(init, token);

  const resp = await fetch(input, { ...init, headers, credentials: 'include' });

  if (resp.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryHeaders = buildHeaders(init, newToken);
      return fetch(input, { ...init, headers: retryHeaders, credentials: 'include' });
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
  // Handle 204 No Content or empty body
  if (resp.status === 204 || resp.headers.get('content-length') === '0') {
    return null as T;
  }
  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null as T;
  }
  return resp.json() as Promise<T>;
}