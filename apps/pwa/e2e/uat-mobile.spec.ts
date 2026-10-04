/**
 * City OS Mobile UAT (plan 95, M7). Field-officer journey against a deployed
 * stack, driven as `engineer` on a Pixel 7 profile:
 *
 *   sign in -> Mine -> Accept -> Start (GPS) -> Complete (GPS + photo)
 *           -> evidence visible -> offline Start replays once
 *
 * Every test creates its own ticket through the City Help API (operator +
 * dispatcher path, tagged UAT-<run>) and closes it afterwards.
 *
 * Needs rc2+ (B11 v2 status routing, assignee=me, available_actions) and the
 * M1/M2 test ids listed in support/uat-ui.ts. Credentials are env-only:
 * UAT_PW (required), UAT_ADMIN_PW (optional). See support/uat-env.ts.
 *
 *   UAT_PW=... E2E_BASE_URL=https://devtesting-system-product-name.taild39ddc.ts.net:9447 \
 *     npx playwright test --project=pixel7-uat --workers=1
 */
import { test, expect } from '@playwright/test';
import {
  UAT_PW, MISSING_PW_MESSAGE, JB, RUN_TAG, HELP_URL,
} from './support/uat-env';
import {
  createDispatchedTicket, acceptAsEngineer, startAsEngineer, closeTicket,
  detail, timeline, legacyTimeline, call, tokenFor, storagePath, type UatTicket,
} from './support/uat-api';
import {
  ids, signIn, openTicket, lockGps, isStatusPatch, parseUpdate, expectJohorBahru, testPng,
  type SentUpdate,
} from './support/uat-ui';

test.describe.configure({ mode: 'serial' });

/** Tickets created by the running test; closed in afterEach. */
let created: UatTicket[] = [];

async function newTicket(label: string): Promise<UatTicket> {
  const t = await createDispatchedTicket(label);
  created.push(t);
  return t;
}

test.beforeEach(async ({ context }) => {
  test.skip(!UAT_PW, MISSING_PW_MESSAGE);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(JB);
});

test.afterEach(async () => {
  const toClose = created;
  created = [];
  const failures: string[] = [];
  for (const t of toClose) {
    try { await closeTicket(t.uid); } catch (e) { failures.push((e as Error).message); }
  }
  // Loud on purpose: a silent cleanup failure litters the demo data.
  if (failures.length) throw new Error(`UAT cleanup failed:\n${failures.join('\n')}`);
});

