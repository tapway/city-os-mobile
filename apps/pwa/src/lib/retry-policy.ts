/** How often a waiting queue is retried while the app is open and online. */
export const RETRY_INTERVAL_MS = 30_000;

/**
 * Whether the queue should be retried on a timer / focus.
 *
 * A 401 pause is excluded: it resumes on sign-in, and retrying would only hit
 * the refresh endpoint every 30 s with a session that is already gone.
 */
export function shouldAutoRetry(s: { pending: number; online: boolean; authRequired: boolean }): boolean {
  return s.pending > 0 && s.online && !s.authRequired;
}
