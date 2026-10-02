import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en } from '../src/i18n/en';
import { ms } from '../src/i18n/ms';
import {
  LANG_KEY,
  initLang,
  setLang,
  getLang,
  t,
  translate,
  subscribe,
} from '../src/i18n';
import { statusLabel, stateLabel, eventLabel } from '../src/i18n/labels';
import { LOGIN_ERRORS } from '../src/lib/password-login';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}
const throwing = () => {
  throw new Error('SecurityError');
};
const throwingStorage = { getItem: throwing, setItem: throwing };

beforeEach(() => {
  initLang(() => fakeStorage());
});

describe('dictionaries', () => {
  it('en and ms have identical key sets', () => {
    expect(Object.keys(ms).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty values in either language', () => {
    for (const [lang, dict] of [['en', en], ['ms', ms]] as const) {
      for (const [k, v] of Object.entries(dict)) {
        expect(v.trim(), `${lang}.${k}`).not.toBe('');
      }
    }
  });

  it('uses the same {placeholders} in both languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(ms[k]), k).toEqual(vars(en[k]));
    }
  });
});

describe('language persistence', () => {
  it('defaults to en when storage is empty', () => {
    expect(initLang(() => fakeStorage())).toBe('en');
    expect(getLang()).toBe('en');
  });

  it('uses the stored language', () => {
    expect(initLang(() => fakeStorage({ [LANG_KEY]: 'ms' }))).toBe('ms');
    expect(getLang()).toBe('ms');
  });

  it('ignores an unknown stored value', () => {
    expect(initLang(() => fakeStorage({ [LANG_KEY]: 'fr' }))).toBe('en');
  });

  it('falls back to en when storage throws on read', () => {
    expect(initLang(() => throwingStorage)).toBe('en');
    expect(initLang(throwing)).toBe('en'); // accessing localStorage itself throws
  });

  it('setLang writes cityos.lang and notifies subscribers', () => {
    const store = fakeStorage();
    let calls = 0;
    const off = subscribe(() => calls++);
    setLang('ms', () => store);
    off();
    expect(store.data['cityos.lang']).toBe('ms');
    expect(getLang()).toBe('ms');
    expect(calls).toBe(1);
  });

  it('setLang still switches when storage throws on write', () => {
    expect(() => setLang('ms', () => throwingStorage)).not.toThrow();
    expect(getLang()).toBe('ms');
  });
});

describe('t()', () => {
  it('translates using the current language', () => {
    setLang('en', () => fakeStorage());
    expect(t('login.submit')).toBe('Sign in');
    setLang('ms', () => fakeStorage());
    expect(t('login.submit')).toBe('Log masuk');
  });

  it('interpolates variables', () => {
    expect(translate('ms', 'tickets.count', { shown: 3, total: 10 })).toContain('3');
    expect(translate('ms', 'tickets.count', { shown: 3, total: 10 })).toContain('10');
  });

  it('returns the key for an unknown key rather than throwing', () => {
    expect(translate('ms', 'nope.nothing' as never)).toBe('nope.nothing');
  });
});

describe('status / state labels', () => {
  it('maps known status codes to BM', () => {
    expect(statusLabel('IN_PROGRESS', 'ms')).toBe('Dalam tindakan');
    expect(statusLabel('RESOLVED', 'ms')).toBe('Selesai');
    expect(statusLabel('CLOSED', 'ms')).toBe('Ditutup');
    expect(statusLabel('OPEN', 'en')).toBe('Open');
    expect(statusLabel('IN_PROGRESS', 'en')).toBe('In progress');
  });

  it('maps workflow states to BM', () => {
    expect(stateLabel('in_progress', 'ms')).toBe('Dalam tindakan');
    expect(stateLabel('accepted', 'ms')).toBe('Diterima');
    expect(stateLabel('awaiting_evidence', 'ms')).toBe('Menunggu bukti');
  });

  it('falls back to the raw code when unknown', () => {
    expect(statusLabel('WEIRD_NEW', 'ms')).toBe('WEIRD_NEW');
    expect(stateLabel('some_new_state', 'ms')).toBe('some_new_state');
    expect(statusLabel('', 'ms')).toBe('');
  });

  it('does not resolve prototype keys', () => {
    expect(statusLabel('constructor', 'ms')).toBe('constructor');
    expect(stateLabel('toString', 'ms')).toBe('toString');
  });

  it('humanises unknown timeline events and translates known ones', () => {
    expect(eventLabel('some_new_event', 'ms')).toBe('Some New Event');
    expect(eventLabel('status_changed', 'ms')).not.toBe('Status Changed');
  });
});

describe('login errors', () => {
  it('are translated at read time', () => {
    setLang('ms', () => fakeStorage());
    expect(LOGIN_ERRORS[401]).toBe('Nama pengguna atau kata laluan tidak sah.');
    setLang('en', () => fakeStorage());
    expect(LOGIN_ERRORS[401]).toMatch(/Incorrect username or password/);
  });
});

describe('no hard-coded English in screen sources', () => {
  const files = [
    'login.tsx',
    'password-login-form.tsx',
    'tickets.tsx',
    'ticket.$id.tsx',
    '__root.tsx',
  ];
  // Brand names that are intentionally not translated.
  const ALLOWED = new Set(['CITY HELP', 'City Guard', 'OK']);

  function hardcoded(src: string): string[] {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const found: string[] = [];
    // JSX text between tags: >Some words<  (no braces)
    for (const m of code.matchAll(/>([^<>{}=;\n]*[A-Za-z]{2,}[^<>{}=;\n]*)</g)) {
      found.push(m[1]!.trim());
    }
    // JSX text on its own line(s)
    for (const m of code.matchAll(/^\s*([A-Z][A-Za-z' ,.!?-]+[A-Za-z.!?])\s*$/gm)) {
      found.push(m[1]!.trim());
    }
    // User-visible attributes with a plain string
    for (const m of code.matchAll(/\b(?:aria-label|placeholder|title|alt)="([^"]*[A-Za-z]{2,}[^"]*)"/g)) {
      found.push(m[1]!);
    }
    return found.filter((s) => !ALLOWED.has(s));
  }

  it.each(files)('%s has no literal user-facing strings', (f) => {
    const src = readFileSync(resolve(__dirname, '../src/routes', f), 'utf8');
    expect(hardcoded(src)).toEqual([]);
  });
});
