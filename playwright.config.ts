import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const AUTH_STATE = path.join(__dirname, '.playwright-auth', 'state.json');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // The dev server is expected to already be running when tests execute.
  // Uncomment the block below to have Playwright start it automatically.
  // webServer: {
  //   command: 'npx expo start --web --port 8081',
  //   url: 'http://localhost:8081',
  //   reuseExistingServer: true,
  //   timeout: 120_000,
  // },
});