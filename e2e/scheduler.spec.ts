/**
 * The scheduling flow, end to end: team, templates, days off, auto-assign,
 * publish, analytics. One serial run that builds on its own rows.
 */
import { expect, test, type Page } from '@playwright/test';

import { addTemplate, addWorker, dateIn, open, openStep, proxyResponse, unique } from './helpers';

const ROLE = unique('Barista');
const ANA = unique('Ana');
const LUIS = unique('Luis');
const TEMPLATE = unique('Morning');
// A date no other run of the day reuses is not needed: the role is unique.
const DATE = dateIn(9);

test.describe.configure({ mode: 'serial' });

/** The list starts with the next few shifts; a shared tenant can hold more. */
const showAllShifts = async (page: Page) => {
  const more = page.getByTestId('roster-show-all');
  if ((await more.count()) > 0 && (await more.innerText()).startsWith('Show all')) await more.click();
};

test('SC-1 adds two workers and they survive a reload', async ({ page }) => {
  await openStep(page, 'workers');
  await addWorker(page, ANA, ROLE);
  await addWorker(page, LUIS, ROLE);
  await page.reload();
  await expect(page.getByText(ANA, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(LUIS, { exact: true }).first()).toBeVisible();
});

test('SC-2 edits a worker through the form', async ({ page }) => {
  await openStep(page, 'workers');
  await page.getByRole('button', { name: `Edit worker ${LUIS}` }).click();
  await expect(page.getByLabel('Worker name')).toHaveValue(LUIS);
  await page.getByLabel('Worker skills').fill('Latte art');
  const saved = proxyResponse(page, 'upsertWorker');
  await page.getByTestId('add-worker-btn').click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByTestId('scheduler-action-banner')).toContainText(`${LUIS} updated`);
  await expect(page.getByLabel('Worker name')).toHaveValue('');
  await page.reload();
  await expect(page.getByText('Latte art').first()).toBeVisible({ timeout: 60_000 });
});

test('SC-3 gives both workers availability on every weekday', async ({ page }) => {
  await openStep(page, 'workers');
  for (const name of [ANA, LUIS]) {
    await page.getByRole('button', { name: `Select worker ${name}` }).first().click();
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      const chip = page.getByTestId(`availability-day-${day}`);
      if ((await chip.getAttribute('aria-checked')) !== 'true') await chip.click();
    }
    const saved = proxyResponse(page, 'upsertAvailability');
    await page.getByRole('button', { name: 'Add availability', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Assign now' }).or(page.getByText('Availability saved')).first()).toBeVisible();
  }
});

test('SC-4 adds a shift template, then edits its coverage', async ({ page }) => {
  await openStep(page, 'templates');
  await addTemplate(page, TEMPLATE, ROLE);
  await page.getByRole('button', { name: `Edit template ${TEMPLATE}` }).click();
  await expect(page.getByLabel('Template name')).toHaveValue(TEMPLATE);
  await page.getByLabel('Required coverage').fill('2');
  const saved = proxyResponse(page, 'upsertShiftTemplate');
  await page.getByTestId('add-template-btn').click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByTestId('scheduler-action-banner')).toContainText(`${TEMPLATE} updated`);
});

test('SC-5 a day off is saved on the server and keeps the worker out of auto-assign', async ({ page }) => {
  await openStep(page, 'workers');
  const daysOff = page.getByTestId('team-days-off');
  await daysOff.getByRole('radio', { name: LUIS, exact: true }).click();
  await page.getByTestId('day-off-date').fill(DATE);
  await page.getByTestId('day-off-reason').fill('Family');
  const saved = proxyResponse(page, 'upsertTimeOff');
  await page.getByTestId('day-off-add').click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  const reloaded = page.getByTestId('team-days-off');
  await reloaded.getByRole('radio', { name: LUIS, exact: true }).click({ timeout: 60_000 });
  await expect(reloaded.getByText(DATE)).toBeVisible();

  await openStep(page, 'shifts');
  await page.getByLabel('Date', { exact: true }).fill(DATE);
  await page.getByRole('button', { name: /^Auto-assign workers/ }).click();
  await expect(page.getByTestId('apply-auto-assign')).toBeVisible({ timeout: 60_000 });
  // Coverage is 2, Luis is off: Ana is suggested, one position stays open.
  const suggestions = page.getByText(`${ANA} → ${TEMPLATE}`);
  await expect(suggestions.first()).toBeVisible();
  await expect(page.getByText(`${LUIS} → ${TEMPLATE}`)).toHaveCount(0);
  const stored = proxyResponse(page, 'addRosterShifts');
  await page.getByTestId('apply-auto-assign').click();
  expect((await stored).status()).toBe(200);
  // One request saves every suggestion; then the suggestions go away.
  await expect(page.getByTestId('apply-auto-assign')).toHaveCount(0, { timeout: 30_000 });
  await showAllShifts(page);
  await expect(page.getByRole('button', { name: `Publish this shift: ${ANA}, ${DATE}` })).toBeVisible();
});

test('SC-6 publishes the shift and marks the worker as told', async ({ page }) => {
  await openStep(page, 'shifts');
  await expect(page.locator('[data-testid^="remove-shift-"]').first()).toBeVisible({ timeout: 60_000 });
  await showAllShifts(page);
  const publish = page.getByRole('button', { name: `Publish this shift: ${ANA}, ${DATE}` });
  await expect(publish).toBeVisible({ timeout: 60_000 });
  const published = proxyResponse(page, 'updateShiftStatus');
  await publish.click();
  expect((await published).status()).toBe(200);
  const told = proxyResponse(page, 'markShiftNotified');
  await page.getByRole('button', { name: `Mark this shift as told to the worker: ${ANA}, ${DATE}` }).click();
  expect((await told).status()).toBe(200);
  await expect(page.getByTestId('scheduler-action-banner')).toContainText('No message was sent');
});

test('SC-7 analytics shows the worker and filters by period', async ({ page }) => {
  await open(page, '/explore');
  await expect(page.getByTestId('analytics-coverage-rate')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(ANA).first()).toBeVisible();
  await page.getByTestId('analytics-period-month').click();
  await expect(page.getByTestId('analytics-period-month')).toHaveAttribute('aria-checked', 'true');
  // The shift is nine days ahead: outside "last 4 weeks".
  await expect(page.getByText(ANA)).toHaveCount(0);
  await page.getByTestId('analytics-period-all').click();
  await expect(page.getByText(ANA).first()).toBeVisible();
});
