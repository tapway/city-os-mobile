/**
 * Typed client for the City Help API, as actually served behind the BFF.
 *
 * Everything here mirrors the real City Help contract (verified against
 * http://localhost:8001/openapi.json). The paths are deliberately explicit:
 * the API is inconsistent about the `/v1` segment — tickets and incident types
 * live outside it while events, attendance and workflows live inside it.
 */
import { apiFetch, apiJson, apiUpload } from './api';

// ---------------------------------------------------------------- /api/v1/events

export type TicketStatus =
  | 'OPEN'
  | 'VERIFIED'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED';

export interface TicketListItem {
  id: number;
  ticket_uid: string;
  title: string;
  status: string;
  lane: string | null;
  source: string | null;
  department_id: number | null;
  incident_type_id: number | null;
  lat: number | null;
  lng: number | null;
  location_desc: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TicketDetail extends TicketListItem {
  description: string | null;
  workflow_state: string | null;
  domain: string | null;
  jira_issue_key: string | null;
  assigned_to: string | null;
  sla_deadline: string | null;
  sla_breached: boolean;
  is_locked: boolean;
  image_urls: string[] | null;
  camera_id: string | null;
  video_url: string | null;
  reporter_name: string | null;
  reporter_contact: string | null;
  closure_comments: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  sla_timers?: unknown;
  /** Server-computed; entries are objects with an `action` key (see ticket-actions.ts). */
  available_actions?: { action: string; label?: string }[];
}

/** The list endpoint returns an envelope, never a bare array. */
export interface TicketPage {
  items: TicketListItem[];
  total: number;
  limit: number;
  offset: number;
}

/** City Help caps: PATCH status `note` is 4000 characters (422), list `q` is 200. */
export const MAX_NOTE_LENGTH = 4000;
export const MAX_QUERY_LENGTH = 200;

export interface ListTicketsParams {
  q?: string;
  status?: string[];
  source?: string;
  incident_type?: string;
  lane?: string;
  /** `me` = tickets assigned to the caller (server resolves the identity). */
  assignee?: 'me';
  /** workflow_state, e.g. `dispatch` (waiting to be accepted). */
  state?: string;
  limit?: number;
  offset?: number;
}

/** Query string for the event list, as data so it can be unit-tested. */
export function listTicketsQuery(params: ListTicketsParams = {}): string {
  const search = new URLSearchParams();
  const q = params.q?.trim().slice(0, MAX_QUERY_LENGTH).trim();
  if (q) search.set('q', q);
  if (params.status?.length) search.set('status', params.status.join(','));
  if (params.source) search.set('source', params.source);
  if (params.incident_type) search.set('incident_type', params.incident_type);
  if (params.lane) search.set('lane', params.lane);
  if (params.assignee) search.set('assignee', params.assignee);
  if (params.state) search.set('state', params.state);
  search.set('limit', String(params.limit ?? 25));
  search.set('offset', String(params.offset ?? 0));
  return search.toString();
}

export async function listTickets(params: ListTicketsParams = {}): Promise<TicketPage> {
  const page = await apiJson<TicketPage>(`/api/v1/events?${listTicketsQuery(params)}`);
  // Defensive: older deployments returned a bare array.
  if (Array.isArray(page)) {
    const items = page as unknown as TicketListItem[];
    return { items, total: items.length, limit: items.length, offset: 0 };
  }
  return {
    items: page?.items ?? [],
    total: page?.total ?? 0,
    limit: page?.limit ?? 0,
    offset: page?.offset ?? 0,
  };
}

export async function getTicket(uid: string): Promise<TicketDetail> {
  return apiJson<TicketDetail>(`/api/v1/events/${encodeURIComponent(uid)}`);
}

// --------------------------------------------------------------- /api/tickets

export interface TimelineEvent {
  id: number;
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  actor: string | null;
  note: string | null;
  created_at: string | null;
}

export async function getTimeline(uid: string): Promise<TimelineEvent[]> {
  const raw = await apiJson<TimelineEvent[]>(`/api/tickets/${encodeURIComponent(uid)}/timeline`);
  return Array.isArray(raw) ? raw : [];
}

export interface StatusUpdate {
  status: string;
  actor: string;
  note?: string;
  /**
   * Idempotency key for this logical update. The field app queues an update made
   * offline and replays it on reconnect, so the same key can legitimately arrive
   * twice; the server applies it once.
   */
  client_request_id?: string;
  /** GPS fix captured at the moment of the update (query params upstream). */
  lat?: number;
  lng?: number;
  /** Evidence photo URLs captured with this update; merged onto the ticket. */
  image_urls?: string[];
}

/**
 * Update a ticket's status with an optional comment.
 *
 * `lat`/`lng` are sent as query parameters because that is where City Help
 * reads them; when present on a move to IN_PROGRESS the backend records an
 * on-site GPS entry for the ticket (ticket attendance log).
 */
/**
 * The request a status update makes, as data.
 *
 * Shared with the offline queue so a replayed update is identical to the live
 * one — a second hand-built URL here is how the two would drift apart.
 */
export function statusUpdateRequest(
  uid: string,
  update: StatusUpdate,
): { path: string; body: Record<string, unknown> } {
  const search = new URLSearchParams();
  if (typeof update.lat === 'number') search.set('lat', String(update.lat));
  if (typeof update.lng === 'number') search.set('lng', String(update.lng));
  const qs = search.toString();

  return {
    path: `/api/tickets/${encodeURIComponent(uid)}/status${qs ? `?${qs}` : ''}`,
    body: {
      status: update.status,
      actor: update.actor,
      ...(update.note ? { note: update.note } : {}),
      ...(update.image_urls && update.image_urls.length > 0
        ? { image_urls: update.image_urls }
        : {}),
      ...(update.client_request_id
        ? { client_request_id: update.client_request_id }
        : {}),
    },
  };
}

/** Send an already-built status request (see statusUpdateRequest). */
export async function sendStatusRequest(request: { path: string; body: Record<string, unknown> }): Promise<TicketDetail> {
  return apiJson<TicketDetail>(request.path, { method: 'PATCH', body: JSON.stringify(request.body) });
}

export async function updateTicketStatus(uid: string, update: StatusUpdate): Promise<TicketDetail> {
  return sendStatusRequest(statusUpdateRequest(uid, update));
}

export function actionPath(uid: string, action: string): string {
  return `/api/v1/events/${encodeURIComponent(uid)}/actions/${encodeURIComponent(action)}`;
}

/** Run a workflow action that has no status mapping (e.g. need_support). Online only. */
export async function runTicketAction(uid: string, action: string, comment?: string): Promise<TicketDetail> {
  return apiJson<TicketDetail>(actionPath(uid, action), {
    method: 'POST',
    body: JSON.stringify(comment ? { comment } : {}),
  });
}

export function registerPath(uid: string): string {
  return `/api/v1/events/${encodeURIComponent(uid)}/attachments/register`;
}

/** `/api/uploads/<key>` (what POST /api/uploads returns) -> the object key City Help registers. */
export function keyOfUrl(url: string): string {
  return url.startsWith('/api/uploads/') ? url.slice('/api/uploads/'.length) : url;
}

/** Turn BFF-stored objects into evidence attachment rows (idempotent upstream); returns their ids. */
export async function registerEvidence(uid: string, keys: string[]): Promise<number[]> {
  const rows = await apiJson<{ id: number }[]>(registerPath(uid), {
    method: 'POST',
    body: JSON.stringify({ kind: 'evidence', items: keys.map((key) => ({ key })) }),
  });
  return (Array.isArray(rows) ? rows : []).map((r) => r.id);
}

/** Run the upload_evidence workflow action with already-registered attachment ids. */
export async function runEvidenceAction(uid: string, attachmentIds: number[]): Promise<TicketDetail> {
  return apiJson<TicketDetail>(actionPath(uid, 'upload_evidence'), {
    method: 'POST',
    body: JSON.stringify({ attachment_ids: attachmentIds }),
  });
}

export interface CreateTicketBody {
  title: string;
  description?: string;
  source: string;
  lane?: string;
  lat?: number;
  lng?: number;
  location_desc?: string;
  incident_type_code?: string;
  urgency?: string;
  reporter_name?: string;
  reporter_contact?: string;
  reporting_method?: string;
  image_urls?: string[];
}

export async function createTicket(body: CreateTicketBody): Promise<TicketDetail> {
  // NOTE: /api/tickets — no /v1 segment.
  return apiJson<TicketDetail>('/api/tickets', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ------------------------------------------------------ workflows & metadata

export interface IncidentType {
  id: number;
  code: string;
  name: string;
  name_en: string | null;
  group_type: string | null;
  priority: string | null;
  sla_hours: number | null;
  department: string | null;
}

export async function listIncidentTypes(): Promise<IncidentType[]> {
  // NOTE: /api/incident-types — no /v1 segment.
  const raw = await apiJson<IncidentType[]>('/api/incident-types');
  return Array.isArray(raw) ? raw : [];
}

// ------------------------------------------------------------- attendance

export interface AttendanceToday {
  status?: string;
  clock_in?: string | null;
  clock_out?: string | null;
  clock_in_lat?: number | null;
  clock_in_lng?: number | null;
}

export async function getAttendanceToday(): Promise<AttendanceToday> {
  return (await apiJson<AttendanceToday>('/api/v1/attendance/today')) ?? {};
}

export async function clockIn(lat: number, lng: number): Promise<unknown> {
  return apiJson('/api/v1/attendance/clock-in', {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
  });
}

export async function clockOut(lat: number, lng: number): Promise<unknown> {
  return apiJson('/api/v1/attendance/clock-out', {
    method: 'POST',
    body: JSON.stringify({ lat, lng }),
  });
}

// ------------------------------------------------------------ image upload

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  content_type: string;
}

/** Upload a captured photo; returns the URL to store on the ticket. */
/**
 * Remove an uploaded evidence object.
 *
 * Evidence is uploaded before the ticket update, so an update the server rejects
 * leaves an object nothing references.
 */
export async function deleteImage(url: string): Promise<void> {
  await apiFetch(url, { method: 'DELETE' });
}

export async function uploadImage(file: File, uid?: string): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  if (uid) form.append('ticket_uid', uid);
  return apiUpload<UploadResult>('/api/uploads', form);
}

/** Query-string helper so callers never hand-build `/api/storage/...` paths. */
export function storageUrl(imageUrl: string): string {
  if (/^https?:\/\//i.test(imageUrl) || imageUrl.startsWith('data:')) return imageUrl;
  return imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
}