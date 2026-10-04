import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { deleteImage, uploadImage } from '../lib/help-api';
import { RETRY_INTERVAL_MS, shouldAutoRetry } from '../lib/retry-policy';
import {
  getQueue,
  syncQueue,
  shouldRecord,
  QUEUE_CHANGED_EVENT,
  type SyncResult,
} from '../lib/offline-queue';
import { onSignedIn, getSessionUser } from '../lib/auth';
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
        // Only this officer's entries go out; a colleague's wait for their sign-in.
        username: getSessionUser()?.username ?? null,
        uploadPhoto: (photo, uid) =>
          uploadImage(new File([photo.blob], photo.name, { type: photo.blob.type }), uid),
      });
      if (!shouldRecord(result)) return; // overlapping sync: keep the visible notice
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

  // A 401 paused the queue; replay once the officer has signed in again.
  useEffect(() => onSignedIn(() => void flush()), [flush]);

  // Replay as soon as the device is back online.
  useEffect(() => {
    if (online) flush();
  }, [online, flush]);

  // A queue that fails once (weak signal, server blip) must not sit until the
  // next reconnect event: retry on a timer while anything is waiting, and when
  // the officer comes back to the app.
  const authRequired = !!lastResult?.authRequired;
  const retry = shouldAutoRetry({ pending, online, authRequired });
  useEffect(() => {
    if (!retry) return;
    const timer = setInterval(() => void flush(), RETRY_INTERVAL_MS);
    const onFocus = () => {
      if (document.visibilityState === 'visible') void flush();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [retry, flush]);

  return { pending, syncing, lastResult, flush, refreshCount };
}