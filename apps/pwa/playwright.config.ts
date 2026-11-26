import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 375, height: 667 },
    // Field officers work with the device position, so the browser context
    // reports a fixed Johor Bahru location and pre-grants the permission
    // instead of showing a prompt nobody can answer. `--use-fake-ui`-style
    // grants live here.
    permissions: ['geolocation'],
    geolocation: { latitude: 1.4927, longitude: 103.7414 },
    locale: 'en-MY',
    timezoneId: 'Asia/Kuala_Lumpur',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-chrome',
      // The deployed-stack UAT has its own project below (no resolver hack).
      testIgnore: /uat-mobile\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
        // The `city-os` realm pins its frontendUrl to the Keycloak *container*
        // name, so the sign-in page's form action points at
        // http://deploy-keycloak-1:8080 — unresolvable from a browser. Local
        // runs resolve that name to the loopback alias started by
        // `pnpm e2e:keycloak-alias`. See docs/testing.md and
        // e2e/support/keycloak-alias.mjs.
        launchOptions: {
          args: ['--host-resolver-rules=MAP deploy-keycloak-1 127.0.0.1'],
        },
      },
    },
    {
      // Mobile UAT against a deployed stack (M7). Phone profile, real sign-in
      // form, and deliberately NO --host-resolver-rules: it must prove a phone
      // can sign in. Run with E2E_BASE_URL=<:9447 origin> --workers=1.
      name: 'pixel7-uat',
      testMatch: /uat-mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  // Only start the dev server when testing locally; a remote E2E_BASE_URL is
  // an already-deployed stack.
  webServer: /^https?:\/\/(localhost|127\.0\.0\.1)/.test(process.env.E2E_BASE_URL ?? 'http://localhost:5173')
    ? {
        command: 'pnpm dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});