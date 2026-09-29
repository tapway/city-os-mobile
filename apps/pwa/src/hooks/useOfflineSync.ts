import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { getQueue, syncQueue, type SyncResult } from '../lib/offline-queue';
import { useOnlineStatus } from './useOnlineStatus';

/**
 * Owns the offline mutation queue: reports how many updates are waiting and
 * replays them when connectivity returns.
 *
 * Mounted once (in the root layout) so every screen benefits.
 */
export function useOfflineSync() {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      setPending((await getQueue()).length);
    } catch {
      setPending(0);
    }
  }, []);

  const flush = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      const result = await syncQueue((url, init) => apiFetch(url, init));
      setLastResult(result);
      await refreshCount();
    } finally {
      setSyncing(false);
    }
  }, [refreshCount]);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  // Replay as soon as the device is back online.
  useEffect(() => {
    if (online) flush();
  }, [online, flush]);

  return { pending, syncing, lastResult, flush, refreshCount };
}