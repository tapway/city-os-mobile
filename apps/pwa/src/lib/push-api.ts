/**
 * Device alerts: the server key, this browser's subscription, and the two
 * endpoints that keep the server's register in step with the handset.
 *
 * Nothing here prompts for permission — that must happen inside a user gesture,
 * so the caller (the Alerts toggle) does it and passes the result down.
 */
import { apiFetch, apiJson } from './api';

export interface PushConfig {
  public_key: string;
  enabled: boolean;
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const MAX_UA = 255;

export function getPushConfig(): Promise<PushConfig> {
  return apiJson<PushConfig>('/api/v1/push/public-key');
}

export function registerSubscription(sub: BrowserSubscription, userAgent: string): Promise<{ id: number }> {
  return apiJson<{ id: number }>('/api/v1/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ ...sub, user_agent: userAgent.slice(0, MAX_UA) }),
  });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await apiFetch('/api/v1/push/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
}

export function refreshSubscriptions(): Promise<{ updated: number }> {
  return apiJson<{ updated: number }>('/api/v1/push/subscriptions/refresh', { method: 'POST' });
}

/** VAPID keys are base64url; PushManager wants a Uint8Array. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    // `ready` never settles when no service worker is registered yet (a dev
    // server, or a browser where registration failed). Without the timeout the
    // alerts panel would sit on its loading state forever.
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

export async function subscribeThisBrowser(key: string): Promise<BrowserSubscription> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
  });
  return sub.toJSON() as unknown as BrowserSubscription;
}

/**
 * Turn alerts on for this browser: subscribe, then register the endpoint with
 * the server. Returns the endpoint so the caller can show the right state.
 */
export async function enableDeviceAlerts(): Promise<'subscribed' | 'blocked' | 'disabled'> {
  // Ask first: Safari drops a permission prompt requested after a network await
  // (the transient user activation is gone), which looks like a silent refusal.
  // Callers only offer this when the server reports enabled, and the granted
  // check below still answers "disabled" if the config changed meanwhile.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'blocked';
  const cfg = await getPushConfig();
  if (!cfg.enabled || !cfg.public_key) return 'disabled';
  const sub = await subscribeThisBrowser(cfg.public_key);
  await registerSubscription(sub, navigator.userAgent);
  return 'subscribed';
}

/** Turn alerts off for this browser, locally first so a failed call cannot leave it on. */
export async function disableDeviceAlerts(): Promise<void> {
  const sub = await currentSubscription();
  await sub?.unsubscribe();
  if (sub) {
    try {
      await removeSubscription(sub.endpoint);
    } catch {
      // Best effort: the row is pruned server-side after repeated 410s anyway.
    }
  }
}