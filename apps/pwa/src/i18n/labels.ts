import { getLang, hasKey, translate, type Lang } from './index';

function lookup(prefix: string, code: string, lang: Lang): string | null {
  const key = `${prefix}.${code}`;
  return code && hasKey(key) ? translate(lang, key) : null;
}

/** Server status code (IN_PROGRESS) -> label; raw code if unknown. */
export function statusLabel(code: string, lang: Lang = getLang()): string {
  return lookup('status', code, lang) ?? code;
}

/** Workflow state (in_progress) -> label; raw code if unknown. */
export function stateLabel(code: string, lang: Lang = getLang()): string {
  return lookup('state', code, lang) ?? code;
}

/** Timeline event type -> label; unknown types are title-cased as before. */
export function eventLabel(code: string, lang: Lang = getLang()): string {
  return (
    lookup('event', code, lang) ??
    code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
