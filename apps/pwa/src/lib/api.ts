/**
 * Auth-aware fetch wrapper with auto-refresh on 401.
 * Uses the BFF proxy for all API calls. The BFF injects the access token
 * into upstream requests to City Help.
 */
import { getAccessToken, refreshAccessToken } from './auth';
import { getLang, translate, type Lang, type MessageKey, type Msg } from '../i18n';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
    /** Set when the text is one of our own fallbacks, so it re-translates on a language toggle. */
    public msg?: Msg,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** An ApiError whose text is a translated app message rather than server text. */
function keyedError(status: number, key: MessageKey, data?: unknown): ApiError {
  return new ApiError(status, translate(getLang(), key), data, { key });
}

/**
 * Pull the human-readable reason out of a FastAPI / City Help error body.
 *
 * City Help's ErrorBody is `{detail: {code, message_en, message_bm}}`; the
 * message in the active language wins, then the other one, then the code.
 */
export function errorDetail(payload: unknown, lang: Lang = getLang()): string | null {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try {
      return errorDetail(JSON.parse(payload), lang);
    } catch {
      return payload.slice(0, 300) || null;
    }
  }
  if (typeof payload === 'object') {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const d = detail as { code?: unknown; message_en?: unknown; message_bm?: unknown };
      const [first, second] = lang === 'ms' ? [d.message_bm, d.message_en] : [d.message_en, d.message_bm];
      for (const m of [first, second, d.code]) if (typeof m === 'string' && m) return m;
      return null;
    }
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

/** The City Help ErrorBody `detail.code` (e.g. `ticket_locked`), from a parsed body or its JSON text. */
export function errorCode(payload: unknown): string | null {
  if (typeof payload === 'string') {
    try {
      return errorCode(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  const detail = (payload as { detail?: unknown } | null)?.detail;
  const code = detail && typeof detail === 'object' ? (detail as { code?: unknown }).code : null;
  return typeof code === 'string' ? code : null;
}

/** A locked ticket answers every FSM action with 409 `ticket_locked` (City Help T3). */
export function isTicketLocked(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && errorCode(err.data) === 'ticket_locked';
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

/**
 * True when the failure is "the request never left the device".
 *
 * A queued update is only safe for this case: a 4xx is the server rejecting the
 * content, and replaying it would fail forever.
 */
export function isOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  // fetch rejects with a TypeError when the request never leaves the device —
  // and apiFetch turns that into a status-0 ApiError, which has no HTTP status
  // to inspect.
  if (err instanceof ApiError) return err.status === 0;
  return err instanceof TypeError;
}

/**
 * True when a failed live update should be kept in the queue instead of shown as an error.
 *
 * Offline, and 401: a session that lapsed mid-shift says nothing about the
 * update, so the officer's work (and its evidence) is kept and sent after they
 * sign in again (Ruling M-4, applied to the live path).
 */
export function shouldQueue(err: unknown): boolean {
  return isOfflineError(err) || (err instanceof ApiError && err.status === 401);
}

/**
 * `fetch` that turns a transport failure into an ApiError.
 *
 * A request that never left the device has no status code, and a bare
 * `TypeError: Failed to fetch` tells an officer nothing. Status 0 keeps it
 * distinguishable from a real HTTP failure — notably so the evidence cleanup
 * does not fire for it.
 */
async function doFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw keyedError(0, 'err.offline');
  }
}

export async function apiFetch(
  input: string,
  init: ApiFetchOptions = {},
): Promise<Response> {
  const { noRetry, ...rest } = init;
  const token = getAccessToken();
  const headers = buildHeaders(rest, token);

  const resp = await doFetch(input, { ...rest, headers, credentials: 'include' });

  if (resp.status === 401 && !noRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryHeaders = buildHeaders(rest, newToken);
      const retried = await doFetch(input, { ...rest, headers: retryHeaders, credentials: 'include' });
      if (retried.status !== 401) {
        if (!retried.ok) throw await toApiError(retried);
        return retried;
      }
    }
    throw keyedError(401, 'err.sessionExpired');
  }

  if (!resp.ok) {
    throw await toApiError(resp);
  }

  return resp;
}

async function toApiError(resp: Response): Promise<ApiError> {
  const text = await resp.text().catch(() => '');
  return toApiErrorFromText(resp.status, text);
}

/** Build the ApiError for a non-2xx response body, in the active language. */
export function toApiErrorFromText(status: number, text: string): ApiError {
  const detail = errorDetail(text);
  if (detail) return new ApiError(status, detail, text);
  const key: MessageKey =
    status === 403 ? 'err.forbidden' : status === 404 ? 'err.notFound' : status >= 500 ? 'err.server' : 'err.api';
  return new ApiError(status, translate(getLang(), key, { status }), text, { key, vars: { status } });
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