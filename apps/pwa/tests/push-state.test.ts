import { describe, expect, it } from 'vitest';
import { pushState, type PushEnv } from '../src/lib/push-state';

const base: PushEnv = {
  secure: true,
  standalone: true,
  hasPushManager: true,
  permission: 'default',
  subscribed: false,
  serverEnabled: true,
  ios: false,
};

describe('push availability state machine', () => {
  it('is available on a secure, installed browser that has not decided yet', () => {
    expect(pushState(base)).toBe('available');
  });

  it('is subscribed once this browser holds a subscription', () => {
    expect(pushState({ ...base, subscribed: true })).toBe('subscribed');
  });

  it('reports a plain-http page as insecure, before anything else', () => {
    expect(pushState({ ...base, secure: false, hasPushManager: false })).toBe('insecure');
  });

  it('reports a browser without PushManager as unsupported', () => {
    expect(pushState({ ...base, hasPushManager: false })).toBe('unsupported');
  });

  it('reports the server switch as disabled even when the browser could subscribe', () => {
    expect(pushState({ ...base, serverEnabled: false })).toBe('disabled');
  });

  it('tells an iOS Safari tab to install first, and accepts the installed app', () => {
    expect(pushState({ ...base, ios: true, standalone: false })).toBe('needs-install');
    expect(pushState({ ...base, ios: true, standalone: true })).toBe('available');
  });

  it('still says "install first" on an iOS tab that has no PushManager', () => {
    // Safari in a tab exposes no PushManager; the capability test must not win.
    expect(pushState({ ...base, ios: true, standalone: false, hasPushManager: false }))
      .toBe('needs-install');
  });

  it('reports a blocked permission so the UI stops offering a button that cannot work', () => {
    expect(pushState({ ...base, permission: 'denied' })).toBe('blocked');
  });

  it('does not offer to enable while a permission prompt is already open', () => {
    expect(pushState({ ...base, permission: 'granted' })).toBe('available');
  });
});