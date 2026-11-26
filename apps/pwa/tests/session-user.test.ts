import { describe, it, expect, vi, afterEach } from 'vitest';
import { setAccessToken, getSessionUser, hydrateUser, clearAccessToken } from '../src/lib/auth';

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

afterEach(() => {
  clearAccessToken();
  vi.unstubAllGlobals();
});

describe('rememberUser keeps the hydrated identity', () => {
  it('a refreshed token without preferred_username does not erase the username', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ sub: 's1', username: 'ali', name: 'Ali', roles: ['handling_staff'] }), { status: 200 })));
    await hydrateUser();
    setAccessToken(jwt({ name: 'Ali', realm_access: { roles: ['handling_staff'] } }), 300);
    expect(getSessionUser()?.username).toBe('ali');
    expect(getSessionUser()?.sub).toBe('s1');
  });
  it('a token that has the claims still wins', async () => {
    setAccessToken(jwt({ preferred_username: 'budi', sub: 's2' }), 300);
    expect(getSessionUser()?.username).toBe('budi');
  });
});
