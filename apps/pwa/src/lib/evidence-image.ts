/**
 * Loading a ticket's stored evidence photos.
 *
 * Photos imported from Jira live at `/api/storage/...`, which City Help serves
 * only to a signed-in caller. An <img> tag cannot send an Authorization header,
 * so a bare `<img src="/api/storage/...">` is refused and shows as a broken
 * image. Those photos are fetched with the signed-in client and shown from a
 * blob: URL instead (City Help's own web app does the same).
 *
 * Kept free of React so the rules can be unit-tested in node.
 */
import { ApiError, apiFetch } from './api';
import { storageUrl } from './help-api';

export type EvidenceSource = 'authenticated' | 'direct';

/** Paths the City Help API only serves with a bearer token. */
const AUTHENTICATED_PREFIX = '/api/storage/';

/**
 * How a stored image URL has to be loaded.
 *
 * BFF uploads (`/api/uploads/...`), absolute and data: URLs carry no token
 * requirement, so <img> can load them directly.
 */
export function evidenceSource(imageUrl: string): EvidenceSource {
  return storageUrl(imageUrl).startsWith(AUTHENTICATED_PREFIX) ? 'authenticated' : 'direct';
}

export interface EvidenceImageDeps {
  /** Signed-in GET; throws on a non-2xx answer or when offline. */
  fetcher: (path: string, signal?: AbortSignal) => Promise<Response>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** How long a download may take before it counts as failed. */
  timeoutMs?: number;
}

/** A hung request must end in the placeholder, not a forever-grey box. */
export const EVIDENCE_TIMEOUT_MS = 15_000;

export const defaultEvidenceDeps: EvidenceImageDeps = {
  fetcher: (path, signal) => apiFetch(path, { signal }),
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  timeoutMs: EVIDENCE_TIMEOUT_MS,
};

export type EvidenceLoad =
  | { status: 'ready'; src: string }
  /** `retryable`: worth trying again by itself when the network returns (not 403/404/non-image). */
  | { status: 'unavailable'; retryable: boolean };

const TIMED_OUT = Symbol('timed out');

/**
 * Download an authenticated photo and return an object URL for it, or why it
 * cannot be shown. The caller owns the returned URL and must revoke it.
 *
 * 403 and 404 (refused, deleted) and a non-image answer will not fix
 * themselves; offline, 401, 5xx and a timeout might, so they are retryable.
 */
export async function loadEvidenceImage(
  imageUrl: string,
  deps: EvidenceImageDeps = defaultEvidenceDeps,
): Promise<EvidenceLoad> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve(TIMED_OUT);
    }, deps.timeoutMs ?? EVIDENCE_TIMEOUT_MS);
  });
  const download = (async () => {
    const resp = await deps.fetcher(storageUrl(imageUrl), ctl.signal);
    return resp.blob();
  })();
  download.catch(() => {}); // a loser of the race must not surface as an unhandled rejection
  try {
    const blob = await Promise.race([download, timeout]);
    if (blob === TIMED_OUT) return { status: 'unavailable', retryable: true };
    if (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') {
      return { status: 'unavailable', retryable: false };
    }
    return { status: 'ready', src: deps.createObjectURL(blob) };
  } catch (err) {
    const gone = err instanceof ApiError && (err.status === 403 || err.status === 404);
    return { status: 'unavailable', retryable: !gone };
  } finally {
    clearTimeout(timer);
  }
}
