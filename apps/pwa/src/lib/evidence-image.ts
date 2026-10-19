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
import { apiFetch } from './api';
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
  fetcher: (path: string) => Promise<Response>;
  createObjectURL: (blob: Blob) => string;
}

const defaultDeps = (): EvidenceImageDeps => ({
  fetcher: (path) => apiFetch(path),
  createObjectURL: (blob) => URL.createObjectURL(blob),
});

/**
 * Download an authenticated photo and return an object URL for it, or null when
 * it cannot be shown (refused, deleted, storage down, offline, or not an image).
 * The caller owns the returned URL and must revoke it.
 */
export async function loadEvidenceImage(
  imageUrl: string,
  deps: EvidenceImageDeps = defaultDeps(),
): Promise<string | null> {
  try {
    const resp = await deps.fetcher(storageUrl(imageUrl));
    const blob = await resp.blob();
    if (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') return null;
    return deps.createObjectURL(blob);
  } catch {
    return null;
  }
}
