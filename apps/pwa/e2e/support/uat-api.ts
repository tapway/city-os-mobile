/**
 * Minimal City Help API client for the mobile UAT: token helper, ticket
 * factory, state reads and cleanup. Uses Node's fetch; no secrets are logged.
 */
import {
  HELP_URL, KC_URL, KC_REALM, KC_CLIENT, KEJURUTERAAN_DEPT_ID, INCIDENT_TYPE_CODE, JB,
  RUN_TAG, passwordFor, type Role,
} from './uat-env';

const tokens = new Map<Role, { token: string; exp: number }>();

/** Password-grant token for a role account (cached until 30 s before expiry). */
export async function tokenFor(role: Role): Promise<string> {
  const hit = tokens.get(role);
  if (hit && hit.exp > Date.now() + 30_000) return hit.token;
  const resp = await fetch(`${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: KC_CLIENT,
      username: role,
      password: passwordFor(role),
    }),
  });
  if (!resp.ok) throw new Error(`token for ${role}: HTTP ${resp.status}`);
  const body = (await resp.json()) as { access_token: string; expires_in?: number };
  tokens.set(role, { token: body.access_token, exp: Date.now() + (body.expires_in ?? 60) * 1000 });
  return body.access_token;
}

export interface ApiResult<T = unknown> { status: number; ok: boolean; body: T }

/** Authenticated call against City Help. `path` starts with `/api/...`. */
export async function call<T = any>(
  role: Role, method: string, path: string, body?: unknown,
): Promise<ApiResult<T>> {
  const resp = await fetch(`${HELP_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await tokenFor(role)}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: resp.status, ok: resp.ok, body: parsed as T };
}

async function must<T>(label: string, p: Promise<ApiResult<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

export interface ActionView { action: string; label: string; kind?: string }
export interface Detail {
  ticket_uid: string;
  title: string;
  status: string;
  workflow_state: string | null;
  department_id?: number | null;
  assigned_to?: string | null;
  image_urls?: string[] | null;
  attachments?: Array<{ url?: string; object_key?: string; content_type?: string; kind?: string; filename?: string }>;
  available_actions?: ActionView[];
}
export interface TimelineEntry {
  id: number; action: string; from_state: string | null; to_state: string | null;
  actor: string | null; note: string | null; client_request_id?: string | null;
}

export const detail = (role: Role, uid: string) =>
  must<Detail>(`detail ${uid}`, call<Detail>(role, 'GET', `/api/v1/events/${uid}`));
export const timeline = (role: Role, uid: string) =>
  must<TimelineEntry[]>(`timeline ${uid}`, call<TimelineEntry[]>(role, 'GET', `/api/v1/events/${uid}/timeline`));
/** Legacy timeline (what the PWA shows): status changes carry old_status/new_status in legacy status names. */
export interface LegacyTimelineEvent {
  id: number; event_type: string; old_status: string | null; new_status: string | null;
  actor: string | null; note: string | null;
}
export const legacyTimeline = (role: Role, uid: string) =>
  must<LegacyTimelineEvent[]>(`legacy timeline ${uid}`, call<LegacyTimelineEvent[]>(role, 'GET', `/api/tickets/${uid}/timeline`));
export const act = (role: Role, uid: string, action: string, body: Record<string, unknown> = {}) =>
  must<Detail>(`${role} ${action} ${uid}`, call<Detail>(role, 'POST', `/api/v1/events/${uid}/actions/${action}`, body));

export interface UatTicket { uid: string; title: string }

/**
 * Create a ticket as `operator` and take it to `dispatch` for the engineer's
 * department: confirm, then submit (the auto-rule routes TRF1A to KEJURUTERAAN,
 * department_id 4, which is asserted).
 * Actions are only attempted when the server offers them in `available_actions`.
 */
export async function createDispatchedTicket(label: string): Promise<UatTicket> {
  const title = `${RUN_TAG} ${label}`;
  const created = await must<Detail>('create ticket', call<Detail>('operator', 'POST', '/api/tickets', {
    title,
    description: `${RUN_TAG} automated mobile UAT; safe to void or close.`,
    source: 'manual',
    lat: JB.latitude,
    lng: JB.longitude,
    location_desc: 'Johor Bahru (UAT)',
    incident_type_code: INCIDENT_TYPE_CODE,
  }));
  const uid = created.ticket_uid;

  let d = await detail('operator', uid);
  for (const step of ['confirm', 'submit']) {
    if (d.workflow_state === 'dispatch') break;
    if (d.available_actions?.some((a) => a.action === step)) {
      await act('operator', uid, step);
      d = await detail('operator', uid);
    }
  }
  if (d.workflow_state !== 'dispatch') {
    throw new Error(`ticket ${uid} did not reach dispatch (state=${d.workflow_state})`);
  }
  // The auto-rule must have routed it to the engineer's department; there is no
  // manual assign fallback, so a mis-routed ticket fails here, not later in a test.
  if (d.department_id !== KEJURUTERAAN_DEPT_ID) {
    throw new Error(`ticket ${uid} routed to department ${d.department_id}, expected ${KEJURUTERAAN_DEPT_ID}`);
  }
  return { uid, title };
}

/** Put a dispatched ticket in the engineer's hands via the API (no UI). */
export async function acceptAsEngineer(uid: string): Promise<void> {
  await act('engineer', uid, 'accept');
}
export async function startAsEngineer(uid: string): Promise<void> {
  await act('engineer', uid, 'start');
}

/** Next action that moves a ticket towards a terminal state, by workflow_state. */
const CLOSE_STEP: Record<string, string> = {
  intake: 'void',
  confirmed: 'submit',
  dispatch: 'accept',
  accepted: 'start',
  in_progress: 'complete',
  waiting_for_support: 'resume',
  done: 'review_approve',
  awaiting_evidence: 'review_approve',
  verified: 'review_approve',
};

/**
 * Retire a UAT ticket: void it if still at intake, otherwise drive it to
 * `closed` as `admin` (who holds every permission). Throws if it cannot, so a
 * leaked UAT ticket is loud rather than silent.
 */
export async function closeTicket(uid: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const d = await detail('admin', uid);
    const state = d.workflow_state ?? '';
    if (state === 'closed' || state === 'voided') return;
    const step = CLOSE_STEP[state];
    if (!step) throw new Error(`cleanup ${uid}: no step from state ${state}`);
    const body = step === 'review_approve' ? { comment: `${RUN_TAG} cleanup` }
      : step === 'void' ? { fields: { reason: `${RUN_TAG} cleanup` } } : {};
    await act('admin', uid, step, body);
  }
  throw new Error(`cleanup ${uid}: still open after 10 steps`);
}

/** Resolve an evidence reference to a path on City Help's storage proxy. */
export function storagePath(ref: { url?: string; object_key?: string }): string | null {
  if (ref.object_key) return `/api/storage/${ref.object_key.replace(/^\/+/, '')}`;
  const u = ref.url ?? '';
  const i = u.indexOf('/api/storage/');
  return i >= 0 ? u.slice(i) : null;
}
