import { openDB, type IDBPDatabase } from 'idb';

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

export async function enqueueMutation(m: Omit<QueuedMutation, 'id' | 'created_at'>): Promise<number> {
  const db = await getDB();
  const key = await db.add('mutation-queue', { ...m, created_at: Date.now() });
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
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('mutation-queue', id);
}

export interface SyncResult {
  synced: number;
  failed: number;
  /** Dropped because the server rejected them permanently (4xx). */
  dropped: number;
}

/** Flush guard so two triggers (reconnect + focus) never replay twice. */
let syncing = false;

export function isSyncing(): boolean {
  return syncing;
}

/**
 * Replay queued mutations through the provided auth-aware fetch.
 *
 * A 4xx is a permanent rejection — retrying forever would block the queue
 * behind a request that can never succeed — so those entries are dropped and
 * counted separately. 5xx and network errors stay queued for the next attempt.
 */
export async function syncQueue(
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
): Promise<SyncResult> {
  if (syncing) return { synced: 0, failed: 0, dropped: 0 };
  syncing = true;
  try {
    const queue = await getQueue();
    let synced = 0;
    let failed = 0;
    let dropped = 0;

    for (const item of queue) {
      try {
        const resp = await fetchFn(item.url, {
          method: item.method,
          body: JSON.stringify(item.body),
          headers: { 'Content-Type': 'application/json' },
        });
        if (resp.ok && item.id !== undefined) {
          await removeFromQueue(item.id);
          synced++;
        } else if (resp.status >= 400 && resp.status < 500 && item.id !== undefined) {
          await removeFromQueue(item.id);
          dropped++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    return { synced, failed, dropped };
  } finally {
    syncing = false;
  }
}