/**
 * Keeps the server's device register in step with this handset.
 *
 * Called once from the app shell: on sign-in it refreshes the role/department
 * snapshot (so a role granted in Keycloak today routes alerts correctly today),
 * and it retries a subscription the service worker could not renew itself —
 * a service worker has no access token, so it only leaves a flag.
 */
import { useEffect } from 'react';
import { currentSubscription, enableDeviceAlerts, refreshSubscriptions } from '../lib/push-api';
import { getAccessToken, onSignedIn } from '../lib/auth';
import { clearResubscribeFlag, hasResubscribeFlag } from '../lib/push-flag';

async function sync() {
  if (!getAccessToken()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const needsResubscribe = await hasResubscribeFlag();

  if (needsResubscribe) {
    try {
      await enableDeviceAlerts();
      await clearResubscribeFlag();
    } catch {
      // Stays flagged; the next sign-in tries again.
    }
    return;
  }
  if (await currentSubscription()) {
    await refreshSubscriptions().catch(() => undefined);
  }
}

export function usePushLifecycle(): void {
  useEffect(() => {
    void sync();
    return onSignedIn(() => { void sync(); });
  }, []);
}