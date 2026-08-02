import { test, expect } from '@playwright/test';

test('PWA loads and shows login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/City OS/);
});

test('ticket list loads with mock data (MSW)', async ({ page }) => {
  await page.goto('/tickets');
  await expect(page.locator('text=My Tickets')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=Pothole on Jalan Skudai')).toBeVisible({ timeout: 10_000 });
});

test('ticket detail shows Start Handling button', async ({ page }) => {
  await page.goto('/tickets');
  await page.locator('text=Pothole on Jalan Skudai').click();
  await expect(page.locator('text=Start Handling')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=Get GPS')).toBeVisible({ timeout: 10_000 });
});

test('attendance screen shows clock-in button', async ({ page }) => {
  await page.goto('/attendance');
  await expect(page.locator('text=Clock In')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=Get GPS Position')).toBeVisible({ timeout: 10_000 });
});

test('bottom navigation is visible on main screens', async ({ page }) => {
  await page.goto('/tickets');
  await expect(page.locator('text=Tickets')).toBeVisible();
  await expect(page.locator('text=Attendance')).toBeVisible();
});