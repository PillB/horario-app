/**
 * global-setup.ts
 *
 * Runs once before the Playwright test suite.
 * Authenticates via Clerk sign-in token (bypasses CAPTCHA) and saves
 * the browser storage state to .playwright-auth/state.json so all
 * tests share the same authenticated session.
 *
 * Requires:
 *   CLERK_SECRET_KEY env var (loaded from .env.local via dotenv)
 *   CLERK_TEST_USER_ID env var (or default below)
 */

import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local into process.env
function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function generateSignInToken(userId: string, secretKey: string): Promise<string> {
  const res = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 600 }),
  });
  if (!res.ok) {
    throw new Error(`Clerk token generation failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json() as { token: string };
  return data.token;
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  loadEnvLocal();

  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  const authEnabled = publishableKey.startsWith('pk_');

  const authDir = path.join(process.cwd(), '.playwright-auth');
  const stateFile = path.join(authDir, 'state.json');

  // If auth is disabled (dev bypass mode), write empty state and return
  if (!authEnabled || !secretKey) {
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ cookies: [], origins: [] }));
    console.log('[global-setup] Auth disabled or no secret key — skipping sign-in.');
    return;
  }

  const userId = process.env.CLERK_TEST_USER_ID ?? 'user_3Bbn1glXfmbd72YN41Y7BwL2tCr';
  const token = await generateSignInToken(userId, secretKey);
  const signInUrl = `http://localhost:8081/sign-in?__clerk_ticket=${token}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(signInUrl, { timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Wait for redirect away from /sign-in (means auth succeeded)
    await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // Suppress the tour modal for all tests but do NOT set hasCompleted=true
    // (that would trigger sample data seeding on every scheduler page load)
    await page.evaluate(() => {
      try {
        window.localStorage.setItem('horario.tourSeen', '1');
        window.localStorage.setItem('horario.tour', JSON.stringify({ hasCompleted: false }));
      } catch { /* ignore */ }
    });

    // Save the authenticated storage state
    fs.mkdirSync(authDir, { recursive: true });
    await context.storageState({ path: stateFile });
    console.log(`[global-setup] Signed in as ${userId}. State saved to ${stateFile}`);
  } finally {
    await browser.close();
  }
}
