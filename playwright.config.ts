import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const AUTH_STATE = path.join(__dirname, '.playwright-auth', 'state.json');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // The first visit to a page compiles its bundle in the dev server.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // No retries: the flow uses the account's free auto-assign, which a second attempt would not have.
  retries: 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:8081',
    storageState: AUTH_STATE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A sandbox with its own Chromium build can point at it.
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
  // Locally the dev server is reused when it already runs; CI starts it.
  webServer: {
    command: 'npx expo start --web --port 8081',
    url: 'http://localhost:8081',
    reuseExistingServer: true,
    timeout: 240_000,
    // Expo's CI mode turns off the dev server features the web bundle relies on here.
    env: { ...(process.env as Record<string, string>), CI: '' },
    stdout: 'ignore',
    stderr: 'pipe',
  },
});