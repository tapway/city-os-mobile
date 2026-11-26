/**
 * Alerts: the in-app bell, the list, and the device-alert states.
 *
 * The API is stubbed on purpose: this suite proves the PWA's behaviour (badge,
 * read receipts, deep link, which toggle state is offered), while the platform
 * endpoints themselves are covered by tests/core/test_push_api.py and
 * tests/core/test_push_delivery.py in city-help-2.0. A real push cannot be
 * delivered by Playwright, so the payload→notification mapping is unit-tested
 * in tests/push-message.test.ts.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const APP = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

const NOTIFICATIONS = [
  {
    id: 11, kind: 'assigned', ticket_uid: 'CH-2026-00011',
    title_en: 'Ticket assigned to your department', title_bm: 'Tiket ditugaskan kepada jabatan anda',
    body_en: 'CH-2026-00011 was assigned to your department.',
    body_bm: 'CH-2026-00011 telah ditugaskan kepada jabatan anda.',
    created_at: '2026-11-02T03:00:00Z', read_at: null,
  },
  {
    id: 10, kind: 'sla_breached', ticket_uid: 'CH-2026-00010',
    title_en: 'SLA breached', title_bm: 'SLA dilanggar',
    body_en: 'CH-2026-00010 passed its SLA deadline (priority High).',
    body_bm: 'CH-2026-00010 telah melepasi tarikh akhir SLA (keutamaan Tinggi).',
    created_at: '2026-11-02T02:00:00Z', read_at: '2026-11-02T02:30:00Z',
  },
];

async function stubSession(page: Page) {
  await page.route('**/auth/refresh', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'test-token', expires_in: 300 }) }));
  await page.route('**/auth/me', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sub: 'u-1', username: 'eng1', name: 'Engineer One', roles: ['handling_staff'] }) }));
}

async function stubAlerts(page: Page, items = NOTIFICATIONS) {
  const unread = items.filter((n) => !n.read_at).length;
  await page.route('**/api/v1/notifications?*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, unread_count: unread }) }));
  await page.route('**/api/v1/notifications', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, unread_count: unread }) }));
}

async function stubPush(page: Page, enabled: boolean) {
  await page.route('**/api/v1/push/public-key', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ public_key: enabled ? 'BKey' : '', enabled }) }));
}

test.beforeEach(async ({ page }) => {
  await stubSession(page);
});

test('the bell shows the unread count and opens the list', async ({ page }) => {
  await stubAlerts(page);
  await stubPush(page, true);
  await page.goto(APP + '/tickets');
  const count = page.getByTestId('alerts-bell-count');
  await expect(count).toHaveText('1');
  await page.getByTestId('alerts-bell').click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByTestId('notifications-page')).toBeVisible();
  await expect(page.getByTestId('alerts-unread')).toContainText('1');
});

test('the list renders the active language and marks an alert read on open', async ({ page }) => {
  await stubAlerts(page);
  await stubPush(page, true);
  let patched = '';
  await page.route('**/api/v1/notifications/11/read', (route: Route) => {
    patched = route.request().method();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...NOTIFICATIONS[0], read_at: new Date().toISOString() }) });
  });
  // The ticket screen fetches its detail; keep it quiet so the assertion is about routing.
  await page.route('**/api/v1/events/**', (route: Route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not found' }) }));

  await page.goto(APP + '/notifications');
  await expect(page.getByText('Ticket assigned to your department')).toBeVisible();
  await page.getByTestId('notification-item-unread').click();
  await expect(page).toHaveURL(/\/tickets\/CH-2026-00011$/);
  expect(patched).toBe('PATCH');
});

test('mark all read calls the API and clears the badge', async ({ page }) => {
  await stubAlerts(page);
  await stubPush(page, true);
  let posted = '';
  await page.route('**/api/v1/notifications/read-all', (route: Route) => {
    posted = route.request().method();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updated: 1 }) });
  });

  await page.goto(APP + '/notifications');
  await page.getByTestId('alerts-mark-all').click();
  await expect(page.getByTestId('alerts-unread')).toHaveCount(0);
  expect(posted).toBe('POST');
});

async function stubPushCapable(page: Page, permission: 'default' | 'denied') {
  await page.addInitScript((perm) => {
    // Headless Chromium in some builds exposes neither, which would answer
    // "unsupported" before the state under test is reached. Pin the capability.
    class FakePushManager {}
    Object.defineProperty(window, 'PushManager', { value: FakePushManager, configurable: true });
    if (!('serviceWorker' in navigator)) {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) },
        configurable: true,
      });
    }
    Object.defineProperty(window.Notification, 'permission', { get: () => perm, configurable: true });
  }, permission);
}

test('says alerts are not configured instead of offering a dead button', async ({ page }) => {
  await stubAlerts(page);
  await stubPush(page, false);
  await stubPushCapable(page, 'default');
  await page.goto(APP + '/notifications');
  await expect(page.getByTestId('alerts-state')).toContainText('not configured on the server');
  await expect(page.getByTestId('alerts-toggle')).toHaveCount(0);
});

test('a blocked permission explains how to fix it and offers no retry', async ({ page }) => {
  await stubAlerts(page);
  await stubPush(page, true);
  await stubPushCapable(page, 'denied');
  await page.goto(APP + '/notifications');
  await expect(page.getByTestId('alerts-state')).toContainText('blocked in the browser settings');
  await expect(page.getByTestId('alerts-toggle')).toHaveCount(0);
});

test('a browser without PushManager says so', async ({ page }) => {
  await stubAlerts(page);
  await stubPush(page, true);
  await page.addInitScript(() => {
    // @ts-expect-error — deliberately remove the API this browser would have.
    delete window.PushManager;
  });
  await page.goto(APP + '/notifications');
  await expect(page.getByTestId('alerts-state')).toContainText('cannot receive alerts');
});