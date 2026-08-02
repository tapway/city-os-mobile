import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAccessToken, setAccessToken, clearAccessToken } from '../src/lib/auth';

describe('in-memory auth token', () => {
  beforeEach(() => clearAccessToken());

  it('stores and retrieves a token', () => {
    setAccessToken('test-token-123', 300);
    expect(getAccessToken()).toBe('test-token-123');
  });

  it('clears the token on clearAccessToken', () => {
    setAccessToken('test-token-123', 300);
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it('returns null when no token is set', () => {
    expect(getAccessToken()).toBeNull();
  });

  it('returns null when token is expired', () => {
    setAccessToken('expired-token', 0); // 0 seconds = already expired
    expect(getAccessToken()).toBeNull();
  });
});