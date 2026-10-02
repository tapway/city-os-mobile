/**
 * Locators and page helpers for the mobile UAT. Language-independent: only
 * form ids / roles and `data-testid`s, never visible text, so the spec runs the
 * same in EN and BM.
 *
 * TEST IDS THE PWA MUST EXPOSE (M1/M2 add them; the spec fails fast naming the
 * missing one):
 *   tickets-filter-mine            the "Mine" filter chip on /tickets
 *   ticket-card                    (exists) one card per ticket
 *   ticket-gps-get                 the "Get GPS" button on /tickets/$id
 *   ticket-action-accept|start|complete   action buttons from available_actions
 *   ticket-add-photo               the "Add photo" button (opens a file chooser)
 */
import { expect, type Page } from '@playwright/test';
import { makePng } from './png';
import { UAT_PW, JB } from './uat-env';

export const ids = {
  mine: 'tickets-filter-mine',
  card: 'ticket-card',
  gps: 'ticket-gps-get',
  addPhoto: 'ticket-add-photo',
  action: (name: 'accept' | 'start' | 'complete') => `ticket-action-${name}`,
} as const;

/** Sign in through the in-app form (never the Keycloak redirect) as `engineer`. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  const user = page.locator('#login-username');
  await expect(user, 'password sign-in form (M5) should be the default').toBeVisible({ timeout: 30_000 });
  await user.fill('engineer');
  await page.locator('#login-password').fill(UAT_PW);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => /\/tickets/.test(u.pathname), { timeout: 40_000 });
  await expect(page.getByTestId(ids.card).or(page.getByRole('navigation').first())).toBeVisible({ timeout: 30_000 });
}

export async function openTicket(page: Page, uid: string): Promise<void> {
  await page.goto(`/tickets/${uid}`);
  await page.waitForLoadState('networkidle');
}

/** Take a fresh GPS fix if the screen asks for one (the control may be absent when GPS is automatic). */
export async function lockGps(page: Page): Promise<void> {
  const gps = page.getByTestId(ids.gps);
  if (await gps.isVisible().catch(() => false)) await gps.click();
}

/** A matcher for the status PATCH the PWA sends: PATCH /api/tickets/{uid}/status */
export const isStatusPatch = (uid: string) => (r: { url(): string; method(): string }) =>
  r.method() === 'PATCH' && r.url().includes(`/api/tickets/${uid}/status`);

export interface SentUpdate { status?: string; lat?: number; lng?: number; client_request_id?: string; image_urls?: string[] }

/** Parse a status PATCH: coordinates may travel in the query string or the body. */
export function parseUpdate(url: string, postData: string | null): SentUpdate {
  let body: SentUpdate = {};
  try { body = postData ? (JSON.parse(postData) as SentUpdate) : {}; } catch { /* not JSON */ }
  const q = new URL(url).searchParams;
  const num = (v: string | null) => (v === null ? undefined : Number(v));
  return { ...body, lat: body.lat ?? num(q.get('lat')), lng: body.lng ?? num(q.get('lng')) };
}

export function expectJohorBahru(u: SentUpdate): void {
  expect(u.lat, 'GPS lat sent with the update').toBeCloseTo(JB.latitude, 3);
  expect(u.lng, 'GPS lng sent with the update').toBeCloseTo(JB.longitude, 3);
}

/** A small generated PNG (a solid 32x32 square) for the photo input. */
export function testPng(): Buffer {
  return makePng(32, 32, [0x2e, 0x86, 0xde]);
}
