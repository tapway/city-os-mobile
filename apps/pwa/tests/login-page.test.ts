import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginBody } from '../src/routes/login';

describe('LoginBody', () => {
  const noop = () => {};
  const render = (mode: 'password' | 'pkce' | null) =>
    renderToStaticMarkup(createElement(LoginBody, { mode, onPkce: noop, onPasswordSuccess: noop }));

  it('password mode shows the form and no City Guard button', () => {
    const html = render('password');
    expect(html).toContain('login-username');
    expect(html).not.toContain('Sign in with City Guard');
  });

  it('pkce mode keeps the City Guard button and no form', () => {
    const html = render('pkce');
    expect(html).toContain('Sign in with City Guard');
    expect(html).not.toContain('login-username');
  });

  it('shows a disabled checking state until the mode is known', () => {
    const html = render(null);
    expect(html).toContain('Checking session');
    expect(html).not.toContain('login-username');
  });
});
