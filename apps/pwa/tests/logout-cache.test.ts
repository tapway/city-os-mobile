import { describe, it, expect, vi, afterEach } from 'vitest';
import { cachesToClear } from '../src/lib/cache-policy';

describe('logout cache clearing', () => {
  it('keeps workbox precache buckets (the app shell) and drops everything else', () => {
    expect(
      cachesToClear(['workbox-precache-v2-https://x/', 'api-cache', 'images', 'workbox-runtime-x']),
    ).toEqual(['api-cache', 'images', 'workbox-runtime-x']);
  });
  afterEach(() => vi.unstubAllGlobals());
});
