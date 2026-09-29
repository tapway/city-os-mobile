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

/** Pull the human-readable reason out of a FastAPI error body. */
export function errorDetail(payload: unknown): string | null {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try {
      return errorDetail(JSON.parse(payload));
    } catch {
      return payload.slice(0, 300) || null;
    }
  }
  if (typeof payload === 'object') {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    // FastAPI validation errors: [{loc, msg, type}, ...]
    if (Array.isArray(detail)) {
      return detail
        .map((d) => {
          if (typeof d === 'string') return d;
          const loc = Array.isArray((d as { loc?: unknown[] }).loc)
            ? (d as { loc: unknown[] }).loc.slice(1).join('.')
            : '';
          const msg = (d as { msg?: string }).msg ?? JSON.stringify(d);
          return loc ? `${loc}: ${msg}` : msg;
        })
        .join('; ');
    }
  }
  return null;
}

function buildHeaders(init: RequestInit, token: string | null): Headers {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Only set Content-Type for requests with a body. FormData must keep the
  // boundary the browser generated, so never force JSON onto it.
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

export interface ApiFetchOptions extends RequestInit {
  /** Skip the 401 → refresh → retry dance (used by the refresh path itself). */
  noRetry?: boolean;
}

export async function apiFetch(
  input: string,
  init: ApiFetchOptions = {},
): Promise<Response> {
  const { noRetry, ...rest } = init;
  const token = getAccessToken();
  const headers = buildHeaders(rest, token);

  const resp = await fetch(input, { ...rest, headers, credentials: 'include' });

  if (resp.status === 401 && !noRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryHeaders = buildHeaders(rest, newToken);
      const retried = await fetch(input, { ...rest, headers: retryHeaders, credentials: 'include' });
      if (retried.status !== 401) {
        if (!retried.ok) throw await toApiError(retried);
        return retried;
      }
    }
    throw new ApiError(401, 'Session expired — please sign in again');
  }

  if (!resp.ok) {
    throw await toApiError(resp);
  }

  return resp;
}

async function toApiError(resp: Response): Promise<ApiError> {
  const text = await resp.text().catch(() => '');
  const detail = errorDetail(text);
  const fallback =
    resp.status === 403
      ? 'You do not have permission to do that'
      : resp.status === 404
        ? 'Not found'
        : resp.status >= 500
          ? 'The server had a problem — please try again'
          : `API error ${resp.status}`;
  return new ApiError(resp.status, detail || fallback, text);
}

export async function apiJson<T = unknown>(input: string, init?: ApiFetchOptions): Promise<T> {
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

/** POST a file (or anything multipart) with auth + refresh handling. */
export async function apiUpload<T = unknown>(
  input: string,
  form: FormData,
): Promise<T> {
  return apiJson<T>(input, { method: 'POST', body: form });
}