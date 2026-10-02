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
}

/**
 * Drop or retry a queued update that failed with `status` (0 = never reached the server).
 *
 * Only a permanent rejection of the content is dropped. 408 and 429 are
 * transient. A 401 is retried until the auth layer has refreshed the token; one
 * that persists after the refresh will not fix itself, so it is dropped.
 */
export function classifyFailure(status: number, opts: { refreshed?: boolean } = {}): 'drop' | 'retry' {
  if (status === 401) return opts.refreshed ? 'drop' : 'retry';
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
 * what is dropped (counted separately, evidence cleaned up) and what stays
 * queued for the next attempt.
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

    for (const item of queue) {
      // A thrown ApiError has already been through apiFetch's refresh; a bare
      // response has not.
      let status: number;
      let refreshed = false;
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
        refreshed = err instanceof ApiError;
      }

      if (item.id !== undefined && classifyFailure(status, { refreshed }) === 'drop') {
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
