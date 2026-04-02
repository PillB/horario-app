/**
 * tour-and-home.spec.ts — E2E validation for:
 *   - Interactive tour guide (auto-start, role selection, navigation, interactive steps)
 *   - Home screen (week stats, invite modal, month calendar toggle)
 *   - Manager happy path through the tour
 *   - Worker happy path through the tour
 *
 * Iteration 1: discover issues and validate core flows
 * Iteration 2: regression test after fixes
 */

import { test, expect, Page } from '@playwright/test';

const HOME_URL = 'http://localhost:8081';
const SCHEDULER_URL = 'http://localhost:8081/(tabs)/scheduler';
const NAV_TIMEOUT = 30_000;
const VISIBLE_TIMEOUT = 12_000;
const SHORT_TIMEOUT = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clear all local storage to simulate a brand-new first-time user. */
async function clearStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    try { window.localStorage.clear(); } catch { /* web-only */ }
  });
}

/** Navigate to home and wait for content to settle. */
async function goHome(page: Page): Promise<void> {
  await page.goto(HOME_URL, { timeout: NAV_TIMEOUT });
  await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });
}

/** Navigate to home after clearing storage (fresh user simulation). */
async function goHomeFresh(page: Page): Promise<void> {
  await goHome(page);
  await clearStorage(page);
  await page.reload({ timeout: NAV_TIMEOUT });
  await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });
}

/** Click anything that looks like the Skip tour button. */
async function skipTourIfVisible(page: Page): Promise<void> {
  const skipBtn = page.getByText(/skip tour/i).first();
  const isVisible = await skipBtn.isVisible().catch(() => false);
  if (isVisible) await skipBtn.click().catch(() => undefined);
}

/** Click a button by accessible name (case-insensitive, partial). */
async function clickBtn(page: Page, nameRe: RegExp | string, timeout = VISIBLE_TIMEOUT): Promise<void> {
  const btn = typeof nameRe === 'string'
    ? page.getByRole('button', { name: nameRe })
    : page.getByRole('button', { name: nameRe });
  await btn.first().waitFor({ state: 'visible', timeout });
  await btn.first().click();
}

// ---------------------------------------------------------------------------
// Tour auto-start
// ---------------------------------------------------------------------------

