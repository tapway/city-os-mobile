/**
 * Tiny typed i18n: `en` / `ms` dictionaries, `t(key, vars?)`, a persisted
 * language choice. No dependency; framework-free so it is unit-testable in node.
 */
import { en, type MessageKey } from './en';
import { ms } from './ms';

export type Lang = 'en' | 'ms';
export type { MessageKey };

export const LANG_KEY = 'cityos.lang';
export const LANGS: readonly Lang[] = ['en', 'ms'];
const DICTS: Record<Lang, Record<MessageKey, string>> = { en, ms };

/** Anything with getItem/setItem; a thunk so a throwing `localStorage` getter is caught too. */
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type StorageGetter = () => StorageLike;
const defaultStorage: StorageGetter = () => globalThis.localStorage;

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ms';

/** Stored language, or `en` when storage is empty, invalid or throws. */
export function readStoredLang(getStorage: StorageGetter = defaultStorage): Lang {
  try {
    const v = getStorage().getItem(LANG_KEY);
    return isLang(v) ? v : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang | null = null;
const listeners = new Set<() => void>();

function applyDocumentLang(lang: Lang) {
  try {
    if (typeof document !== 'undefined') document.documentElement.lang = lang === 'ms' ? 'ms' : 'en';
  } catch {
    // no DOM
  }
}

/** Read storage, make that the active language, and set <html lang>. Call once at startup. */
export function initLang(getStorage: StorageGetter = defaultStorage): Lang {
  current = readStoredLang(getStorage);
  applyDocumentLang(current);
  listeners.forEach((l) => l());
  return current;
}

export function getLang(): Lang {
  if (current === null) initLang();
  return current as Lang;
}

export function setLang(lang: Lang, getStorage: StorageGetter = defaultStorage): void {
  current = lang;
  try {
    getStorage().setItem(LANG_KEY, lang);
  } catch {
    // Private mode / blocked storage: the choice still applies for this session.
  }
  applyDocumentLang(lang);
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = hasKey(key) ? DICTS[lang][key] : key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** Translate using the active language. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(getLang(), key, vars);
}

// ---- Messages held as data -------------------------------------------------
// State that shows an error/notice stores a Msg (key + vars), never the rendered
// string, so the text re-translates when the language is toggled.

export type Vars = Record<string, string | number>;
export interface Msg {
  key: MessageKey;
  vars?: Vars;
}

/** An Error that carries a translatable message. */
export class MsgError extends Error {
  readonly msg: Msg;
  constructor(key: MessageKey, vars?: Vars) {
    super(key);
    this.name = 'MsgError';
    this.msg = vars ? { key, vars } : { key };
  }
}

/** Build a Msg from a key, a MsgError, a Msg, or any other error (server text passes through). */
export function msgOf(input: MessageKey | Msg | unknown, vars?: Vars): Msg {
  if (typeof input === 'string' && hasKey(input)) return vars ? { key: input, vars } : { key: input };
  if (input instanceof MsgError) return input.msg;
  if (input && typeof input === 'object' && 'key' in input && hasKey(String((input as Msg).key))) return input as Msg;
  const message = input instanceof Error ? input.message : String(input ?? '');
  return { key: 'msg.raw', vars: { message } };
}

export function translateMsg(lang: Lang, msg: Msg): string {
  return translate(lang, msg.key, msg.vars);
}

export function tMsg(msg: Msg): string {
  return translateMsg(getLang(), msg);
}
