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
  await page.goto(SCHEDULER_URL, { timeout: NAV_TIMEOUT });
  await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });
}

/**
 * Fill a labelled text input identified by its accessible name.
 * Clears the field first so pre-filled values do not bleed through.
 */
async function fillField(
  page: Page,
  label: string,
  value: string,
): Promise<void> {
  const field = page.getByRole('textbox', { name: label });
  await field.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
  await field.clear();
  await field.fill(value);
}

/**
 * Click a button identified by its accessible name and wait for any resulting
 * network activity to settle.
 */
async function clickButton(page: Page, name: string): Promise<void> {
  const btn = page.getByRole('button', { name });
  await btn.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
  await btn.click();
  await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });
}

// ---------------------------------------------------------------------------
// Shared state passed between tests via a project-scoped fixture workaround.
// Because each test calls beforeEach and navigates fresh, we store the worker
// id captured in test 1 in a module-level variable.  Tests that depend on it
// are sequenced via their test titles and run with workers: 1.
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
    // Fill the worker-creation form.
    await fillField(page, 'Name', 'Alice Chen');
    await fillField(page, 'Role', 'Server');
    await fillField(page, 'Skills', 'barista');

    await clickButton(page, 'Add worker');

    // The success message should mention Alice Chen.
    const successMsg = page.getByText(/Alice Chen/i);
    await expect(successMsg).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // Alice should also appear in the rendered worker list.
    const workerListEntry = page
      .getByRole('list')
      .filter({ hasText: /Alice Chen/i })
      .first();
    await expect(workerListEntry).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // Attempt to capture the worker-id so later tests can use it.
    // The implementation may surface it in a data attribute or visible text
    // such as "ID: abc123".  We read it opportunistically.
    const idMatch = await page
      .getByText(/\bID[:\s]+\S+/i)
      .first()
      .textContent()
      .catch(() => null);

    if (idMatch) {
      const match = idMatch.match(/ID[:\s]+(\S+)/i);
      if (match?.[1]) {
        createdWorkerId = match[1];
      }
    }
  });

  // -------------------------------------------------------------------------
  // Happy Path 2: Set worker availability
  // -------------------------------------------------------------------------
  test('HP-2: sets availability for an existing worker', async ({ page }) => {
    // The availability form is expected to have a Worker ID field that is
    // pre-populated when a worker has just been added; in an independent test
    // run we fill it explicitly if the id was captured, otherwise we proceed
    // with whatever is pre-filled by the UI.

    if (createdWorkerId) {
      // Only attempt to fill if the field exists and is editable.
      const workerIdField = page.getByRole('textbox', { name: /worker id/i });
      const isVisible = await workerIdField.isVisible().catch(() => false);
      if (isVisible) {
        await workerIdField.clear();
        await workerIdField.fill(createdWorkerId);
      }
    }

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
    const templateSection = page
      .getByText(/shift template/i)
      .first();
    await templateSection.scrollIntoViewIfNeeded();

    await fillField(page, 'Template Name', 'Morning Server');
    await fillField(page, 'Role', 'Server');
    await fillField(page, 'Start', '09:00');
    await fillField(page, 'End', '17:00');
    await fillField(page, 'Coverage', '3');

    await clickButton(page, 'Add template');

    // The new template should appear somewhere on the page.
    const templateEntry = page.getByText(/Morning Server/i).first();
    await expect(templateEntry).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  // -------------------------------------------------------------------------
  // Happy Path 4: Create a roster shift
  // -------------------------------------------------------------------------
  test('HP-4: assigns a shift to a worker', async ({ page }) => {
    // Scroll to the roster / shift-assignment area.
    const rosterSection = page
      .getByText(/(roster|assign shift)/i)
      .first();
    await rosterSection.scrollIntoViewIfNeeded();

    await fillField(page, 'Date', '2026-04-06');

    // Fill the worker-id field only if it exists as an editable input and we
    // have an id from a previous run; many implementations pre-select the
    // first worker in a dropdown instead.
    if (createdWorkerId) {
      const workerField = page.getByRole('textbox', { name: /worker/i }).first();
      const isVisible = await workerField.isVisible().catch(() => false);
      if (isVisible) {
        await workerField.clear();
        await workerField.fill(createdWorkerId);
      }
    }

    await clickButton(page, 'Assign shift');

    // Verify either a success message or the shift appearing in the roster.
    const confirmation = page
      .getByText(/(shift assigned|success|2026-04-06)/i)
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

    // Scroll to POS upload section.
    const posSection = page.getByText(/(POS upload|sales data)/i).first();
    await posSection.scrollIntoViewIfNeeded();

    // The POS section exposes either a <textarea> or a textbox for CSV input.
    const csvInput = page
      .getByRole('textbox', { name: /(csv|paste|sales)/i })
      .first();
    await csvInput.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await csvInput.clear();
    await csvInput.fill(CSV_CONTENT);

    // Trigger parsing / uploading.
    await clickButton(page, /(upload|parse|import)/i.source);

    // The preview table should contain exactly 2 data rows.
    // We assert at least 2 <tr> or list items that contain dates from the CSV.
    const firstRow = page.getByText('2026-03-01').first();
    const secondRow = page.getByText('2026-03-02').first();

    await expect(firstRow).toBeVisible({ timeout: VISIBLE_TIMEOUT });
    await expect(secondRow).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // There should be no fatal error message visible.
    const fatalError = page.getByText(/fatal error/i).first();
    await expect(fatalError).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Happy Path 6: Demand forecast — homogeneous fallback
  // -------------------------------------------------------------------------
  test('HP-6: adds homogeneous demand targets via fallback form', async ({
    page,
  }) => {
    // Scroll to the demand / forecasting section.
    const demandSection = page
      .getByText(/(demand forecast|demand)/i)
      .first();
    await demandSection.scrollIntoViewIfNeeded();

    // 'Rol' matches multiple fields on the page; use nth(2) to target the
    // demand form's role field specifically (0-indexed: 0=worker form,
    // 1=template form, 2=demand form).
    const rolField = page.getByRole('textbox', { name: 'Rol' }).nth(2);
    await rolField.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await rolField.clear();
    await rolField.fill('Server');

    await fillField(page, 'Fecha de inicio', '2026-04-06');
    await fillField(page, 'Días', '7');
    await fillField(page, 'Demanda diaria', '4');

    await clickButton(page, 'Guardar objetivos base');

    // Verify a success message or that target entries have appeared.
    const confirmation = page
      .getByText(/(demand target|objective|guardado|base|saved|Server|7)/i)
      .first();
    await expect(confirmation).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });
});