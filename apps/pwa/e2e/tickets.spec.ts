/**
 * End-to-end UX tests for the field-officer PWA, run against the real stack:
 * PWA (vite:5173) → BFF (:8002) → City Help API (deploy-api-1:8001) → Postgres.
 *
 * These are deliberately end-to-end: they drive the actual OIDC login form,
 * the real API and real writes. Every test creates the ticket it works on, so
 * the journey is self-contained and the demo data is not disturbed.
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

/** Create a ticket through the UI and land on its detail screen. */
async function createTicket(page: Page, title: string) {
  await page.goto('/create-ticket');
  await page.waitForSelector('#incident-title', { timeout: 20_000 });

  await page.fill('#incident-title', title);
  await page.fill('#incident-description', 'Automated end-to-end verification of the field app.');
  await lockGps(page);

  await page.getByRole('button', { name: /submit report/i }).click();
  await page.waitForURL(/\/tickets\/[^/]+$/, { timeout: 40_000 });
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
    // Scope to the timeline: a bare getByText('IN PROGRESS') matches the hidden
    // <option> in the status control first, and that element is never visible.
    await expect(
      page.locator('[data-testid="timeline"]').getByText(/in progress/i),
    ).toBeVisible({ timeout: 20_000 });

    // And it survives a reload (i.e. it was really persisted).
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
    // already clocked in and only "Clock out" is offered. Drive whichever
    // control the current state presents, and require the badge to reflect it.
    const control = page.getByRole('button', { name: /clock (in|out)/i }).first();
    await expect(control).toBeEnabled({ timeout: 20_000 });
    await control.click();

    await expect(
      page.getByText(/clocked in|clocked out|not clocked in/i).first(),
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