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

/** Workflow action code (start, need_support, ...) -> City Help label; raw code if unknown. */
export function actionLabel(code: string, lang: Lang = getLang()): string {
  return lookup('act', code, lang) ?? code;
}

/** Status code or workflow state (event old/new values carry either); raw if unknown. */
export function anyStateLabel(code: string, lang: Lang = getLang()): string {
  return lookup('status', code, lang) ?? lookup('state', code, lang) ?? code;
}

const titleCase = (code: string) => code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Timeline `event_type` -> label. City Help writes: FSM/command action codes
 * (accept, start, need_support, ...), `workflow_<trigger>` (legacy engine),
 * lower-cased status (in_progress, resolved, ...), and created / assigned /
 * merged / external_callback. Unknown types fall back to title case.
 */
export function eventLabel(code: string, lang: Lang = getLang()): string {
  const bare = code.startsWith('workflow_') ? code.slice('workflow_'.length) : code;
  return (
    lookup('event', code, lang) ??
    lookup('act', bare, lang) ??
    lookup('state', bare, lang) ??
    lookup('status', bare.toUpperCase(), lang) ??
    titleCase(code)
  );
}
