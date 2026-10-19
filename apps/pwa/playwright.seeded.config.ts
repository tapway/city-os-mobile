// Seeded-stack run for the P0 mobile gap tests. Targets an already-running seeded PWA
// (E2E_BASE_URL) and never starts a dev server, so it cannot attach to the live 5173 server.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /p0-gaps\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5174',
    viewport: { width: 375, height: 667 },
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
      use: {
        ...devices['Pixel 5'],
        launchOptions: {
          args: ['--host-resolver-rules=MAP deploy-keycloak-1 127.0.0.1'],
        },
      },
    },
  ],
});
