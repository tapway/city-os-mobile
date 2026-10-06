import { openDB, type IDBPDatabase } from 'idb';
import { ApiError, errorCode } from './api';
import { chunk, keyOfUrl, MAX_EVIDENCE_PHOTOS, registerPath } from './help-api';
import { getSessionUser } from './auth';
import type { Msg } from '../i18n';

/** A photo captured for a queued update, kept as a blob until it can be uploaded. */
export interface QueuedPhoto {
  blob: Blob;
  name: string;
}

export interface QueuedMutation {
  id?: number;
  url: string;
  method: string;
  body: unknown;
  created_at: number;
  /**
   * Who queued it. A handset can change hands with updates still waiting; those
   * must go out under the officer who made them, never the next one to sign in.
   */
  user?: string;
  /** Evidence not yet uploaded (offline Complete); uploaded during sync, before the request. */
  photos?: QueuedPhoto[];
  /** `evidence`: replay is upload photos -> register keys -> POST the action with the attachment ids. */
  kind?: 'evidence';
  /** Optional comment sent with the upload_evidence action. */
  comment?: string;
  /** Evidence attachments already registered upstream; a retry skips straight to the action. */
  attachment_ids?: number[];
  /** The last replay got 409 ticket_locked: kept (with its evidence), sent once unlocked. */
  locked?: boolean;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB('city-os-mobile', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('mutation-queue')) {
          db.createObjectStore('mutation-queue', {
            keyPath: 'id',
            autoIncrement: true,
          });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Fired whenever the queue gains or loses an entry.
 *
 * The shell shows how many updates are waiting; without this it only learned
 * that on mount, so an update queued mid-session stayed invisible and the
 * officer could not tell whether their work had been kept.
 */
export const QUEUE_CHANGED_EVENT = 'city-os-mobile:queue-changed';

function announceQueueChange(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
  }
}

export async function enqueueMutation(m: Omit<QueuedMutation, 'id' | 'created_at'>): Promise<number> {
  const db = await getDB();
  const user = m.user ?? getSessionUser()?.username ?? undefined;
  const key = await db.add('mutation-queue', { ...m, ...(user ? { user } : {}), created_at: Date.now() });
  announceQueueChange();
  return key as number;
}

export async function getQueue(): Promise<QueuedMutation[]> {
  const db = await getDB();
  const all = await db.getAll('mutation-queue');
  // Oldest first — replay order matters for status transitions.
  return all.sort((a, b) => a.created_at - b.created_at);
}

export async function clearQueue(): Promise<void> {
  const db = await getDB();
  await db.clear('mutation-queue');
  announceQueueChange();
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('mutation-queue', id);
  announceQueueChange();
}

async function updateEntry(entry: QueuedMutation): Promise<void> {
  const db = await getDB();
  await db.put('mutation-queue', entry);
}

/** Entries this user may send: their own, plus unstamped ones from before owners were recorded. */
export function ownEntries<T extends { user?: string }>(queue: T[], username: string | null | undefined): T[] {
  return queue.filter((q) => !q.user || q.user === username);
}

/** True when an update of this user's for the ticket is already waiting (a new one must queue behind it). */
export async function hasQueuedForTicket(uid: string, username?: string | null): Promise<boolean> {
  return ownEntries(await getQueue(), username).some((q) => ticketKey(q.url) === uid);
}

/**
 * Run a sync while mirroring "a sync is in flight" into `setSyncing`.
 * An overlapping call that did nothing (`skipped`) must not clear the flag
 * while the first sync is still running.
 */
export async function trackSync<R extends { skipped?: true }>(
  setSyncing: (syncing: boolean) => void,
  run: () => Promise<R>,
): Promise<R> {
  setSyncing(true);
  let skipped = false;
  try {
    const result = await run();
    skipped = !!result.skipped;
    return result;
  } finally {
    if (!skipped) setSyncing(false);
  }
}

export interface SyncResult {
  synced: number;
  failed: number;
  /** Dropped because the server rejected them permanently (4xx). */
  dropped: number;
  /** Set when a 401 paused the sync; `failed` then counts every entry still queued. */
  authRequired?: true;
  /** Set when another sync was already running; nothing was attempted. */
  skipped?: true;
  /** Entries queued by a different signed-in user, held until that user signs in. Absent when 0. */
  otherUser?: number;
  /** Photos the server refused (too large, wrong type, forbidden); the update went out without them. Absent when 0. */
  photosDropped?: number;
  /** Entries kept because the ticket is locked by a supervisor (409 ticket_locked). Absent when 0. */
  locked?: number;
}

/** "n update(s) saved; ticket locked", or null. */
export function lockedNotice(result: SyncResult | null): Msg | null {
  return result?.locked ? { key: 'offline.locked', vars: { n: result.locked } } : null;
}

/** "n photo(s) were rejected and left out", or null. */
export function photoDroppedNotice(result: SyncResult | null): Msg | null {
  return result?.photosDropped ? { key: 'offline.photoDropped', vars: { n: result.photosDropped } } : null;
}

/** Shown before sign-out when updates are still waiting on this device. */
export function logoutWarning(pending: number): Msg | null {
  return pending > 0 ? { key: 'app.signOutPending', vars: { n: pending } } : null;
}

/** "n update(s) from another user are waiting", or null. */
export function otherUserNotice(result: SyncResult | null): Msg | null {
  return result?.otherUser ? { key: 'offline.otherUser', vars: { n: result.otherUser } } : null;
}

/** An overlapping sync did nothing, so its result must not replace the last real one. */
export function shouldRecord(result: SyncResult): boolean {
  return !result.skipped;
}

/** The ticket a queued request belongs to (…/tickets/{uid}/… or …/events/{uid}/…), else its URL. */
function ticketKey(url: string): string {
  const m = /\/(?:tickets|events)\/([^/?]+)/.exec(url);
  return m ? m[1]! : url;
}

/** "Sign in again to send {n} pending update(s)", or null when the sync was not paused. */
export function authNotice(result: SyncResult | null): Msg | null {
  if (!result?.authRequired) return null;
  return { key: 'offline.signInAgain', vars: { n: result.failed } };
}

/**
 * What to do with a queued update that failed with `status` (0 = never reached the server).
 *
 * - `drop`: the server permanently rejected the content (4xx other than below).
 * - `auth`: 401. The session is gone or expired, which says nothing about the
 *   update; an officer can work offline longer than the refresh lifetime. Keep
 *   everything and pause until they sign in again.
 * - `retry`: 408, 429, 5xx and offline are transient.
 * - `locked`: 409 `ticket_locked`. Like retry, but the entry is flagged so the
 *   officer is told why it waits (their update and evidence are kept).
 */
export function classifyFailure(status: number, code?: string | null): 'drop' | 'retry' | 'auth' | 'locked' {
  if (status === 401) return 'auth';
  // A lock is temporary: the supervisor unlocks, the update stays valid.
  if (status === 409 && code === 'ticket_locked') return 'locked';
  if (status === 408 || status === 429) return 'retry';
  return status >= 400 && status < 500 ? 'drop' : 'retry';
}

/** The notice to show for a sync result, or null when nothing was rejected. */
export function syncNotice(result: SyncResult | null): Msg | null {
  if (!result || result.dropped <= 0) return null;
  return { key: 'offline.dropped', vars: { n: result.dropped } };
}

export interface SyncOptions {
  /** Remove an evidence object that a dropped update had already uploaded. */
  deleteEvidence?: (url: string) => Promise<void>;
  /** Signed-in username; only entries stamped with it (or unstamped legacy ones) are sent. */
  username?: string | null;
  /** Upload one queued photo for a ticket; resolves to the stored URL. */
  uploadPhoto?: (photo: QueuedPhoto, uid: string) => Promise<{ url: string }>;
}

function evidenceOf(item: QueuedMutation): string[] {
  const urls = (item.body as { image_urls?: unknown } | null)?.image_urls;
  return Array.isArray(urls) ? urls.filter((u): u is string => typeof u === 'string') : [];
}

/** True when the ticket is in awaiting_evidence (the state upload_evidence leads to); null if unreadable. */
async function evidenceApplied(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  uid: string,
): Promise<boolean | null> {
  try {
    const resp = await fetchFn(`/api/v1/events/${encodeURIComponent(uid)}`, { method: 'GET' });
    if (!resp.ok) return null;
    const detail = (await resp.json()) as { workflow_state?: string | null };
    return detail?.workflow_state === 'awaiting_evidence';
  } catch {
    return null;
  }
}

/** Flush guard so two triggers (reconnect + focus) never replay twice. */
let syncing = false;

export function isSyncing(): boolean {
  return syncing;
}

/**
 * Replay queued mutations through the provided auth-aware fetch.
 *
 * `apiFetch` throws an ApiError on any non-2xx (after its own 401 refresh), so
 * failures arrive as exceptions as well as responses. See classifyFailure for
 * what is dropped (counted separately, evidence cleaned up), what stays
 * queued, and the 401 pause.
 */
export async function syncQueue(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  if (syncing) return { synced: 0, failed: 0, dropped: 0, skipped: true };
  syncing = true;
  try {
    const queue = await getQueue();
    let synced = 0;
    let failed = 0;
    let dropped = 0;
    let otherUser = 0;
    let photosDropped = 0;
    let locked = 0;
    const extras = () => ({
      ...(otherUser > 0 ? { otherUser } : {}),
      ...(photosDropped > 0 ? { photosDropped } : {}),
      ...(locked > 0 ? { locked } : {}),
    });

    // Tickets with an entry that must be retried: later entries for them wait,
    // in order, for the next sync (sending Start before a failed Accept would 409
    // and the Start would be dropped).
    const held = new Set<string>();

    for (const [index, item] of queue.entries()) {
      if (item.user && item.user !== opts.username) {
        // With no signed-in user yet (session not restored) "another user" is unknowable.
        if (opts.username) otherUser++;
        continue;
      }
      const key = ticketKey(item.url);
      if (held.has(key)) {
        failed++;
        continue;
      }
      let status: number;
      let code: string | null = null;
      try {
        // Evidence captured offline goes up first; the request then carries its URLs.
        if (item.photos?.length && opts.uploadPhoto) {
          const urls = evidenceOf(item);
          for (const photo of [...item.photos]) {
            try {
              const { url } = await opts.uploadPhoto(photo, key);
              urls.push(url);
            } catch (err) {
              const code = err instanceof ApiError ? err.status : 0;
              // The server permanently refused this photo (413/415/403...): leave
              // it out, but never lose the update it belongs to.
              if (classifyFailure(code) !== 'drop') throw err;
              photosDropped++;
            }
            item.photos = item.photos.filter((p) => p !== photo);
            item.body = { ...(item.body as object), image_urls: [...urls] };
            await updateEntry(item); // a retry must not upload this photo again
          }
        }
        if (item.kind === 'evidence') {
          // Register once; the ids are persisted so a failed action does not re-register.
          if (!item.attachment_ids?.length) {
            // City Help registers at most 10 items per call; chunk as a backstop for big queued entries.
            const ids: number[] = [];
            for (const part of chunk(evidenceOf(item), MAX_EVIDENCE_PHOTOS)) {
              const reg = await fetchFn(registerPath(key), {
                method: 'POST',
                body: JSON.stringify({ kind: 'evidence', items: part.map((u) => ({ key: keyOfUrl(u) })) }),
                headers: { 'Content-Type': 'application/json' },
              });
              if (!reg.ok) {
                status = reg.status;
                code = errorCode(await reg.clone().text().catch(() => ''));
                throw new ApiError(status, 'register failed', null);
              }
              const rows = (await reg.json().catch(() => [])) as { id: number }[];
              ids.push(...(Array.isArray(rows) ? rows : []).map((r) => r.id));
            }
            item.attachment_ids = ids;
            await updateEntry(item);
          }
        }
        const resp = await fetchFn(item.url, {
          method: item.method,
          body: JSON.stringify(
            item.kind === 'evidence'
              ? { attachment_ids: item.attachment_ids, ...(item.comment ? { comment: item.comment } : {}) }
              : item.body,
          ),
          headers: { 'Content-Type': 'application/json' },
        });
        if (resp.ok) {
          if (item.id !== undefined) await removeFromQueue(item.id);
          synced++;
          continue;
        }
        status = resp.status;
        code = errorCode(await resp.clone().text().catch(() => ''));
      } catch (err) {
        if (err instanceof ApiError) {
          status = err.status;
          code = errorCode(err.data) ?? code;
        } else {
          status = 0;
        }
      }

      // upload_evidence has no client_request_id upstream, so a replay of an action that already
      // went through (response lost) answers 409 invalid_transition. If the ticket now sits in
      // awaiting_evidence the update is applied: success, not a drop. Unreadable state: retry.
      if (item.kind === 'evidence' && status === 409 && code === 'invalid_transition' && item.attachment_ids?.length) {
        const applied = await evidenceApplied(fetchFn, key);
        if (applied) {
          if (item.id !== undefined) await removeFromQueue(item.id);
          synced++;
          continue;
        }
        if (applied === null) status = 0;
      }

      const outcome = classifyFailure(status, code);
      if (outcome === 'auth') {
        // Keep this and every later entry; the caller shows a sign-in prompt.
        const stillQueued = queue.slice(index).filter((q) => !q.user || q.user === opts.username).length;
        return { synced, failed: failed + stillQueued, dropped, authRequired: true, ...extras() };
      }
      if (item.id !== undefined && outcome === 'drop') {
        await removeFromQueue(item.id);
        dropped++;
        // Objects an evidence entry already registered are attachment rows now: keep them.
        if (opts.deleteEvidence && !item.attachment_ids?.length) {
          await Promise.all(evidenceOf(item).map((u) => opts.deleteEvidence!(u).catch(() => undefined)));
        }
      } else {
        if (outcome === 'locked') {
          locked++;
          if (item.id !== undefined && !item.locked) {
            item.locked = true;
            await updateEntry(item);
          }
        }
        failed++;
        held.add(key);
      }
    }

    return { synced, failed, dropped, ...extras() };
  } finally {
    syncing = false;
  }
}
