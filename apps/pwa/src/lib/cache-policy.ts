/**
 * What the service worker is allowed to cache.
 *
 * Kept in a plain module (no workbox imports) so the policy can be unit-tested:
 * a predicate living inline in `sw.ts` cannot be imported by vitest, which is
 * how the original cache-everything rule survived review.
 */

/** Path prefixes that are per-session and must never be served from Cache Storage. */
export const BYPASS_PREFIXES = ['/api/', '/auth/'] as const;

/** Cache buckets written by earlier builds that must be purged on activate. */
export const STALE_CACHE_NAMES = ['api-cache'] as const;

/**
 * True when a request must go straight to the network.
 *
 * Cache Storage is keyed by URL, not by user, so caching a response under
 * `/api/...` hands it to whoever opens the app next — on a shared handset, one
 * officer reading the previous officer's tickets.
 */
export function shouldBypassServiceWorkerCache(pathname: string): boolean {
  return BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}