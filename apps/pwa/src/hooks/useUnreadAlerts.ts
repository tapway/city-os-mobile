/**
 * The unread count behind the bell.
 *
 * Polls only while the tab is visible and refetches when it becomes visible
 * again — a background poll would drain the handset for a number nobody is
 * looking at. Device push exists for the closed-app case.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listNotifications } from '../lib/notifications-api';
import { getAccessToken } from '../lib/auth';

const POLL_MS = 60_000;

/** Fired after a read receipt, so other mounted bells catch up without a poll. */
export const ALERTS_CHANGED = 'city-help:alerts-changed';

export function notifyAlertsChanged(): void {
  window.dispatchEvent(new Event(ALERTS_CHANGED));
}

export function useUnreadAlerts(enabled = true): { unread: number; refresh: () => void } {
  const [unread, setUnread] = useState(0);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(() => {
    if (!getAccessToken()) return;
    listNotifications({ limit: 1 })
      .then((page) => setUnread(page.unread_count ?? 0))
      .catch(() => {
        // A failed poll leaves the last known count; the next tick retries.
      });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const start = () => {
      refresh();
      if (timer.current === null) {
        timer.current = window.setInterval(() => {
          if (document.visibilityState === 'visible') refresh();
        }, POLL_MS);
      }
    };
    const stop = () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    start();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(ALERTS_CHANGED, refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(ALERTS_CHANGED, refresh);
      stop();
    };
  }, [enabled, refresh]);

  return { unread, refresh };
}