test.describe('MOBILE UAT', () => {
  test('MOBILE-01 sign in through the in-app form, no Keycloak redirect', async ({ page }) => {
    const origin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;
    const foreign: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (r.isNavigationRequest() && u.origin !== origin) foreign.push(u.origin);
    });
    const authConfig = page.waitForResponse((r) => r.url().endsWith('/auth/config'));
    await page.goto('/login');
    expect(await (await authConfig).json()).toMatchObject({ mode: 'password' });
    await signIn(page);
    await expect(page).toHaveURL(/\/tickets/);
    expect(foreign, 'sign-in must never navigate away to Keycloak').toEqual([]);
    // The session survives a reload (refresh cookie), as a phone user expects.
    await page.waitForLoadState('networkidle');
    await page.reload();
    await expect(page).toHaveURL(/\/tickets/);
  });

  test('MOBILE-02 Mine lists tickets assigned to the engineer and only those', async ({ page }) => {
    const mine = await newTicket('mine');
    const other = await newTicket('not-mine');
    await acceptAsEngineer(mine.uid);
    expect((await detail('engineer', mine.uid)).workflow_state).toBe('accepted');

    // The list API agrees with the screen: assignee=me contains mine, not the unassigned one.
    const list = await call<{ items: Array<{ ticket_uid: string }> }>(
      'engineer', 'GET', `/api/v1/events?assignee=me&q=${encodeURIComponent(RUN_TAG)}&limit=100`);
    expect(list.ok).toBe(true);
    const uids = list.body.items.map((i) => i.ticket_uid);
    expect(uids).toContain(mine.uid);
    expect(uids).not.toContain(other.uid);

    await signIn(page);
    const chip = page.getByTestId(ids.mine);
    await expect(chip, 'M1 Mine filter').toBeVisible();
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
    await page.locator('#ticket-search').fill(RUN_TAG);
    const cards = page.getByTestId(ids.card);
    await expect(cards.filter({ hasText: mine.title })).toHaveCount(1, { timeout: 20_000 });
    await expect(cards.filter({ hasText: other.title })).toHaveCount(0);
  });

  test('MOBILE-03 Accept moves dispatch to accepted', async ({ page }) => {
    const t = await newTicket('accept');
    await signIn(page);
    await openTicket(page, t.uid);
    expect((await detail('engineer', t.uid)).workflow_state).toBe('dispatch');

    const sent = page.waitForRequest(isStatusPatch(t.uid));
    await lockGps(page);
    await page.getByTestId(ids.action('accept')).click();
    const u: SentUpdate = parseUpdate((await sent).url(), (await sent).postData());
    expect(u.status).toBe('ASSIGNED');
    expect(u.client_request_id).toBeTruthy();

    await expect.poll(async () => (await detail('engineer', t.uid)).workflow_state, { timeout: 30_000 })
      .toBe('accepted');
    const d = await detail('engineer', t.uid);
    expect(d.assigned_to).toBeTruthy();
    // Accept is no longer offered; Start is.
    expect(d.available_actions?.map((a) => a.action)).toContain('start');
    await expect(page.getByTestId(ids.action('start'))).toBeVisible({ timeout: 20_000 });
  });

  test('MOBILE-04 Start with GPS moves accepted to in_progress', async ({ page }) => {
    const t = await newTicket('start');
    await acceptAsEngineer(t.uid);
    await signIn(page);
    await openTicket(page, t.uid);

    await lockGps(page);
    const sent = page.waitForRequest(isStatusPatch(t.uid));
    await page.getByTestId(ids.action('start')).click();
    const req = await sent;
    const u = parseUpdate(req.url(), req.postData());
    expect(u.status).toBe('IN_PROGRESS');
    expectJohorBahru(u);

    await expect.poll(async () => (await detail('engineer', t.uid)).workflow_state, { timeout: 30_000 })
      .toBe('in_progress');
    const tl = await timeline('engineer', t.uid);
    expect(tl.filter((e) => e.from_state === 'accepted' && e.to_state === 'in_progress')).toHaveLength(1);
  });

  test('MOBILE-05 Complete with GPS and a photo moves in_progress to awaiting_evidence', async ({ page }) => {
    const t = await newTicket('complete');
    await acceptAsEngineer(t.uid);
    await startAsEngineer(t.uid);
    await signIn(page);
    await openTicket(page, t.uid);

    await lockGps(page);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId(ids.addPhoto).click(),
    ]);
    await chooser.setFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: testPng() });

    const sent = page.waitForRequest(isStatusPatch(t.uid));
    await page.getByTestId(ids.action('complete')).click();
    const req = await sent;
    const u = parseUpdate(req.url(), req.postData());
    expect(u.status).toBe('RESOLVED');
    expectJohorBahru(u);
    expect(u.image_urls?.length, 'photo travels as image_urls').toBeGreaterThanOrEqual(1);

    await expect.poll(async () => (await detail('engineer', t.uid)).workflow_state, { timeout: 40_000 })
      .toBe('awaiting_evidence');
  });

  test('MOBILE-06 evidence is visible on the ticket and served by /api/storage', async ({ page }) => {
    const t = await newTicket('evidence');
    await acceptAsEngineer(t.uid);
    await startAsEngineer(t.uid);
    await signIn(page);
    await openTicket(page, t.uid);

    await lockGps(page);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByTestId(ids.addPhoto).click(),
    ]);
    await chooser.setFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: testPng() });
    const done = page.waitForResponse((r) => isStatusPatch(t.uid)(r.request()));
    await page.getByTestId(ids.action('complete')).click();
    expect((await done).ok()).toBe(true);

    await expect.poll(async () => (await detail('engineer', t.uid)).workflow_state, { timeout: 40_000 })
      .toBe('awaiting_evidence');
    const d = await detail('engineer', t.uid);
    expect(d.image_urls?.length ?? 0, 'detail lists the image').toBeGreaterThanOrEqual(1);
    const att = (d.attachments ?? []).find((a) => storagePath(a));
    expect(att, 'detail lists an evidence attachment with a storage key').toBeTruthy();

    const path = storagePath(att!)!;
    const img = await fetch(`${HELP_URL}${path}`, {
      headers: { Authorization: `Bearer ${await tokenFor('engineer')}` },
    });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type') ?? '').toMatch(/^image\//);
  });

  test('MOBILE-07 Start tapped offline replays exactly once', async ({ page, context }) => {
    const t = await newTicket('offline-start');
    await acceptAsEngineer(t.uid);
    await signIn(page);
    await openTicket(page, t.uid);
    await lockGps(page);

    const ids_seen = new Set<string>();
    const note = (r: { url(): string; method(): string; postData(): string | null }) => {
      if (isStatusPatch(t.uid)(r)) {
        const id = parseUpdate(r.url(), r.postData()).client_request_id;
        if (id) ids_seen.add(id);
      }
    };
    page.on('request', note);

    await context.setOffline(true);
    await page.getByTestId(ids.action('start')).click();
    // Nothing reached the server while offline.
    await page.waitForTimeout(1_500);
    expect((await detail('engineer', t.uid)).workflow_state).toBe('accepted');

    await context.setOffline(false);
    await expect.poll(async () => (await detail('engineer', t.uid)).workflow_state, { timeout: 60_000 })
      .toBe('in_progress');

    // Give a duplicate replay time to show itself, then count.
    await page.waitForTimeout(5_000);
    const tl = await timeline('engineer', t.uid);
    expect(tl.filter((e) => e.from_state === 'accepted' && e.to_state === 'in_progress')).toHaveLength(1);
    // Exactly-once on the legacy timeline: one ASSIGNED -> IN_PROGRESS status change, however many replays.
    const legacy = await legacyTimeline('engineer', t.uid);
    expect(
      legacy.filter((e) => e.old_status === 'ASSIGNED' && e.new_status === 'IN_PROGRESS'),
      'one ASSIGNED -> IN_PROGRESS status-change event',
    ).toHaveLength(1);
    expect(ids_seen.size, 'one logical update, one client_request_id').toBeLessThanOrEqual(1);
  });
});
