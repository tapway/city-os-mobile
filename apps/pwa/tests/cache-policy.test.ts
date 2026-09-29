import { describe, expect, it } from 'vitest';
import {
  STALE_CACHE_NAMES,
  shouldBypassServiceWorkerCache,
} from '../src/lib/cache-policy';

describe('service worker cache policy', () => {
  it('never caches authenticated traffic', () => {
    // Cache Storage is keyed by URL, not by user: a cached response here is
    // handed to whoever opens the app next — on a shared handset, one officer
    // reading the previous officer's tickets.
    for (const path of [
      '/api/v1/events',
      '/api/v1/events/CH-2026-01219',
      '/api/tickets/CH-2026-01219/timeline',
      '/api/uploads/mobile-attachments/x/y.png',
      '/auth/refresh',
      '/auth/me',
    ]) {
      expect(shouldBypassServiceWorkerCache(path), path).toBe(true);
    }
  });

  it('still lets the app shell be served from cache', () => {
    // The shell is what makes the app usable offline; only per-session data is
    // excluded.
    for (const path of ['/', '/tickets', '/attendance', '/assets/index-abc.js']) {
      expect(shouldBypassServiceWorkerCache(path), path).toBe(false);
    }
  });

  it('purges the bucket written by earlier builds', () => {
    // Responses cached before this policy existed would otherwise outlive it.
    expect([...STALE_CACHE_NAMES]).toContain('api-cache');
  });
});