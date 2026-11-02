import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enableDeviceAlerts,
  getPushConfig,
  registerSubscription,
  removeSubscription,
  refreshSubscriptions,
  urlBase64ToUint8Array,
} from '../src/lib/push-api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('push API client', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads the server key and whether the server can send at all', async () => {
    fetchMock.mockResolvedValueOnce(json({ public_key: 'BKey', enabled: true }));
    await expect(getPushConfig()).resolves.toEqual({ public_key: 'BKey', enabled: true });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/push/public-key');
  });

  it('sends endpoint, keys and a truncated user agent when registering', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 3 }, 201));
    await registerSubscription(
      { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } },
      'Mozilla/5.0 ' + 'x'.repeat(400),
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/push/subscriptions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.endpoint).toBe('https://fcm.googleapis.com/x');
    expect(body.keys).toEqual({ p256dh: 'p', auth: 'a' });
    expect(body.user_agent.length).toBeLessThanOrEqual(255);
  });

  it('unsubscribes by endpoint in the DELETE body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await removeSubscription('https://fcm.googleapis.com/x');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/push/subscriptions');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ endpoint: 'https://fcm.googleapis.com/x' });
  });

  it('refreshes the role snapshot on app open', async () => {
    fetchMock.mockResolvedValueOnce(json({ updated: 2 }));
    await expect(refreshSubscriptions()).resolves.toEqual({ updated: 2 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/push/subscriptions/refresh');
    expect(init.method).toBe('POST');
  });

  it('decodes a base64url VAPID key the way PushManager expects', () => {
    // "AQAB" is the base64url of 01 00 01.
    expect(Array.from(urlBase64ToUint8Array('AQAB'))).toEqual([1, 0, 1]);
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
  });

  it('asks for permission before the config fetch (Safari loses the activation)', async () => {
    const order: string[] = [];
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: async () => { order.push('permission'); return 'granted'; },
    });
    vi.stubGlobal('navigator', {
      userAgent: 'test-agent',
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            subscribe: async () => ({
              toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }),
            }),
          },
        }),
      },
    });
    fetchMock.mockImplementation(async () => { order.push('fetch'); return json({ public_key: 'BKey', enabled: true }); });

    await expect(enableDeviceAlerts()).resolves.toBe('subscribed');
    expect(order[0]).toBe('permission');
  });
});