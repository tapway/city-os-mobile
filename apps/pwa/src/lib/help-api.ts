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
}

/** The list endpoint returns an envelope, never a bare array. */
export interface TicketPage {
  items: TicketListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListTicketsParams {
  q?: string;
  status?: string[];
  source?: string;
  incident_type?: string;
  lane?: string;
  limit?: number;
  offset?: number;
}

export async function listTickets(params: ListTicketsParams = {}): Promise<TicketPage> {
  const search = new URLSearchParams();
  if (params.q?.trim()) search.set('q', params.q.trim());
  if (params.status?.length) search.set('status', params.status.join(','));
  if (params.source) search.set('source', params.source);
  if (params.incident_type) search.set('incident_type', params.incident_type);
  if (params.lane) search.set('lane', params.lane);
  search.set('limit', String(params.limit ?? 25));
  search.set('offset', String(params.offset ?? 0));

  const page = await apiJson<TicketPage>(`/api/v1/events?${search.toString()}`);
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

export async function updateTicketStatus(uid: string, update: StatusUpdate): Promise<TicketDetail> {
  const { path, body } = statusUpdateRequest(uid, update);
  return apiJson<TicketDetail>(path, { method: 'PATCH', body: JSON.stringify(body) });
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

export interface WorkflowButton {
  id: number;
  status_name: string;
  button_name: string;
  trigger_name: string;
  description: string | null;
  sort_order: number | null;
}

export async function getWorkflowButtons(domain: string): Promise<WorkflowButton[]> {
  const raw = await apiJson<WorkflowButton[]>(
    `/api/v1/workflows/${encodeURIComponent(domain)}/buttons`,
  );
  return Array.isArray(raw) ? raw : [];
}

export interface TransitionBody {
  trigger: string;
  actor: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export async function transitionTicket(
  uid: string,
  body: TransitionBody,
): Promise<{ ticket_uid: string; workflow_state: string; status: string }> {
  return apiJson(`/api/v1/events/${encodeURIComponent(uid)}/transition`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

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