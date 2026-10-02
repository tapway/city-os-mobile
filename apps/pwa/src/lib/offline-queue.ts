import { openDB, type IDBPDatabase } from 'idb';
import { ApiError } from './api';
import type { Msg } from '../i18n';

export interface QueuedMutation {
  id?: number;
  url: string;
  method: string;
  body: unknown;
  created_at: number;
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
  const key = await db.add('mutation-queue', { ...m, created_at: Date.now() });
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

export interface SyncResult {
  synced: number;
  failed: number;
  /** Dropped because the server rejected them permanently (4xx). */
  dropped: number;
  /** Set when a 401 paused the sync; `failed` then counts every entry still queued. */
  authRequired?: true;
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
 */
export function classifyFailure(status: number): 'drop' | 'retry' | 'auth' {
  if (status === 401) return 'auth';
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
}

function evidenceOf(item: QueuedMutation): string[] {
  const urls = (item.body as { image_urls?: unknown } | null)?.image_urls;
  return Array.isArray(urls) ? urls.filter((u): u is string => typeof u === 'string') : [];
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
  if (syncing) return { synced: 0, failed: 0, dropped: 0 };
  syncing = true;
  try {
    const queue = await getQueue();
    let synced = 0;
    let failed = 0;
    let dropped = 0;

    for (const [index, item] of queue.entries()) {
      let status: number;
      try {
        const resp = await fetchFn(item.url, {
          method: item.method,
          body: JSON.stringify(item.body),
          headers: { 'Content-Type': 'application/json' },
        });
        if (resp.ok) {
          if (item.id !== undefined) await removeFromQueue(item.id);
          synced++;
          continue;
        }
        status = resp.status;
      } catch (err) {
        status = err instanceof ApiError ? err.status : 0;
      }

      const outcome = classifyFailure(status);
      if (outcome === 'auth') {
        // Keep this and every later entry; the caller shows a sign-in prompt.
        return { synced, failed: failed + (queue.length - index), dropped, authRequired: true };
      }
      if (item.id !== undefined && outcome === 'drop') {
        await removeFromQueue(item.id);
        dropped++;
        if (opts.deleteEvidence) {
          await Promise.all(evidenceOf(item).map((u) => opts.deleteEvidence!(u).catch(() => undefined)));
        }
      } else {
        failed++;
      }
    }

    return { synced, failed, dropped };
  } finally {
    syncing = false;
  }
}
