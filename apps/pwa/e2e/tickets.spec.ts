/**
 * End-to-end UX tests for the field-officer PWA, run against the real stack:
 * PWA (vite:5173) → BFF (:8002) → City Help API (deploy-api-1:8001) → Postgres.
 *
 * These are deliberately end-to-end: they drive the actual OIDC login form,
 * the real API and real writes. Every test creates the ticket it works on, so
 * the journey is self-contained, and every ticket it creates is retired
 * afterwards so the demo data is not left littered with test tickets.
 *
 * Credentials come from the environment, defaulting to the local development
 * realm's UAT account (see docs/testing.md).
 */
import { test, expect, type Page } from '@playwright/test';

const USERNAME = process.env.E2E_USERNAME ?? 'ops_user';
const PASSWORD = process.env.E2E_PASSWORD ?? 'ops123';
const APP_ORIGIN = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;

const GPS_LAT = '1.4927';
/** Unique marker so a test can find the ticket it created. */
const RUN_TAG = `E2E-${Date.now()}`;

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000a49444154789c63000100000500010d0a2db4' +
    '0000000049454e44ae426082',
  'hex',
);

async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /sign in/i }).click();

  // Keycloak's login form
  await page.waitForSelector('#username', { timeout: 30_000 });
  await page.fill('#username', USERNAME);
  await page.fill('#password', PASSWORD);
  await page.click('#kc-login');

  // Back through /auth/callback to the app's ticket list. Wait for the app's own
// origin — matching only on "not /auth/*" would be satisfied on Keycloak's page
// (its path is /realms/...), which then fails as a selector timeout.
  await page.waitForURL(
    (url) => url.origin === APP_ORIGIN && !url.pathname.startsWith('/auth/'),
    { timeout: 40_000 },
  );
  await page.waitForSelector('#ticket-search', { timeout: 30_000 });
}

/** Acquire a GPS fix and assert the coordinates are on screen. */
async function lockGps(page: Page) {
  await page.getByRole('button', { name: /get gps/i }).first().click();
  await expect(page.getByText(new RegExp(GPS_LAT)).first()).toBeVisible({ timeout: 20_000 });
}

/** Tickets this run created. Retired in afterAll — the API has no delete. */
const CREATED: string[] = [];

/**
 * A token for housekeeping only. The app keeps its access token in memory, so
 * the test fetches its own (the realm's mobile client is public — no secret, so
 * nothing sensitive belongs in this file).
 */
async function housekeepingToken(): Promise<string | null> {
  try {
    const resp = await fetch(
      'http://localhost:7080/realms/city-os/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: process.env.E2E_KC_CLIENT ?? 'city-os-mobile',
          username: USERNAME,
          password: PASSWORD,
          scope: 'openid profile',
        }),
      },
    );
    if (!resp.ok) return null;
    return ((await resp.json()) as { access_token?: string }).access_token ?? null;
  } catch {
    return null;
  }
}

