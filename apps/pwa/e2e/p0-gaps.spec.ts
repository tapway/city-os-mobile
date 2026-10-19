/**
 * P0 mobile gap checks (catalog MOB-01-02, MOB-02-02, MOB-02-05, MOB-08-03, MOB-09-03, MOB-10-05).
 *
 * Read-only on purpose: these tests sign in, search, change language, sign out, and mock the BFF
 * with a 503. They create and change no tickets, so they cannot write to any stack.
 *
 * Credentials: the same test account the existing suite uses (E2E_USERNAME / E2E_PASSWORD).
 * Never run these against live. Target the seeded stack only (playwright.seeded.config.ts).
 */
import { test, expect, type Page } from '@playwright/test';

const USERNAME = process.env.E2E_USERNAME ?? 'ops_user';
const PASSWORD = process.env.E2E_PASSWORD ?? 'ops123';

async function openSignIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForSelector('#login-username', { timeout: 30_000 });
}

async function signIn(page: Page, password = PASSWORD) {
  await openSignIn(page);
  await page.fill('#login-username', USERNAME);
  await page.fill('#login-password', password);
  await page.locator('form button[type="submit"]').click();
}

async function waitForApp(page: Page) {
  await page.waitForURL(
    (url) => url.origin === new URL(page.url()).origin && !url.pathname.startsWith('/auth/'),
    { timeout: 40_000 },
  );
  await page.waitForSelector('#ticket-search', { timeout: 30_000 });
}

/** Everything the app stored in the browser, as one string, for "does X leak?" checks. */
async function browserStorage(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const local = JSON.stringify({ ...localStorage });
    const session = JSON.stringify({ ...sessionStorage });
    const dbs = indexedDB && 'databases' in indexedDB ? await indexedDB.databases() : [];
    return `${local}|${session}|${dbs.map((d) => d.name).join(',')}`;
  });
}

test.describe('P0 mobile gaps (seeded, read-only)', () => {
  // MOB-01-02: wrong password shows one inline error, no session, no token in storage, no redirect loop.
  test('MOB-01-02 wrong password is refused without leaking a session', async ({ page }) => {
    await signIn(page, `${PASSWORD}-wrong-${Date.now()}`);
    const error = page.getByText(/invalid|incorrect|wrong|failed|tidak sah|salah/i).first();
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#ticket-search')).toHaveCount(0);
    const storage = await browserStorage(page);
    expect(storage).not.toMatch(/access_token|refresh_token|id_token/i);
    expect(page.url()).not.toMatch(/\/tickets/);
  });

  // MOB-02-05: an empty result shows a clear empty state, both for Mine and for search.
  test('MOB-02-05 empty search result shows an empty state', async ({ page }) => {
    await signIn(page);
    await waitForApp(page);
    await page.fill('#ticket-search', `ZZ-NO-MATCH-${Date.now()}`);
    await expect(
      page.getByText(/no (tickets|results|matches)|nothing found|tiada|tidak ada/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  // MOB-02-02: search narrows the list, clearing restores it.
  test('MOB-02-02 search narrows the list and clearing restores it', async ({ page }) => {
    await signIn(page);
    await waitForApp(page);
    const rows = page.locator('a[href^="/tickets/"]');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    const firstHref = (await rows.first().getAttribute('href')) ?? '';
    const uid = firstHref.split('/').pop() ?? '';
    await page.fill('#ticket-search', uid);
    await expect(rows).toHaveCount(1, { timeout: 15_000 });

    await page.fill('#ticket-search', '');
    await expect.poll(async () => rows.count(), { timeout: 15_000 }).toBe(before);
  });

  // MOB-08-03: language choice persists across reload.
  test('MOB-08-03 language choice persists across reload', async ({ page }) => {
    await signIn(page);
    await waitForApp(page);
    // The EN | BM switch marks the active language with aria-pressed, and each button has a lang attribute.
    const group = page.locator('[role="group"] button[lang][aria-pressed]');
    await expect(group.first()).toBeVisible({ timeout: 20_000 });
    const inactive = page.locator('[role="group"] button[lang][aria-pressed="false"]').first();
    const target = await inactive.getAttribute('lang');
    await inactive.click();
    await expect(page.locator(`[role="group"] button[lang="${target}"][aria-pressed="true"]`)).toBeVisible();
    await page.reload();
    await page.waitForSelector('#ticket-search', { timeout: 30_000 });
    await expect(
      page.locator(`[role="group"] button[lang="${target}"][aria-pressed="true"]`),
    ).toBeVisible({ timeout: 15_000 });
  });

  // MOB-09-03: logout clears the session and the user's cached data on a shared handset.
  test('MOB-09-03 logout clears the session and cached data', async ({ page }) => {
    await signIn(page);
    await waitForApp(page);
    await page.getByRole('button', { name: /log ?out|sign out/i }).first().click();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible({ timeout: 20_000 });
    const storage = await browserStorage(page);
    expect(storage).not.toMatch(/access_token|refresh_token|id_token/i);
    await page.goto('/tickets');
    await expect(page.locator('#ticket-search')).toHaveCount(0);
  });

  // MOB-10-05: Keycloak/BFF unreachable: the app shows a retry message, with no stack trace.
  test('MOB-10-05 BFF 503 shows a retry message, not a stack trace', async ({ page }) => {
    await signIn(page);
    await waitForApp(page);
    await page.route('**/api/**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'service unavailable' }),
      }),
    );
    await page.reload();
    await expect(
      page.getByText(/try again|retry|cuba lagi|service unavailable|unavailable/i).first(),
    ).toBeVisible({ timeout: 30_000 });
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Traceback|stack trace|at .*\.(ts|js):\d+/i);
  });
});
