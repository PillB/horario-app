/**
 * What the scheduler refuses, and that it says why.
 */
import { expect, test } from '@playwright/test';

import { openStep } from './helpers';

test('SN-1 a worker needs a name and a role', async ({ page }) => {
  await openStep(page, 'workers');
  await page.getByLabel('Worker role').fill('Cook');
  await page.getByTestId('add-worker-btn').click();
  await expect(page.getByText('Worker name is required.')).toBeVisible();
  await page.getByLabel('Worker name').fill('Nameless role test');
  await page.getByLabel('Worker role').fill('');
  await page.getByTestId('add-worker-btn').click();
  await expect(page.getByText('Role is required.')).toBeVisible();
});

test('SN-2 a template refuses a time that is not HH:MM', async ({ page }) => {
  await openStep(page, 'templates');
  await page.getByLabel('Template name').fill('Bad time');
  await page.getByLabel('Template role').fill('Cook');
  await page.getByLabel('Shift start time').fill('9am');
  await page.getByTestId('add-template-btn').click();
  await expect(page.getByText(/Start time must use the 24-hour HH:MM format/)).toBeVisible();
});

test('SN-3 a template refuses coverage below 1', async ({ page }) => {
  await openStep(page, 'templates');
  await page.getByLabel('Template name').fill('No coverage');
  await page.getByLabel('Template role').fill('Cook');
  await page.getByLabel('Required coverage').fill('0');
  await page.getByTestId('add-template-btn').click();
  await expect(page.getByText('Coverage must be at least 1.')).toBeVisible();
});

test('SN-4 a deep link to an unknown step falls back to a real one', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('horario.tourSeen', '1'); } catch { /* ignore */ } });
  await page.goto('/scheduler?section=nonsense');
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1, { timeout: 60_000 });
});
