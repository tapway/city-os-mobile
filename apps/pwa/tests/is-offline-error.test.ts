import { describe, expect, it, vi, afterEach } from 'vitest';

import { ApiError, isOfflineError } from '../src/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('isOfflineError', () => {
  it('treats a failed fetch as offline, so the update gets queued', () => {
    // fetch rejects with a TypeError when the request never leaves the device.
    expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('treats a server rejection as not-offline, so it is never queued', () => {
    // A 4xx is the server refusing the content: replaying it would fail for ever
    // and the officer would see a permanent "waiting to sync".
    expect(isOfflineError(new ApiError(422, 'bad coordinates'))).toBe(false);
    expect(isOfflineError(new ApiError(500, 'boom'))).toBe(false);
  });

  it('recognises the transport failure apiFetch raises', () => {
    // No HTTP status exists for a request that never left the device.
    expect(isOfflineError(new ApiError(0, 'You appear to be offline'))).toBe(true);
  });

  it('believes the browser when it reports no connection', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOfflineError(new ApiError(500, 'boom'))).toBe(true);
  });
});
