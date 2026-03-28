import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Horario App E2E tests.
 * Targets the Expo web build (expo start --web).
 *
 * Start the dev server before running:
 *   npx expo start --web --port 8081
 *
 * Run tests:
 *   npx playwright test --reporter=line
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 1,
  reporter: [['line'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer is intentionally NOT configured here — start expo manually
  // to avoid Playwright spawning a second server on CI.
});
