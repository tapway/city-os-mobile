import { openDB, type IDBPDatabase } from 'idb';

interface QueuedMutation {
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
  return db.getAll('mutation-queue');
}

export async function clearQueue(): Promise<void> {
  const db = await getDB();
  await db.clear('mutation-queue');
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await getDB();
  await db.delete('mutation-queue', id);
}

export async function syncQueue(fetchFn: (url: string, init: RequestInit) => Promise<Response>): Promise<{ synced: number; failed: number }> {
  const queue = await getQueue();
  let synced = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      const resp = await fetchFn(item.url, {
        method: item.method,
        body: JSON.stringify(item.body),
        headers: { 'Content-Type': 'application/json' },
      });
      if (resp.ok && item.id) {
        await removeFromQueue(item.id);
        synced++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}