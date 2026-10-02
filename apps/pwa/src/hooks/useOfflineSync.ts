import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { deleteImage } from '../lib/help-api';
import {
  getQueue,
  syncQueue,
  QUEUE_CHANGED_EVENT,
  type SyncResult,
} from '../lib/offline-queue';
import { useOnlineStatus } from './useOnlineStatus';

/**
 * Owns the offline mutation queue: reports how many updates are waiting and
 * replays them when connectivity returns.
 *
 * Mounted once (in the root layout) so every screen benefits.
 */
export function useOfflineSync() {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
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
      const result = await syncQueue((url, init) => apiFetch(url, init), {
        deleteEvidence: deleteImage,
      });
      setLastResult(result);
      // Replayed (or rejected) updates changed what the server holds.
      if (result.synced + result.dropped > 0) {
        void queryClient.invalidateQueries({ queryKey: ['ticket'] });
        void queryClient.invalidateQueries({ queryKey: ['timeline'] });
        void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      }
      await refreshCount();
    } finally {
      setSyncing(false);
    }
  }, [refreshCount, queryClient]);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  // An update queued while the app is open must show up in the count straight
  // away, not at the next remount.
  useEffect(() => {
    const onChange = () => {
      void refreshCount();
    };
    window.addEventListener(QUEUE_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, onChange);
  }, [refreshCount]);

  // Replay as soon as the device is back online.
  useEffect(() => {
    if (online) flush();
  }, [online, flush]);

  return { pending, syncing, lastResult, flush, refreshCount };
}