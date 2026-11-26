import { defineConfig } from 'vitest/config';

/**
 * Unit-test configuration, kept separate from vite.config.ts.
 *
 * Two reasons it is its own file:
 *   * vitest's default glob (`**\/*.spec.ts`) also matches `e2e/`, which
 *     belongs to Playwright. Collecting those specs fails with
 *     "Playwright Test did not expect test.describe() to be called here".
 *   * the app's plugins (React SWC, Tailwind, PWA) are not needed by these
 *     tests, and loading them here mixes the two Vite type sets.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});