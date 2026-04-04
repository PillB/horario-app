import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEDULER_URL = 'http://localhost:8081/(tabs)/scheduler';
const NAV_TIMEOUT = 30_000;
const VISIBLE_TIMEOUT = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function goToScheduler(page: Page): Promise<void> {
  await page.goto(SCHEDULER_URL, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /scheduler/i }).waitFor({
    state: 'visible',
    timeout: NAV_TIMEOUT,
  });
}

async function fillField(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByRole('textbox', { name: label, exact: true });
  await field.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
  await field.clear();
  await field.fill(value);
}

async function clickButton(page: Page, name: string): Promise<void> {
  const btn = page.getByRole('button', { name, exact: true });
  await btn.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
  await btn.click();
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Scheduler negative and edge-case scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await goToScheduler(page);
  });

  // -------------------------------------------------------------------------
  // NEG-1: Adding a worker with an empty Name field → validation error shown
  // -------------------------------------------------------------------------
  test('NEG-1: shows validation error when worker name is empty', async ({ page }) => {
    // Leave "Worker name" intentionally blank; fill other required fields.
    await fillField(page, 'Worker role', 'Barista');
    await fillField(page, 'Worker skills', 'espresso');

    await clickButton(page, 'Add worker');

    // The UI must render some kind of validation feedback.
    // Accept any of the common patterns: aria-live region, inline error, toast.
    const errorIndicator = page
      .getByText(/(name is required|please enter a name|worker name.*required|field is required|invalid|cannot be empty)/i)
      .first();

    await expect(errorIndicator).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  // -------------------------------------------------------------------------
  // NEG-2: Adding a shift template with missing Role → validation error shown
  // -------------------------------------------------------------------------
  test('NEG-2: shows validation error when shift template role is missing', async ({ page }) => {
    const templateSection = page.getByText(/shift template/i).first();
    await templateSection.scrollIntoViewIfNeeded();

    // Fill every field EXCEPT "Template role".
    await fillField(page, 'Template name', 'No-Role Template');
    // Leave "Template role" blank — do not call fillField for it.
    await fillField(page, 'Shift start time', '08:00');
    await fillField(page, 'Shift end time', '16:00');
    await fillField(page, 'Required coverage', '1');

    await clickButton(page, 'Add template');

    const errorIndicator = page
      .getByText(/(role is required|please enter a role|template role.*required|field is required|invalid|cannot be empty)/i)
      .first();

    await expect(errorIndicator).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  // -------------------------------------------------------------------------
  // NEG-3: Assigning a shift to a worker whose role does NOT match the template
  //         role → assignment rejected or error shown
  // -------------------------------------------------------------------------
  test('NEG-3: rejects shift assignment when worker role does not match template role', async ({
    page,
  }) => {
    // First, create a template with a role that does NOT match the worker we
    // will try to assign.
    const templateSection = page.getByText(/shift template/i).first();
    await templateSection.scrollIntoViewIfNeeded();

    await fillField(page, 'Template name', 'Mismatch Template');
    await fillField(page, 'Template role', 'Chef');
    await fillField(page, 'Shift start time', '09:00');
    await fillField(page, 'Shift end time', '17:00');
    await fillField(page, 'Required coverage', '1');

    await clickButton(page, 'Add template');

    // Wait briefly for the template to be registered in UI state.
    await page
      .getByText(/Mismatch Template/i)
      .first()
      .waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT })
      .catch(() => undefined);

    // Now scroll to the shift assignment section and attempt to assign a worker
    // whose role is "Barista" (not "Chef") to the "Mismatch Template".
    const rosterSection = page.getByText(/assign workers into templates/i).first();
    await rosterSection.scrollIntoViewIfNeeded();

    // Fill the date field — this is the SECOND "Date" textbox on the page.
    const dateField = page.getByRole('textbox', { name: 'Date', exact: true }).nth(1);
    await dateField.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await dateField.clear();
    await dateField.fill('2026-05-01');

    // Select or type the mismatched worker role name.
    const workerField = page.getByRole('textbox', { name: 'Worker', exact: true }).first();
    const workerVisible = await workerField.isVisible().catch(() => false);
    if (workerVisible) {
      await workerField.clear();
      await workerField.fill('Alice Chen'); // Assumed role: Barista, not Chef.
    }

    // Attempt to select the mismatched template if a template selector exists.
    const templateField = page
      .getByRole('textbox', { name: /template/i })
      .first();
    const templateFieldVisible = await templateField.isVisible().catch(() => false);
    if (templateFieldVisible) {
      await templateField.clear();
      await templateField.fill('Mismatch Template');
    }

    await clickButton(page, 'Save and notify team');

    // The UI should surface a role-mismatch rejection or a generic error.
    const errorIndicator = page
      .getByText(
        /(role.*mismatch|does not match|worker.*not eligible|incompatible role|cannot assign|error|invalid)/i,
      )
      .first();

    await expect(errorIndicator).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  // -------------------------------------------------------------------------
  // NEG-4: Assigning a shift to a worker with NO availability set → rejected
  // -------------------------------------------------------------------------
  test('NEG-4: rejects shift assignment when worker has no availability', async ({ page }) => {
    // Use a worker known to have no availability in the test dataset,
    // or a freshly minted name unlikely to have stored availability.
    const rosterSection = page.getByText(/assign workers into templates/i).first();
    await rosterSection.scrollIntoViewIfNeeded();

    const dateField = page.getByRole('textbox', { name: 'Date', exact: true }).nth(1);
    await dateField.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await dateField.clear();
    await dateField.fill('2026-12-31');

    const workerField = page.getByRole('textbox', { name: 'Worker', exact: true }).first();
    const workerVisible = await workerField.isVisible().catch(() => false);
    if (workerVisible) {
      await workerField.clear();
      // Use a name that is extremely unlikely to have availability stored.
      await workerField.fill('No-Availability Worker XYZ');
    }

    await clickButton(page, 'Save and notify team');

    // Expect a warning/error about no availability or worker not found.
    const errorIndicator = page
      .getByText(
        /(no availability|not available|worker.*not found|cannot assign|unavailable|error|invalid)/i,
      )
      .first();

    await expect(errorIndicator).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  // -------------------------------------------------------------------------
  // NEG-5 (Edge): Adding a worker with a very long name (200 chars) → no crash
  // -------------------------------------------------------------------------
  test('NEG-5: handles a 200-character worker name without crashing', async ({ page }) => {
    const longName = 'A'.repeat(200);

    await fillField(page, 'Worker name', longName);
    await fillField(page, 'Worker role', 'Barista');
    await fillField(page, 'Worker skills', 'espresso');

    await clickButton(page, 'Add worker');

    // The page must remain functional — no unhandled exception overlay.
    const crashIndicator = page.getByText(/unhandled.*error|something went wrong|application error/i).first();
    await expect(crashIndicator).not.toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // Accept either graceful truncation (value capped) or acceptance.
    // Both outcomes are valid; we assert at least one observable result:
    // either a validation message referencing the name length, or the
    // worker ID field being populated (accepted), or the name appearing
    // truncated in the list.
    const truncationOrAcceptance = page
      .getByText(/(too long|maximum.*characters|character limit|AAAA)/i)
      .first();

    const workerIdField = page.getByRole('textbox', { name: 'Worker ID', exact: true });
    const idPopulated = await workerIdField
      .inputValue()
      .then((v) => v.length > 0)
      .catch(() => false);

    const truncationVisible = await truncationOrAcceptance.isVisible().catch(() => false);

    // At least one of the two outcomes must be true.
    expect(idPopulated || truncationVisible).toBe(true);
  });

  // -------------------------------------------------------------------------
  // NEG-6 (Edge): Adding a duplicate worker name → either both appear or a
  //               helpful message is shown — assert one of these outcomes
  // -------------------------------------------------------------------------
  test('NEG-6: handles duplicate worker name gracefully', async ({ page }) => {
    const duplicateName = 'Duplicate Worker Omega';

    // Add the first worker.
    await fillField(page, 'Worker name', duplicateName);
    await fillField(page, 'Worker role', 'Barista');
    await fillField(page, 'Worker skills', 'latte art');
    await clickButton(page, 'Add worker');

    // Wait for any feedback from the first submission.
    await page.waitForTimeout(500);

    // Clear and submit the same name again.
    await fillField(page, 'Worker name', duplicateName);
    await fillField(page, 'Worker role', 'Barista');
    await fillField(page, 'Worker skills', 'latte art');
    await clickButton(page, 'Add worker');

    // Give the UI time to settle.
    await page.waitForLoadState('domcontentloaded');

    // Acceptable outcome A: a "duplicate" or "already exists" style message.
    const duplicateWarning = page
      .getByText(/(already exists|duplicate|worker.*exists|name.*taken)/i)
      .first();
    const warningVisible = await duplicateWarning.isVisible().catch(() => false);

    // Acceptable outcome B: the name appears at least once in the list
    // (both workers accepted, or at least one survived).
    const nameEntries = page.getByText(duplicateName);
    const entriesCount = await nameEntries.count().catch(() => 0);
    const appearsInList = entriesCount >= 1;

    // At least one of the two outcomes must be true.
    expect(warningVisible || appearsInList).toBe(true);
  });

  // -------------------------------------------------------------------------
  // NEG-7 (Edge): Template with identical start and end time → validation error
  //               or graceful handling without crash
  // -------------------------------------------------------------------------
  test('NEG-7: handles shift template with identical start and end time gracefully', async ({
    page,
  }) => {
    const templateSection = page.getByText(/shift template/i).first();
    await templateSection.scrollIntoViewIfNeeded();

    await fillField(page, 'Template name', 'Zero Duration Template');
    await fillField(page, 'Template role', 'Server');
    await fillField(page, 'Shift start time', '12:00');
    await fillField(page, 'Shift end time', '12:00'); // Same as start.
    await fillField(page, 'Required coverage', '1');

    await clickButton(page, 'Add template');

    // The page must remain functional — no unhandled exception overlay.
    const crashIndicator = page
      .getByText(/unhandled.*error|something went wrong|application error/i)
      .first();
    await expect(crashIndicator).not.toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // Acceptable outcome A: a validation message about invalid time range.
    const validationError = page
      .getByText(
        /(end time.*must be after|start.*end.*same|invalid.*time|time.*range|zero.*duration|cannot be equal)/i,
      )
      .first();
    const validationVisible = await validationError.isVisible().catch(() => false);

    // Acceptable outcome B: the template is still created (app allows it).
    const templateEntry = page.getByText(/Zero Duration Template/i).first();
    const templateVisible = await templateEntry.isVisible().catch(() => false);

    // Either a validation error was shown, or the template was accepted —
    // in both cases the app must not have crashed.
    expect(validationVisible || templateVisible).toBe(true);
  });

  // -------------------------------------------------------------------------
  // NEG-8 (State persistence): After adding a worker, refreshing the page →
  //         the worker list is empty (in-memory reset, known limitation)
  // -------------------------------------------------------------------------
  test('NEG-8: worker list resets to empty after page refresh (in-memory state)', async ({
    page,
  }) => {
    const uniqueName = 'Ephemeral Worker ' + Date.now();

    // Add a worker.
    await fillField(page, 'Worker name', uniqueName);
    await fillField(page, 'Worker role', 'Barista');
    await fillField(page, 'Worker skills', 'steaming');
    await clickButton(page, 'Add worker');

    // Confirm the worker appeared before refreshing.
    const workerIdField = page.getByRole('textbox', { name: 'Worker ID', exact: true });
    await expect(workerIdField).not.toHaveValue('', { timeout: VISIBLE_TIMEOUT });

    // Hard-reload the page to clear in-memory state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /scheduler/i }).waitFor({
      state: 'visible',
      timeout: NAV_TIMEOUT,
    });

    // After reload, the worker ID field should be blank again (no persistence).
    const workerIdAfterReload = page.getByRole('textbox', { name: 'Worker ID', exact: true });
    await workerIdAfterReload.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await expect(workerIdAfterReload).toHaveValue('');

    // The unique name must not appear anywhere in the page after reload.
    const workerEntry = page.getByText(uniqueName).first();
    await expect(workerEntry).not.toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  // -------------------------------------------------------------------------
  // NEG-9 (Status transition): Published shift → roster status badge shows
  //         "Published" text
  // -------------------------------------------------------------------------
  test('NEG-9: published shift shows "Published" status badge in the roster', async ({
    page,
  }) => {
    // Navigate to the shift assignment section.
    const rosterSection = page.getByText(/assign workers into templates/i).first();
    await rosterSection.scrollIntoViewIfNeeded();

    // Fill the date field — SECOND "Date" textbox on the page.
    const dateField = page.getByRole('textbox', { name: 'Date', exact: true }).nth(1);
    await dateField.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await dateField.clear();
    await dateField.fill('2026-06-15');

    // Attempt to assign a worker.
    const workerField = page.getByRole('textbox', { name: 'Worker', exact: true }).first();
    const workerVisible = await workerField.isVisible().catch(() => false);
    if (workerVisible) {
      await workerField.clear();
      await workerField.fill('Alice Chen');
    }

    await clickButton(page, 'Save and notify team');

    // Allow the roster to update.
    await page.waitForLoadState('domcontentloaded');

    // Look for a "Publish" button or "Published" status indicator in the roster.
    // If a separate publish action exists, click it.
    const publishButton = page.getByRole('button', { name: /publish/i }).first();
    const publishButtonVisible = await publishButton.isVisible().catch(() => false);
    if (publishButtonVisible) {
      await publishButton.click();
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    }

    // The roster must now display a "Published" badge or status label.
    const publishedBadge = page
      .getByText(/published/i)
      .first();

    await expect(publishedBadge).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });
});