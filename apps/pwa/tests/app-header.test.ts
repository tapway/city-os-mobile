import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppHeader } from '../src/routes/app-header';
import { en } from '../src/i18n/en';
import { ms } from '../src/i18n/ms';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/styles.css'), 'utf8');
const toggleSrc = readFileSync(resolve(here, '../src/i18n/LanguageToggle.tsx'), 'utf8');
const rootSrc = readFileSync(resolve(here, '../src/routes/__root.tsx'), 'utf8');

/** The declarations of the first rule for `selector` (outside any @media block). */
function rule(selector: string): string {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`));
  expect(m, `styles.css needs a ${selector} rule`).not.toBeNull();
  return m![1]!;
}

describe('AppHeader markup', () => {
  const html = renderToStaticMarkup(createElement(AppHeader, { onSignOut: () => {} }));

  it('shows the title, both language buttons and Sign out', () => {
    expect(html).toContain(en['app.header']);
    expect(html).toContain('>EN<');
    expect(html).toContain('>BM<');
    expect(html).toContain(en['app.signOut']);
  });

  it('Sign out keeps its accessible name when the text is hidden on narrow screens', () => {
    expect(html).toMatch(new RegExp(`<button[^>]*aria-label="${en['app.signOut']}"`));
    expect(html).toMatch(/<span class="signout-label">Sign out<\/span>/);
  });

  it('the icon is decorative and the title is one element the CSS can ellipsize', () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/<span class="topbar-title"[^>]*>City OS Operations<\/span>/);
  });

  it('has a Bahasa Melayu name for the button and the title', () => {
    expect(ms['app.signOut']).toBeTruthy();
    expect(ms['app.signOut']).not.toBe(en['app.signOut']);
    expect(ms['app.header']).not.toBe(en['app.header']);
  });
});

describe('header stays on one line (360px and up)', () => {
  it('the bar never wraps and the title shrinks to an ellipsis instead of wrapping', () => {
    expect(rule('.topbar')).toMatch(/display:\s*flex/);
    expect(rule('.topbar')).toMatch(/flex-wrap:\s*nowrap/);
    const title = rule('.topbar-title');
    expect(title).toMatch(/min-width:\s*0/);
    expect(title).toMatch(/white-space:\s*nowrap/);
    expect(title).toMatch(/overflow:\s*hidden/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('the Sign out text never wraps, and below ~440px it is hidden visually but not from screen readers', () => {
    expect(rule('.topbar-btn')).toMatch(/white-space:\s*nowrap/);
    const media = css.match(/@media\s*\(max-width:\s*(\d+)px\)\s*\{[^@]*?\.signout-label\s*\{([^}]*)\}/);
    expect(media, 'styles.css needs a max-width media rule for .signout-label').not.toBeNull();
    expect(Number(media![1])).toBeGreaterThanOrEqual(400);
    expect(media![2]).toMatch(/clip/);
    expect(media![2]).not.toMatch(/display:\s*none/);
  });

  it('header controls meet the 44px touch target and the text stays at 12px or more', () => {
    expect(rule('.topbar-btn')).toMatch(/min-height:\s*44px/);
    expect(rule('.topbar-btn')).toMatch(/min-width:\s*44px/);
    expect(toggleSrc).toMatch(/minHeight:\s*44/);
    expect(toggleSrc).toMatch(/minWidth:\s*44/);
    expect(rule('.topbar-title')).toMatch(/font-size:\s*1[2-9]px/);
    expect(rule('.topbar-btn')).toMatch(/font-size:\s*1[2-9]px/);
  });

  it('the root layout uses AppHeader rather than an inline header', () => {
    expect(rootSrc).toMatch(/<AppHeader\b/);
    expect(rootSrc).not.toMatch(/<header\b/);
  });
});
