/**
 * Whether this browser can receive device alerts, and what the UI should say.
 *
 * Kept pure so every branch — plain http, iOS Safari tab, blocked permission,
 * server switch off — is unit-tested without a browser.
 */
export interface PushEnv {
  /** Secure context (https or localhost). Push is impossible without it. */
  secure: boolean;
  /** Running as an installed app (Home Screen on iOS, standalone elsewhere). */
  standalone: boolean;
  hasPushManager: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  /** The server answered with a VAPID public key. */
  serverEnabled: boolean;
  ios: boolean;
}

export type PushState =
  | 'insecure'
  | 'unsupported'
  | 'disabled'
  | 'needs-install'
  | 'blocked'
  | 'subscribed'
  | 'available';

export function pushState(env: PushEnv): PushState {
  if (!env.secure) return 'insecure';
  // iOS Safari in a tab exposes no PushManager at all, so the install advice has
  // to be decided before the capability check — otherwise the one audience it is
  // written for only ever sees "this browser cannot receive alerts".
  if (env.ios && !env.standalone) return 'needs-install';
  if (!env.hasPushManager) return 'unsupported';
  if (!env.serverEnabled) return 'disabled';
  if (env.permission === 'denied') return 'blocked';
  if (env.subscribed) return 'subscribed';
  return 'available';
}

/** Message keys the screen renders for each state (see src/i18n/en.ts). */
export const PUSH_STATE_KEY = {
  insecure: 'alerts.state.insecure',
  unsupported: 'alerts.state.unsupported',
  disabled: 'alerts.state.disabled',
  'needs-install': 'alerts.state.needsInstall',
  blocked: 'alerts.state.blocked',
  subscribed: 'alerts.state.on',
  available: 'alerts.state.off',
} as const;

/** True only when the user could actually turn alerts on from this screen. */
export function canEnable(state: PushState): boolean {
  return state === 'available';
}