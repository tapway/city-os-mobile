import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureSession, markSignedIn, clearAccessToken } from '../src/lib/auth';

describe('ensureSession cache', () => {
  beforeEach(() => {
    // node env: no DOM, and bootstrapSession reads the URL fragment
    vi.stubGlobal('window', { location: { hash: '', pathname: '/', search: '' }, history: { replaceState: () => {} } });
    clearAccessToken();
    markSignedIn(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('caches the first result for the page load', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', f);
    expect(await ensureSession()).toBe(false);
    await ensureSession();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('after a sign-in the cached false is not reused', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    expect(await ensureSession()).toBe(false); // signed-out user opened /tickets

    markSignedIn(true); // password login succeeded; no reload
    expect(await ensureSession()).toBe(true);
  });

  it('resetting (logout) makes the next check hit the server again', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', f);
    markSignedIn(true);
    expect(await ensureSession()).toBe(true);
    markSignedIn(false);
    expect(await ensureSession()).toBe(false);
    expect(f).toHaveBeenCalled();
  });
});
