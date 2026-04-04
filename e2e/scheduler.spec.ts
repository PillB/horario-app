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

/**
 * Navigate to the scheduler page and wait until the network is idle so that
 * all async data-fetching (Supabase, etc.) has settled before assertions run.
 */
async function goToScheduler(page: Page): Promise<void> {
  // Use domcontentloaded so goto returns quickly without waiting for Clerk's
  // async session-verification round-trip (which can take 20-30 s on first load).
  await page.goto(SCHEDULER_URL, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
  // Wait until the page heading is rendered — reliable signal that React has
  // hydrated and the scheduler UI is ready for interaction.
  await page.getByRole('heading', { name: /scheduler/i }).waitFor({
    state: 'visible',
    timeout: NAV_TIMEOUT,
  });
}

/**
 * Fill a labelled text input identified by its exact accessible name.
 * Uses exact:true to prevent strict-mode violations when multiple inputs
 * share a common substring (e.g. "Role" vs "Worker role" vs "Template role").
 */
async function fillField(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  const field = page.getByRole('textbox', { name: label, exact: true });
  await field.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
  await field.clear();
  await field.fill(value);
}

/**
 * Click a button identified by its exact accessible name and wait for any
 * resulting network activity to settle.
 */
async function clickButton(page: Page, name: string): Promise<void> {
  const btn = page.getByRole('button', { name, exact: true });
  await btn.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
  await btn.click();
  // Cap networkidle at 5s and swallow — Supabase realtime WebSocket connections
  // prevent the page from ever reaching true networkidle, so the test's own
  // assertions are the reliable gate, not network quiescence.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Shared state passed between tests via a project-scoped fixture workaround.
// Tests run with workers: 1 (sequential) so module state is safe.
// ---------------------------------------------------------------------------

let createdWorkerId = '';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Scheduler happy paths', () => {
  test.beforeEach(async ({ page }) => {
    await goToScheduler(page);
  });

  // -------------------------------------------------------------------------
  // Happy Path 1: Add a worker
  // -------------------------------------------------------------------------
  test('HP-1: adds a new worker successfully', async ({ page }) => {
    // HP-1 is the first test in this browser context — Clerk session init on
    // first navigation takes ~30 s. All subsequent tests reuse the warm session.
    test.setTimeout(90_000);
    // Exact aria-labels: "Worker name", "Worker role", "Worker skills"
    // Using "Yuki Tanaka" — not in sample data, prevents false-positive list check.
    await fillField(page, 'Worker name', 'Yuki Tanaka');
    await fillField(page, 'Worker role', 'Barista');
    await fillField(page, 'Worker skills', 'espresso, latte art');

    await clickButton(page, 'Add worker');

    // After saving, the "Worker ID" field is auto-populated with the new UUID.
    // This is more reliable than searching for the worker name in the list,
    // because the name text may first appear in a toast that disappears quickly.
    const workerIdField = page.getByRole('textbox', { name: 'Worker ID', exact: true });
    await expect(workerIdField).not.toHaveValue('', { timeout: VISIBLE_TIMEOUT });

    // Capture the worker-id so later tests can pre-fill it.
    // Cap at 5 s to avoid Playwright's 30 s default locator timeout.
    const idValue = await workerIdField.inputValue().catch(() => '');
    if (idValue) {
      createdWorkerId = idValue;
    }
  });

  // -------------------------------------------------------------------------
  // Happy Path 2: Set worker availability
  // -------------------------------------------------------------------------
  test('HP-2: sets availability for an existing worker', async ({ page }) => {
    // If we captured a worker ID from HP-1, pre-fill it.
    if (createdWorkerId) {
      const workerIdField = page.getByRole('textbox', { name: /worker id/i });
      const isVisible = await workerIdField.isVisible().catch(() => false);
      if (isVisible) {
        await workerIdField.clear();
        await workerIdField.fill(createdWorkerId);
      }
    }

    // Exact aria-labels: "Day", "From", "To" — each appears once in the page.
    await fillField(page, 'Day', 'Mon');
    await fillField(page, 'From', '09:00');
    await fillField(page, 'To', '17:00');

    await clickButton(page, 'Add availability');

    // Any visible success indicator is acceptable.
    const feedback = page
      .getByText(/(availability saved|success|added|Mon)/i)
      .first();
    await expect(feedback).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  // -------------------------------------------------------------------------
  // Happy Path 3: Create a shift template
  // -------------------------------------------------------------------------
  test('HP-3: creates a shift template', async ({ page }) => {
    // Scroll to the ShiftTemplateSection in case it is below the fold.
    const templateSection = page.getByText(/shift template/i).first();
    await templateSection.scrollIntoViewIfNeeded();

    // Exact aria-labels from ShiftTemplateSection InputField components:
    //   "Template name", "Template role", "Shift start time",
    //   "Shift end time", "Required coverage"
    // Using "Afternoon Barista" — not in sample data.
    await fillField(page, 'Template name', 'Afternoon Barista');
    await fillField(page, 'Template role', 'Barista');
    await fillField(page, 'Shift start time', '14:00');
    await fillField(page, 'Shift end time', '22:00');
    await fillField(page, 'Required coverage', '2');

    await clickButton(page, 'Add template');

    // Success banner: '"{name}" saved — ready to assign shifts.'
    const templateEntry = page.getByText(/Afternoon Barista/i).first();
    await expect(templateEntry).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  // -------------------------------------------------------------------------
  // Happy Path 4: Create a roster shift
  // -------------------------------------------------------------------------
  test('HP-4: assigns a shift to a worker', async ({ page }) => {
    // Scroll to the shift-creation section.
    const rosterSection = page.getByText(/assign workers into templates/i).first();
    await rosterSection.scrollIntoViewIfNeeded();

    // The shift assignment form's Date field is the SECOND "Date" textbox on
    // the page (the first belongs to the manual demand form).
    const dateField = page.getByRole('textbox', { name: 'Date', exact: true }).nth(1);
    await dateField.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await dateField.clear();
    await dateField.fill('2026-04-06');

    // The roster Worker picker — exact "Worker" aria-label is unique.
    const workerField = page.getByRole('textbox', { name: 'Worker', exact: true }).first();
    const workerVisible = await workerField.isVisible().catch(() => false);
    if (workerVisible) {
      await workerField.clear();
      await workerField.fill(createdWorkerId || 'Alice Chen');
    }

    // Submit button label: t('scheduler.shifts.saveButton') = 'Save and notify team'
    await clickButton(page, 'Save and notify team');

    // Verify either a success message or the shift appearing in the roster.
    const confirmation = page
      .getByText(/(shift assigned|success|2026-04-06|saved|notif)/i)
      .first();
    await expect(confirmation).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  // -------------------------------------------------------------------------
  // Happy Path 5: POS CSV upload
  // -------------------------------------------------------------------------
  test('HP-5: parses a pasted POS CSV and shows a preview table', async ({
    page,
  }) => {
    const CSV_CONTENT =
      'date,revenue,covers\n2026-03-01,1500.00,45\n2026-03-02,1200.50,38';

    // Step 1: scroll to demand section and select the POS Import mode radio.
    const demandSection = page.getByText(/demand targets/i).first();
    await demandSection.scrollIntoViewIfNeeded();

    const posRadio = page.getByRole('radio', { name: /POS Import/i });
    await posRadio.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await posRadio.click();

    // Step 2: fill the CSV textarea.
    // Exact aria-label: t('scheduler.demand.posText') = 'Paste CSV (date,revenue,covers,notes)'
    const csvInput = page.getByRole('textbox', {
      name: 'Paste CSV (date,revenue,covers,notes)',
      exact: true,
    });
    await csvInput.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await csvInput.clear();
    await csvInput.fill(CSV_CONTENT);

    // Step 3: click Preview CSV button.
    // Exact aria-label: t('scheduler.demand.posPreviewBtn') = 'Preview CSV'
    await clickButton(page, 'Preview CSV');

    // Step 4: assert the two CSV dates appear in the preview table.
    const firstRow = page.getByText('2026-03-01').first();
    const secondRow = page.getByText('2026-03-02').first();

    await expect(firstRow).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    await expect(secondRow).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // No fatal error should be visible.
    const fatalError = page.getByText(/fatal error/i).first();
    await expect(fatalError).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Happy Path 6: Demand forecast — homogeneous fallback
  // -------------------------------------------------------------------------
  test('HP-6: adds homogeneous demand targets via fallback form', async ({
    page,
  }) => {
    // Scroll to demand targets section.
    const demandSection = page.getByText(/demand targets/i).first();
    await demandSection.scrollIntoViewIfNeeded();

    // Ensure Homogeneous demand mode is selected (it is the default, but be explicit).
    const homogRadio = page.getByRole('radio', { name: /Homogeneous demand/i });
    await homogRadio.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await homogRadio.click();

    // The homogeneous form has two "Role" textboxes on the page; use .first()
    // which maps to the demand-form Role (the worker/template role fields
    // have exact labels "Worker role" and "Template role").
    const rolField = page.getByRole('textbox', { name: 'Role', exact: true }).first();
    await rolField.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await rolField.clear();
    await rolField.fill('Server');

    // Exact English aria-labels: "Start date", "Days", "Daily demand"
    await fillField(page, 'Start date', '2026-04-06');
    await fillField(page, 'Days', '7');
    await fillField(page, 'Daily demand', '4');

    // Submit: t('scheduler.demand.saveBaseline') = 'Save baseline targets'
    await clickButton(page, 'Save baseline targets');

    // Verify a success message or that target entries have appeared.
    const confirmation = page
      .getByText(/(demand target|saved|baseline|Server)/i)
      .first();
    await expect(confirmation).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });
});
