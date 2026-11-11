/**
 * Home, page titles and the guided tour.
 */
import { expect, test } from '@playwright/test';

import { open } from './helpers';

test('TH-1 every page loads with its title and no page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [path, title] of [['/', /Home/], ['/scheduler', /Scheduler/], ['/explore', /Analytics/], ['/profile', /Profile/]] as const) {
    await open(page, path);
    await expect(page).toHaveTitle(title, { timeout: 60_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }
  expect(errors).toEqual([]);
});

test('TH-2 the tour button opens the guide picker and a guide can be walked and left', async ({ page }) => {
  await open(page, '/');
  await page.getByRole('button', { name: 'Start app tour' }).click({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Quick Overview', exact: true }).click();
  const card = page.getByTestId('tour-card');
  await expect(card).toBeVisible();
  const first = await card.innerText();
  await page.getByTestId('tour-next').click();
  await expect(card).not.toHaveText(first);
  await page.getByRole('button', { name: 'Skip tour' }).first().click();
  await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
});

test('TH-3 the tour never blocks the page behind it', async ({ page }) => {
  await open(page, '/scheduler');
  await page.getByRole('button', { name: 'Start app tour' }).click({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Scheduler Guide', exact: true }).click();
  await expect(page.getByTestId('tour-card')).toBeVisible();
  // A step tab stays clickable while the card is up.
  await page.getByTestId('section-tab-templates').click();
  await expect(page.getByTestId('section-tab-templates')).toHaveAttribute('aria-selected', 'true');
});