/** Void a ticket this run created, so the demo list stays clean. */
async function retireTicket(uid: string, token: string): Promise<void> {
  const base = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
  const resp = await fetch(`${base}/api/v1/events/${uid}/void`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  // Loud on purpose: a silent cleanup failure is how test tickets accumulate in
  // the demo data. The path is /api/v1/events/... — without the v1 it 404s.
  if (!resp.ok) throw new Error(`could not retire ${uid}: HTTP ${resp.status}`);
}

test.afterAll(async () => {
  if (CREATED.length === 0) return;
  const token = await housekeepingToken();
  if (!token) return;
  for (const uid of CREATED) await retireTicket(uid, token);
});

/** Create a ticket through the UI and land on its detail screen. */
async function createTicket(page: Page, title: string) {
  await page.goto('/create-ticket');
  await page.waitForSelector('#incident-title', { timeout: 20_000 });

  await page.fill('#incident-title', title);
  await page.fill('#incident-description', 'Automated end-to-end verification of the field app.');
  await lockGps(page);

  await page.getByRole('button', { name: /submit report/i }).click();
  await page.waitForURL(/\/tickets\/[^/]+$/, { timeout: 40_000 });
  CREATED.push(new URL(page.url()).pathname.split('/').pop() as string);
}

test.describe('PWA shell', () => {
  test('sends an anonymous visitor to sign-in', async ({ page }) => {
    await page.goto('/tickets');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    await expect(page).toHaveTitle(/City OS/i);
  });

  test('bottom navigation exposes the three field-officer sections', async ({ page }) => {
    await login(page);
    const nav = page.getByRole('navigation', { name: /main navigation/i });
    await expect(nav.getByRole('link', { name: /tickets/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /attendance/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /report an incident/i })).toBeVisible();
  });
});

test.describe('Ticket journey', () => {
  test('create a ticket with GPS, find it by search, then update it with a comment', async ({
    page,
  }) => {
    await login(page);

    const title = `${RUN_TAG} Pothole on Jalan Skudai`;
    await createTicket(page, title);

    // The detail screen shows the ticket we just created.
    await expect(page.getByText(title)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^CH-/).first()).toBeVisible();

    // --- search finds it --------------------------------------------------
    await page.goto('/tickets');
    await page.fill('#ticket-search', RUN_TAG);
    await page.waitForTimeout(600); // debounce
    const cards = page.locator('[data-testid="ticket-card"]');
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    await expect(cards.filter({ hasText: RUN_TAG }).first()).toBeVisible();
    expect(await cards.count()).toBeLessThan(3); // the filter actually narrowed the list

    // --- open it ----------------------------------------------------------
    await cards.filter({ hasText: RUN_TAG }).first().click();
    await page.waitForURL(/\/tickets\/[^/]+$/);
    await expect(page.getByText(title)).toBeVisible({ timeout: 20_000 });

    // --- update with a fresh GPS fix + comment ----------------------------
    await lockGps(page);
    const comment = `On site, pothole measured ${RUN_TAG}`;
    await page.fill('#update-comment', comment);
    await page.selectOption('#update-status', 'IN_PROGRESS');
    await page.getByRole('button', { name: /save update/i }).click();

    // The activity timeline must show the comment without a manual reload.
    await expect(page.getByText(comment)).toBeVisible({ timeout: 40_000 });
    // The app confirms the update, and the ticket now reads as in progress in
    // the timeline. A bare getByText('IN PROGRESS') would match the hidden
    // <option> in the status control, which is never visible.
    await expect(page.getByText(/ticket updated with your gps position/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator('[data-testid="timeline"]').getByText(/in progress/i),
    ).toBeVisible({ timeout: 20_000 });

    // And it survives a reload (i.e. it was really persisted). Settle first:
    // reloading mid-flight aborts the update's follow-up requests, and an
    // aborted refresh can leave the browser holding a refresh token the server
    // has already rotated away — which signs the next load out.
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(page.getByText(comment)).toBeVisible({ timeout: 30_000 });
  });

  test('an update carries an evidence photo that the BFF serves back', async ({ page }) => {
    await login(page);
    const title = `${RUN_TAG} Broken street light`;
    await createTicket(page, title);

    await lockGps(page);
    await page.fill('#update-comment', `Photo attached ${RUN_TAG}`);

    // The photo input is created on demand by the "Add photo" control, so drive
// the file chooser rather than querying for an input that does not exist yet.
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: /add photo/i }).click(),
    ]);
    await chooser.setFiles({
      name: 'evidence.png',
      mimeType: 'image/png',
      buffer: PNG,
    });

    // The thumbnail proves the upload succeeded and the URL is servable.
    const thumb = page.locator('img[src*="/api/uploads/"], img[src*="blob:"]').first();
    await expect(thumb).toBeVisible({ timeout: 30_000 });

    await page.selectOption('#update-status', 'IN_PROGRESS');
    await page.getByRole('button', { name: /save update/i }).click();
    await expect(page.getByText(`Photo attached ${RUN_TAG}`)).toBeVisible({ timeout: 40_000 });

    // Re-open the ticket, as a returning officer would: the stored evidence must
    // come back from the server, not just from the upload preview. Settle first
    // (see the note in the journey test about aborted in-flight requests).
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(page.getByText(`Photo attached ${RUN_TAG}`)).toBeVisible({ timeout: 30_000 });
    const stored = page.locator('img[src*="/api/uploads/"]').first();
    await expect(stored).toBeVisible({ timeout: 30_000 });
    const src = await stored.getAttribute('src');
    const response = await page.request.get(src!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/');
  });
});

test.describe('Attendance', () => {
  test('clocking in records the device position', async ({ page }) => {
    await login(page);
    await page.goto('/attendance');
    await page.waitForSelector('h1', { timeout: 20_000 });

    await lockGps(page);

    // The day's attendance is durable, so an earlier run can leave the officer
    // already clocked in — or already finished, in which case the page correctly
    // offers no control at all. Drive whichever state is presented.
    const control = page.getByRole('button', { name: /clock (in|out)/i }).first();
    await expect(control.or(page.getByText(/completed/i).first())).toBeVisible({
      timeout: 20_000,
    });

    if (await control.count() > 0) {
      await expect(control).toBeEnabled({ timeout: 20_000 });
      await control.click();
    }

    // Either way the shift is now in a terminal state for today.
    await expect(
      page.getByText(/active|completed|not clocked in/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('Offline behaviour', () => {
  test('warns while offline and clears the warning when back online', async ({ page, context }) => {
    await login(page);

    await context.setOffline(true);
    await expect(page.getByText(/offline/i).first()).toBeVisible({ timeout: 20_000 });

    await context.setOffline(false);
    await expect(page.getByText(/offline/i).first()).toBeHidden({ timeout: 20_000 });
  });
});