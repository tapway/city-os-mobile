import { describe, it, expect } from 'vitest';
import { RETRY_INTERVAL_MS, shouldAutoRetry } from '../src/lib/retry-policy';

describe('I1: periodic queue retry', () => {
  it('retries every 30 s', () => expect(RETRY_INTERVAL_MS).toBe(30_000));
  it('retries while something is pending and the device is online', () => {
    expect(shouldAutoRetry({ pending: 2, online: true, authRequired: false })).toBe(true);
  });
  it('does not when nothing is pending, offline, or paused for sign-in', () => {
    expect(shouldAutoRetry({ pending: 0, online: true, authRequired: false })).toBe(false);
    expect(shouldAutoRetry({ pending: 2, online: false, authRequired: false })).toBe(false);
    expect(shouldAutoRetry({ pending: 2, online: true, authRequired: true })).toBe(false);
  });
});
