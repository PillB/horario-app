/**
 * Home, page titles and the guided tour.
 */
import { expect, test, type Page } from '@playwright/test';

import { open } from './helpers';

/**
 * Opens the guide picker and starts a guide. The page is rendered to HTML ahead
 * of time, so the button can be on screen before it reacts: click until it does.
 */
const openGuidePicker = async (page: Page, guide: string) => {
  const start = page.getByRole('button', { name: guide, exact: true });
  await expect(async () => {
    if (!(await start.isVisible())) await page.getByRole('button', { name: 'Start app tour' }).click();
    await expect(start).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await start.click();
};

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
  await openGuidePicker(page, 'Quick Overview');
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
  await openGuidePicker(page, 'Scheduler Guide');
  await expect(page.getByTestId('tour-card')).toBeVisible();
  // A step tab stays clickable while the card is up.
  await page.getByTestId('section-tab-templates').click();
  await expect(page.getByTestId('section-tab-templates')).toHaveAttribute('aria-selected', 'true');
});