test.describe('Tour — auto-start on first launch', () => {
  test('TT-1: tour role-selection appears for a fresh user', async ({ page }) => {
    // Simulate a fresh install by clearing storage before loading
    await goHome(page);
    await clearStorage(page);
    await page.reload({ timeout: NAV_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });

    // The role-selection modal should appear automatically
    // It shows "Who are you?" or "¿Quién eres?" or the equivalent
    const roleModal = page.getByText(/who are you|quién eres|wer bist du/i).first();
    await expect(roleModal).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  test('TT-2: tour does NOT auto-start for a returning user', async ({ page }) => {
    // Set tourSeen flag to simulate a returning user
    await goHome(page);
    await page.evaluate(() => {
      try {
        window.localStorage.setItem('horario.tourSeen', '1');
        window.localStorage.setItem('horario.tour', JSON.stringify({ hasCompleted: false }));
      } catch { /* web */ }
    });
    await page.reload({ timeout: NAV_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });

    // The tour modal should NOT be visible
    const roleModal = page.getByText(/who are you|quién eres/i).first();
    await expect(roleModal).not.toBeVisible({ timeout: SHORT_TIMEOUT });
  });
});

// ---------------------------------------------------------------------------
// Manager tour flow
// ---------------------------------------------------------------------------

test.describe('Tour — Manager happy path', () => {
  test.beforeEach(async ({ page }) => {
    await goHomeFresh(page);
  });

  test('TT-3: manager selects role and sees step 1', async ({ page }) => {
    // Wait for role selection
    await expect(page.getByText(/who are you|quién eres/i).first())
      .toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // Click Manager / Owner role button
    const managerBtn = page
      .getByRole('button', { name: /manager|owner|gestor|propietario/i })
      .first();
    await managerBtn.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await managerBtn.click();

    // Step 1 should appear: "Welcome to Your Command Centre" or equivalent
    const step1Text = page.getByText(/command centre|centro de operaciones|willkommen/i).first();
    await expect(step1Text).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  test('TT-4: manager can navigate forward and backward through tour', async ({ page }) => {
    // Select manager role
    await page.getByText(/who are you|quién eres/i).first()
      .waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await page.getByRole('button', { name: /manager|owner|gestor/i }).first().click();

    // Step 1 should be visible
    await page.getByText(/command centre|centro|command/i).first()
      .waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });

    // Click Next → to go to step 2
    await clickBtn(page, /next|siguiente|weiter/i);
    const step2Text = page.getByText(/scheduling streak|serie|streak/i).first();
    await expect(step2Text).toBeVisible({ timeout: VISIBLE_TIMEOUT });

    // Click Back ← to return to step 1
    await clickBtn(page, /back|anterior|zurück/i);
    const step1Again = page.getByText(/command centre|centro|command/i).first();
    await expect(step1Again).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  test('TT-5: manager can skip tour', async ({ page }) => {
    // Select manager role
    await page.getByText(/who are you|quién eres/i).first()
      .waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await page.getByRole('button', { name: /manager|owner|gestor/i }).first().click();

    // Click Skip tour
    await clickBtn(page, /skip tour|omitir|überspringen/i);

    // Tour should be dismissed — no tour card visible
    const tourCard = page.getByText(/command centre|scheduling streak/i).first();
    await expect(tourCard).not.toBeVisible({ timeout: SHORT_TIMEOUT });
  });

  test('TT-6: progress bar is visible during tour', async ({ page }) => {
    // Select manager role
    await page.getByText(/who are you|quién eres/i).first()
      .waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await page.getByRole('button', { name: /manager|owner|gestor/i }).first().click();

    // The step counter "Step 1 of 8" or "Paso 1 de 8" should be visible
    const stepCounter = page.getByText(/step \d+ of \d+|paso \d+ de \d+|schritt \d+ von \d+/i).first();
    await expect(stepCounter).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });
});

// ---------------------------------------------------------------------------
// Worker tour flow
// ---------------------------------------------------------------------------

test.describe('Tour — Worker happy path', () => {
  test.beforeEach(async ({ page }) => {
    await goHomeFresh(page);
  });

  test('TT-7: worker selects role and sees step 1', async ({ page }) => {
    // Wait for role selection
    await page.getByText(/who are you|quién eres/i).first()
      .waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });

    // Click Team Member / Worker role
    const workerBtn = page
      .getByRole('button', { name: /team member|worker|trabajador|mitarbeiter|membre/i })
      .first();
    await workerBtn.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await workerBtn.click();

    // Worker step 1: "Welcome to Your Schedule Hub"
    const step1Text = page.getByText(/schedule hub|horario|hub/i).first();
    await expect(step1Text).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  test('TT-8: worker tour has 5 steps (fewer than manager\'s 8)', async ({ page }) => {
    // Select worker role
    await page.getByText(/who are you|quién eres/i).first()
      .waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await page.getByRole('button', { name: /team member|worker|trabajador/i }).first().click();

    // Should show "Step 1 of 5" for worker (vs "Step 1 of 8" for manager)
    const step1of5 = page.getByText(/1 of 5|1 de 5|1 von 5/i).first();
    await expect(step1of5).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });
});

// ---------------------------------------------------------------------------
// Home screen — week stats + invite button
// ---------------------------------------------------------------------------

test.describe('Home screen', () => {
  test.beforeEach(async ({ page }) => {
    await goHome(page);
    // Ensure tour is skipped for these tests
    await page.evaluate(() => {
      try {
        window.localStorage.setItem('horario.tourSeen', '1');
        window.localStorage.setItem('horario.tour', JSON.stringify({ hasCompleted: true }));
      } catch { /* web */ }
    });
    await page.reload({ timeout: NAV_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });
  });

  test('TT-9: home screen renders week stats strip', async ({ page }) => {
    // Should show "This week" or equivalent section
    const weekStatsTitle = page.getByText(/this week|esta semana|diese woche|semaine/i).first();
    await expect(weekStatsTitle).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  test('TT-10: invite CTA section is visible on home screen', async ({ page }) => {
    // Should show "Build your team" or equivalent
    const inviteTitle = page.getByText(/build your team|forma tu equipo|team einladen/i).first();
    await expect(inviteTitle).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  test('TT-11: invite button opens the team invite modal', async ({ page }) => {
    // Find and click the invite CTA button
    const inviteBtn = page.getByRole('button', { name: /invite a team member|invitar|einladen/i }).first();
    await inviteBtn.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await inviteBtn.click();

    // The invite modal should appear with an invite code or input
    const modalContent = page.getByText(/invite code|código de invitación|einladungscode/i).first();
    await expect(modalContent).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });
});

// ---------------------------------------------------------------------------
// Scheduler — month calendar view
// ---------------------------------------------------------------------------

test.describe('Scheduler — month calendar view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SCHEDULER_URL, { timeout: NAV_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });
    // Skip tour
    await skipTourIfVisible(page);
  });

  test('TT-12: month view toggle button is visible in calendar', async ({ page }) => {
    // The WeekCalendar component should have a Month / Week toggle
    const monthToggle = page.getByRole('button', { name: /month|mes|monat|mois/i }).first();
    await expect(monthToggle).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  test('TT-13: clicking month toggle switches to month grid view', async ({ page }) => {
    const monthToggle = page.getByRole('button', { name: /month|mes|monat/i }).first();
    await monthToggle.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await monthToggle.click();

    // Month view should show day-of-week column headers (Mon-Sun or equivalent)
    // and the current month name
    const monthIndicator = page.getByText(/january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i).first();
    await expect(monthIndicator).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  test('TT-14: can switch back to week view from month view', async ({ page }) => {
    // Switch to month view first
    const monthToggle = page.getByRole('button', { name: /month|mes|monat/i }).first();
    await monthToggle.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await monthToggle.click();

    // Now click the week toggle
    const weekToggle = page.getByRole('button', { name: /week|semana|woche|semaine/i }).first();
    await weekToggle.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await weekToggle.click();

    // Week view should be active again - verify by looking for "no shifts this week" or shift columns
    const weekIndicator = page.getByText(/(week of|previous week|next week|semana|woche)/i).first();
    await expect(weekIndicator).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });
});

// ---------------------------------------------------------------------------
// Scheduler — HP-1 through HP-4 with locale guard
// ---------------------------------------------------------------------------

test.describe('Scheduler happy paths (locale-guarded)', () => {
  let capturedWorkerId = '';

  test.beforeEach(async ({ page }) => {
    await page.goto(SCHEDULER_URL, { timeout: NAV_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });
    await skipTourIfVisible(page);
  });

  test('HP1-guarded: adds a worker successfully', async ({ page }) => {
    // Use accessible name patterns that work in en/es/de
    const nameField = page.getByRole('textbox', { name: /name/i }).first();
    await nameField.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await nameField.clear();
    await nameField.fill('Bob Martinez');

    // Role field — multiple Role fields exist; first is the Worker form
    const roleFields = page.getByRole('textbox', { name: /role|rol|rolle|rôle/i });
    await roleFields.first().clear();
    await roleFields.first().fill('Barista');

    // Submit
    const addWorkerBtn = page.getByRole('button', { name: /add worker|agregar trabajador|mitarbeiter hinzufügen/i }).first();
    await addWorkerBtn.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await addWorkerBtn.click();

    // Success message should contain worker name
    await expect(page.getByText(/Bob Martinez/i).first()).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });

  test('HP2-guarded: sets availability for a worker', async ({ page }) => {
    const dayField = page.getByRole('textbox', { name: /day|día|tag|jour/i }).first();
    await dayField.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await dayField.clear();
    await dayField.fill('Tue');

    const fromField = page.getByRole('textbox', { name: /from|desde|von|de/i }).first();
    await fromField.clear();
    await fromField.fill('08:00');

    const toField = page.getByRole('textbox', { name: /to|hasta|bis|à/i }).first();
    await toField.clear();
    await toField.fill('16:00');

    const addAvailBtn = page.getByRole('button', { name: /add availability|agregar disponibilidad|verfügbarkeit/i }).first();
    await addAvailBtn.waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT });
    await addAvailBtn.click();

    // Should show some success or the word "Tue" confirmation
    const feedback = page.getByText(/(availability|disponibilidad|verfügbarkeit|saved|guardado|Tue)/i).first();
    await expect(feedback).toBeVisible({ timeout: VISIBLE_TIMEOUT });
  });
});
