/**
 * Field-officer ticket actions, derived from the server's `available_actions`.
 *
 * City Help returns `available_actions` as a list of objects
 * (`{action, label, label_key, kind, danger, confirm, inputs}`; see
 * app/core/actions.py `_view`). The PWA never decides what is allowed: it shows
 * a button only when the matching `action` is in that list.
 */
import { actionPath, type StatusUpdate } from './help-api';
import type { MessageKey } from '../i18n';

export type FieldAction = 'accept' | 'start' | 'resume' | 'complete' | 'need_support';

export interface ActionButton {
  action: FieldAction;
  labelKey: MessageKey;
  noteKey: MessageKey | null;
  testId: string;
  /** Legacy status sent through PATCH /api/tickets/{uid}/status; null = not a status change. */
  status: string | null;
  /** True when the action cannot be queued and must be disabled offline. */
  needsOnline: boolean;
}

const DEFS: Record<FieldAction, Omit<ActionButton, 'action' | 'testId'>> = {
  accept: { labelKey: 'act.accept', noteKey: 'action.note.accept', status: 'ASSIGNED', needsOnline: false },
  start: { labelKey: 'act.start', noteKey: 'action.note.start', status: 'IN_PROGRESS', needsOnline: false },
  resume: { labelKey: 'act.resume', noteKey: 'action.note.resume', status: 'IN_PROGRESS', needsOnline: false },
  complete: { labelKey: 'action.resolve', noteKey: 'action.note.resolve', status: 'RESOLVED', needsOnline: false },
  need_support: { labelKey: 'act.need_support', noteKey: null, status: null, needsOnline: true },
};

/** Display order. Anything not listed here (close, void, escalate, ...) is never shown. */
const ORDER: FieldAction[] = ['accept', 'start', 'resume', 'complete', 'need_support'];

function offeredNames(available: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(available)) return out;
  for (const entry of available) {
    if (typeof entry === 'string') out.add(entry);
    else if (entry && typeof entry === 'object' && typeof (entry as { action?: unknown }).action === 'string') {
      out.add((entry as { action: string }).action);
    }
  }
  return out;
}

export function actionButtons(available: unknown): ActionButton[] {
  const offered = offeredNames(available);
  return ORDER.filter((a) => offered.has(a)).map((action) => ({
    action,
    testId: `ticket-action-${action}`,
    ...DEFS[action],
  }));
}

export function statusForAction(action: FieldAction): string | null {
  return DEFS[action].status;
}

export function needSupportPath(uid: string): string {
  return actionPath(uid, 'need_support');
}

/** A status update for a mapped action; every call gets a fresh idempotency key. */
export function buildActionUpdate(
  action: FieldAction,
  fix: { actor: string; lat: number; lng: number; note?: string; image_urls?: string[] },
): StatusUpdate {
  const status = statusForAction(action);
  if (!status) throw new Error(`Action ${action} has no status mapping`);
  return {
    status,
    actor: fix.actor,
    note: fix.note || undefined,
    lat: fix.lat,
    lng: fix.lng,
    image_urls: fix.image_urls,
    client_request_id: crypto.randomUUID(),
  };
}
