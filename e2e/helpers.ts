/**
 * Shared helpers for the browser tests (rewritten in CHG-098 for the
 * step-by-step scheduler of CHG-095).
 *
 * The tests run against a dev server with the local auth bypass
 * (HORARIO_INSECURE_DEV_AUTH) and a local Supabase, so every run shares one
 * tenant. Each test therefore creates rows under a name that is unique to the
 * run and asserts only on those rows.
 */
import { expect, type Page } from '@playwright/test';

/** A short suffix unique to this run, e.g. "k3f9". */
export const RUN = Math.random().toString(36).slice(2, 6);

export const unique = (name: string) => `${name} ${RUN}`;

/** A date `days` from today as YYYY-MM-DD (local time, like the app's forms). */
export const dateIn = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Opens a page with the first-visit tour picker suppressed. */
export const open = async (page: Page, path: string) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('horario.tourSeen', '1');
    } catch {
      /* storage blocked: the picker shows and the test closes it */
    }
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
};

export const openStep = async (page: Page, step: 'workers' | 'templates' | 'forecast' | 'shifts') => {
  await open(page, `/scheduler?section=${step}`);
  await expect(page.getByTestId(`section-tab-${step}`)).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
};

export const addWorker = async (page: Page, name: string, role: string) => {
  await page.getByLabel('Worker name').fill(name);
  await page.getByLabel('Worker role').fill(role);
  await page.getByTestId('add-worker-btn').click();
  await expect(page.getByTestId('worker-success-msg')).toContainText(name);
};

export const addTemplate = async (page: Page, name: string, role: string) => {
  await page.getByLabel('Template name').fill(name);
  await page.getByLabel('Template role').fill(role);
  await page.getByTestId('add-template-btn').click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
};

/** The proxy calls a page makes, so a test can assert on a write's outcome. */
export const proxyResponse = (page: Page, action: string) =>
  page.waitForResponse((res) => res.url().includes('/api/secure-proxy') && (res.request().postData() ?? '').includes(`"action":"${action}"`));
