import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  fetchAuthMode,
  submitPasswordLogin,
  createPasswordLoginController,
  LOGIN_ERROR_KEYS,
  loginErrorKey,
} from '../src/lib/password-login';
import { PasswordLoginFields } from '../src/routes/password-login-form';
import { clearAccessToken, getAccessToken } from '../src/lib/auth';

function reply(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchAuthMode', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the mode from /auth/config', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { mode: 'pkce' }));
    vi.stubGlobal('fetch', f);
    expect(await fetchAuthMode()).toBe('pkce');
    expect(f.mock.calls[0]![0]).toBe('/auth/config');
  });

  it('defaults to password when the config cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchAuthMode()).toBe('password');
  });
});

describe('submitPasswordLogin', () => {
  beforeEach(() => clearAccessToken());
  afterEach(() => vi.unstubAllGlobals());

  it('posts the credentials as JSON with the cookie jar', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { access_token: 'tok', expires_in: 300 }));
    vi.stubGlobal('fetch', f);
    const result = await submitPasswordLogin('ops_user', 'pw 1');
    expect(result).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/auth/password-login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ username: 'ops_user', password: 'pw 1' });
    expect(getAccessToken()).toBe('tok');
  });

  it.each([
    [401, 'login.error.401'],
    [403, 'login.error.403'],
    [422, 'login.error.422'],
    [429, 'login.error.429'],
    [503, 'login.error.503'],
  ])('reports a specific message key for %i', async (status, messageKey) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(status, { detail: 'x' })));
    expect(await submitPasswordLogin('a', 'b')).toEqual({ ok: false, messageKey });
    expect(getAccessToken()).toBeNull();
  });

  it('treats a network failure like 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await submitPasswordLogin('a', 'b')).toEqual({ ok: false, messageKey: 'login.error.503' });
  });

  it('maps statuses to keys, 5xx to 503 and anything else to generic', () => {
    expect(loginErrorKey(401)).toBe('login.error.401');
    expect(loginErrorKey(502)).toBe('login.error.503');
    expect(loginErrorKey(418)).toBe('login.error.generic');
    expect(new Set(Object.values(LOGIN_ERROR_KEYS)).size).toBe(5);
  });
});

describe('createPasswordLoginController', () => {
  it('ignores a second submit while the first is in flight', async () => {
    let release!: (v: { ok: true }) => void;
    const submit = vi.fn(() => new Promise<{ ok: true }>((r) => (release = r)));
    const onSuccess = vi.fn();
    const c = createPasswordLoginController({ submit, onSuccess });

    const first = c.submit('u', 'p');
    expect(c.getState().busy).toBe(true);
    await c.submit('u', 'p'); // double tap
    expect(submit).toHaveBeenCalledTimes(1);

    release({ ok: true });
    await first;
    expect(c.getState().busy).toBe(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('surfaces the error, clears it on the next attempt, and frees the form', async () => {
    const submit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, messageKey: 'login.error.401' })
      .mockResolvedValueOnce({ ok: true });
    const onSuccess = vi.fn();
    const c = createPasswordLoginController({ submit, onSuccess });
    const seen: (string | null)[] = [];
    c.subscribe(() => seen.push(c.getState().error));

    await c.submit('u', 'p');
    expect(c.getState()).toEqual({ busy: false, error: 'login.error.401' });
    expect(onSuccess).not.toHaveBeenCalled();

    await c.submit('u', 'p');
    expect(seen).toContain(null); // cleared when the retry started
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not call the server for blank fields', async () => {
    const submit = vi.fn();
    const c = createPasswordLoginController({ submit, onSuccess: vi.fn() });
    await c.submit('  ', 'pw');
    await c.submit('u', '');
    expect(submit).not.toHaveBeenCalled();
    expect(c.getState().error).toBe('login.error.422');
  });
});

describe('PasswordLoginFields markup', () => {
  const render = (props: { busy: boolean; error: 'login.error.401' | null }) =>
    // React's server renderer keeps camelCase prop names (autoComplete); the DOM
    // attribute is case-insensitive, so compare lower-cased.
    renderToStaticMarkup(createElement(PasswordLoginFields, { ...props, onSubmit: () => {} })).toLowerCase();

  it('has labelled, autofill-friendly inputs', () => {
    const html = render({ busy: false, error: null });
    expect(html).toMatch(/<label[^>]*for="login-username"[^>]*>username/);
    expect(html).toMatch(/<label[^>]*for="login-password"[^>]*>password/);
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('type="password"');
    expect(html).toContain('inputmode="text"');
    expect(html).toContain('autocapitalize="none"');
    expect(html).not.toContain('role="alert"');
  });

  it('shows the error inline as an alert', () => {
    const html = render({ busy: false, error: 'login.error.401' });
    expect(html).toMatch(/role="alert"[^>]*>[^<]*incorrect username or password/);
  });

  it('disables the form and says so while busy', () => {
    const html = render({ busy: true, error: null });
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('signing in');
  });
});
