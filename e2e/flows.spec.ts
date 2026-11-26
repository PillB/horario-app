/**
 * Browser flow simulation across tabs (CHG-109).
 *
 * One owner ("Rosa", a Lima restaurant) uses the app like a person would: one
 * browser session that moves between the tabs with the tab bar, never a fresh
 * page load. After every step every tab is visited and what it shows is
 * compared with the database (the source of truth) and with the other tabs:
 * people, shifts, published shifts, staffing gaps, locations, plan and the
 * auto-schedule count.
 *
 * Opt-in (HORARIO_FLOW_SIM=1). Needs a dedicated tenant: HORARIO_DEV_ACCOUNT_ID in .env.local must be an
 * account no other run uses (e.g. sim-<random>), because the flow checks
 * account-wide totals, ends the trial and moves the month of the usage count
 * with psql (DB_URL in the environment or .env.local). It never touches other rows.
 *
 * Tests that fail today because of a real defect carry `// BUG: F-n` (see the
 * findings report of CHG-109). Coherence checks are soft, so one test reports
 * every mismatch of a step, not only the first.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { expect, test, type Page } from '@playwright/test';

import { proxyResponse } from './helpers';

// ─── Tenant and database ─────────────────────────────────────────────────────

const readEnv = (): Record<string, string> => {
  const file = path.join(process.cwd(), '.env.local');
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && !line.trim().startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
};
const ENV = readEnv();
const ACCOUNT = ENV.HORARIO_DEV_ACCOUNT_ID ?? '';
/** Names unique to this tenant; stable when Playwright restarts the worker after a failed test. */
const RUN = ACCOUNT.slice(-4);
/** The local Supabase database (`npx supabase status -o env` prints it as DB_URL); from the environment or .env.local. */
const DB_URL = process.env.DB_URL ?? ENV.DB_URL ?? '';
const TZ = 'America/Lima';

/** One value from the database; the account id is checked, never interpolated from input. */
const sql = (query: string): string =>
  execFileSync('psql', [DB_URL, '-tAX', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf-8' }).trim();
const num = (query: string) => Number(sql(query) || '0');
const acc = () => `'${ACCOUNT}'`;

const dateKey = (offsetDays = 0): string => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
/** Monday of the ISO week that holds `key`, as YYYY-MM-DD. */
const mondayOf = (key: string): string => {
  const d = new Date(`${key}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
};
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** What the database holds for this account: the numbers every tab should agree with. */
const truth = () => {
  const today = dateKey(0);
  const in7 = dateKey(7);
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  return {
    workers: num(`select count(*) from workers where account_id=${acc()}`),
    templates: num(`select count(*) from shift_templates where account_id=${acc()}`),
    rosterAll: num(`select count(*) from roster where account_id=${acc()}`),
    draftsAll: num(`select count(*) from roster where account_id=${acc()} and status='Draft'`),
    publishedAll: num(`select count(*) from roster where account_id=${acc()} and status='Published'`),
    // Home's "This week": today .. today + 7 (useLiveRosterSummary).
    homeWindow: num(`select count(*) from roster where account_id=${acc()} and date between '${today}' and '${in7}'`),
    // Analytics' "This week" and the compliance week: ISO Monday .. Sunday.
    isoWeek: num(`select count(*) from roster where account_id=${acc()} and date between '${monday}' and '${sunday}'`),
    locations: num(`select count(*) from locations where account_id=${acc()}`),
    overrides: num(`select count(*) from demand_targets where account_id=${acc()} and source='override'`),
    autoRuns: num(`select coalesce(sum(auto_assign_month_count),0) from usage_limits where account_id=${acc()} and auto_assign_month=to_char(now() at time zone 'utc','YYYY-MM')`),
    trialActive: num(`select count(*) from account_entitlements where account_id=${acc()} and source='trial' and revoked_at is null and (ends_at is null or ends_at>now())`) > 0,
  };
};
type Truth = ReturnType<typeof truth>;

// ─── Screens ─────────────────────────────────────────────────────────────────

const SHOTS = path.join(process.cwd(), 'sim-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

type Tab = 'Home' | 'Scheduler' | 'Analytics' | 'Profile';

/** Moves with the tab bar, the way a person does: the other tabs stay mounted. */
const goTab = async (page: Page, tab: Tab) => {
  // The tab's accessible name starts with its icon glyph.
  const link = page.getByRole('tablist').getByRole('tab', { name: new RegExp(`${tab}$`) }).first();
  await link.click();
  await expect(link).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(800);
};

const goStep = async (page: Page, step: 'workers' | 'templates' | 'forecast' | 'shifts') => {
  const schedulerTab = page.getByRole('tablist').getByRole('tab', { name: /Scheduler$/ }).first();
  if ((await schedulerTab.getAttribute('aria-selected')) !== 'true') await goTab(page, 'Scheduler');
  const tab = page.getByTestId(`section-tab-${step}`);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
};

const text = async (page: Page) => (await page.locator('body').innerText()).replace(/ /g, ' ');

/** Visible text of the screen that is in front (tabs stay mounted, so only the focused one). */
const screenText = async (page: Page) => {
  const own = await page.evaluate(() => {
    // Mounted tabs are siblings next to the tab bar; the focused one is under the middle of the viewport.
    const tablist = document.querySelector('[role="tablist"]');
    const hit = document.elementFromPoint(window.innerWidth / 2, Math.min(200, window.innerHeight / 3));
    let screens: Element | null = hit;
    while (screens?.parentElement && tablist && !screens.parentElement.contains(tablist)) screens = screens.parentElement;
    const screen = screens && hit ? Array.from(screens.children).find((s) => s.contains(hit)) : null;
    return screen ? (screen as HTMLElement).innerText : null;
  });
  return (own ?? (await text(page))).replace(/ /g, ' ');
};

type Seen = {
  home: { scheduled: number | null; gaps: number | null; checklist: boolean; locationCard: boolean; upcoming: number; raw: string };
  scheduler: { team: number; templates: number; roster: number; banner: string; rosterRows: number; raw: string };
  analytics: { drafts: number | null; published: number | null; coverage: string; hoursBars: number; raw: string };
  profile: { plan: string; people: string; locations: string; runs: string; locationRows: number; raw: string };
};

const kpiAfter = (raw: string, label: string): number | null => {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const i = lines.indexOf(label);
  return i > 0 && /^\d+$/.test(lines[i - 1]) ? Number(lines[i - 1]) : null;
};

const readHome = async (page: Page): Promise<Seen['home']> => {
  await goTab(page, 'Home');
  await expect(page.getByText('Shifts scheduled').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
  const raw = await screenText(page);
  return {
    scheduled: kpiAfter(raw, 'Shifts scheduled'),
    gaps: kpiAfter(raw, 'Roles to fill'),
    checklist: raw.includes('Get started fast'),
    locationCard: (await page.getByTestId('location-setup-card').filter({ visible: true }).count()) > 0,
    upcoming: (raw.split('Upcoming shifts')[1] ?? '').split('Staffing gaps')[0].split('•').length - 1,
    raw,
  };
};

const stepCount = async (page: Page, step: string) => {
  const label = await page.getByTestId(`section-tab-${step}`).innerText();
  const m = label.match(/·\s*(\d+)/);
  return m ? Number(m[1]) : 0;
};

const readScheduler = async (page: Page): Promise<Seen['scheduler']> => {
  await goStep(page, 'shifts');
  await page.waitForTimeout(500);
  const raw = await screenText(page);
  const banner = raw.includes('Pro trial is on') ? 'trial'
    : raw.includes("You've used this month's free auto-filled week") ? 'limit'
      : (raw.match(/(\d+) free auto-filled week/)?.[0] ?? 'none');
  return {
    team: await stepCount(page, 'workers'),
    templates: await stepCount(page, 'templates'),
    roster: await stepCount(page, 'shifts'),
    banner,
    rosterRows: await page.locator('[data-testid^="remove-shift-"]').filter({ visible: true }).count(),
    raw,
  };
};

const readAnalytics = async (page: Page): Promise<Seen['analytics']> => {
  await goTab(page, 'Analytics');
  await page.getByTestId('analytics-period-all').click();
  await expect(page.getByTestId('analytics-draft-shifts')).toBeVisible({ timeout: 60_000 });
  const raw = await screenText(page);
  const drafts = kpiAfter(raw, 'Drafts pending');
  const published = raw.match(/\((\d+) published shifts\)/);
  return {
    drafts,
    published: published ? Number(published[1]) : null,
    coverage: (await page.getByTestId('analytics-coverage-rate').innerText()).split('\n')[0],
    hoursBars: await page.locator('[data-testid^="hours-bar-"]').count(),
    raw,
  };
};

const readProfile = async (page: Page): Promise<Seen['profile']> => {
  await goTab(page, 'Profile');
  await expect(page.getByText(/People: /).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
  const raw = await screenText(page);
  const usage = raw.match(/People: (.+?) · Locations: (.+?) · Auto-schedules this month: (.+)/);
  const plan = raw.includes('Pro trial:') ? 'trial' : raw.includes('Up to 10 people, 1 location') ? 'gratis' : 'other';
  return {
    plan,
    people: usage?.[1]?.trim() ?? '?',
    locations: usage?.[2]?.trim() ?? '?',
    runs: usage?.[3]?.trim() ?? '?',
    locationRows: raw.includes('No locations yet.') ? 0 : (raw.match(/Edit location|Edit /g) ?? []).length,
    raw,
  };
};

/** Visits every tab, in the order a person would after a change, and returns what each showed. */
const tour = async (page: Page, label: string): Promise<Seen> => {
  const home = await readHome(page);
  await shot(page, `${label}-home`);
  const scheduler = await readScheduler(page);
  await shot(page, `${label}-scheduler`);
  const analytics = await readAnalytics(page);
  await shot(page, `${label}-analytics`);
  const profile = await readProfile(page);
  await shot(page, `${label}-profile`);
  const seen = { home, scheduler, analytics, profile };
  const t = truth();
  const strip = (s: Seen) => ({
    home: { ...s.home, raw: undefined }, scheduler: { ...s.scheduler, raw: undefined },
    analytics: { ...s.analytics, raw: undefined }, profile: { ...s.profile, raw: undefined },
  });
  fs.appendFileSync(path.join(SHOTS, 'observations.jsonl'), `${JSON.stringify({ label, at: new Date().toISOString(), truth: t, seen: strip(seen) })}\n`);
  return seen;
};

const of = (used: number, max: number | null) => (max === null ? String(used) : `${used} / ${max}`);

/** The cross-tab rules that must hold after any step. */
const expectCoherent = (seen: Seen, t: Truth, plan: 'trial' | 'gratis', note = '') => {
  const max = plan === 'gratis' ? { people: 10, locations: 1, runs: 1 } : { people: null, locations: null, runs: null };
  const where = (s: string) => `${s}${note ? ` (${note})` : ''}`;
  expect.soft(seen.scheduler.team, where('Scheduler team count = workers in the database')).toBe(t.workers);
  expect.soft(seen.scheduler.templates, where('Scheduler templates count = templates in the database')).toBe(t.templates);
  expect.soft(seen.scheduler.roster, where('Scheduler roster count = shifts in the database')).toBe(t.rosterAll);
  expect.soft(seen.home.scheduled, where('Home "Shifts scheduled" = shifts in its 7-day window')).toBe(t.homeWindow);
  expect.soft(seen.analytics.drafts, where('Analytics drafts (all dates) = drafts in the database')).toBe(t.draftsAll);
  expect.soft(seen.analytics.published, where('Analytics published (all dates) = published in the database')).toBe(t.publishedAll);
  expect.soft(seen.profile.people, where('Profile people = workers in the database')).toBe(of(t.workers, max.people));
  expect.soft(seen.profile.locations, where('Profile locations = locations in the database')).toBe(of(t.locations, max.locations));
  expect.soft(seen.profile.runs, where('Profile auto-schedules = runs counted this month')).toBe(of(t.autoRuns, max.runs));
  expect.soft(seen.profile.plan, where('Profile plan')).toBe(plan);
  expect.soft(seen.home.locationCard, where('Home location card shows only while no location exists')).toBe(t.locations === 0);
  const banner = plan === 'trial' ? 'trial' : t.autoRuns >= 1 ? 'limit' : '1 free auto-filled week';
  expect.soft(seen.scheduler.banner, where('Scheduler plan banner matches the plan and count')).toBe(banner);
};

// ─── People and rows of this run ─────────────────────────────────────────────

const COOK = `Cocina ${RUN}`;
const WAIT = `Mozo ${RUN}`;
const BY_HAND = ['Rosa', 'Jorge', 'Lucia', 'Pedro', 'Carmen', 'Luis'].map((n) => `${n} ${RUN}`);
const CSV_PEOPLE = ['Ana', 'Beto', 'Celia', 'Dario', 'Elena', 'Fito', 'Gaby', 'Hugo'].map((n) => `${n} ${RUN}`);
const ROLE_OF = (i: number) => (i % 2 === 0 ? COOK : WAIT);
const T_MORNING = `Manana ${RUN}`;
const T_EVENING = `Tarde ${RUN}`;
const T_NIGHT = `Noche ${RUN}`;
const T_SPLIT = `Partido ${RUN}`;

let page: Page;

/*
 * The tests run in file order on one worker and build on each other's rows.
 * They are not `serial`: in serial mode the first known bug (a soft
 * coherence failure) would skip every later step. Each test opens the app,
 * visits every tab once so all four stay mounted (as for a person who has been
 * using the app), does its step, then visits every tab again.
 */
test.use({ timezoneId: TZ, viewport: { width: 1280, height: 900 } });

// Opt-in: it ends the trial and moves the usage month of its tenant, so it never runs in CI's shared tenant.
test.skip(process.env.HORARIO_FLOW_SIM !== '1', 'Set HORARIO_FLOW_SIM=1 with a fresh HORARIO_DEV_ACCOUNT_ID to run the flow simulation');

test.beforeAll(() => {
  expect(ACCOUNT, 'set HORARIO_DEV_ACCOUNT_ID in .env.local to a tenant only this run uses').toMatch(/^sim-/);
  expect(DB_URL, 'set DB_URL (the local Supabase database) in the environment or .env.local').not.toBe('');
});

test.beforeEach(async ({ page: p }) => {
  // A step saves many rows one form at a time and then visits four tabs.
  test.setTimeout(600_000);
  page = p;
  await page.addInitScript(() => {
    try { window.localStorage.setItem('horario.tourSeen', '1'); } catch { /* blocked */ }
  });
});

/** Opens the app and mounts every tab, so later visits are tab switches, not page loads. */
const startSession = async () => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Shifts scheduled').first()).toBeVisible({ timeout: 90_000 });
  for (const tab of ['Scheduler', 'Analytics', 'Profile', 'Home'] as const) await goTab(page, tab);
};

const banner = () => page.getByTestId('scheduler-action-banner');

const addWorker = async (name: string, role: string) => {
  await page.getByLabel('Worker name').fill(name);
  await page.getByLabel('Worker role').fill(role);
  const saved = proxyResponse(page, 'upsertWorker');
  await page.getByTestId('add-worker-btn').click();
  return (await saved).status();
};

const addTemplate = async (name: string, role: string, start: string, end: string, coverage: string) => {
  await page.getByLabel('Template name').fill(name);
  await page.getByLabel('Template role').fill(role);
  await page.getByLabel('Shift start time').fill(start);
  await page.getByLabel('Shift end time').fill(end);
  await page.getByLabel('Required coverage').fill(coverage);
  const saved = proxyResponse(page, 'upsertShiftTemplate');
  await page.getByTestId('add-template-btn').click();
  expect((await saved).status()).toBe(200);
};

const autoAssign = async (date: string) => {
  await goStep(page, 'shifts');
  await page.getByLabel('Date', { exact: true }).fill(date);
  await page.getByRole('button', { name: /^Auto-assign workers/ }).click();
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pickAllDays = async (p: Page) => {
  for (const day of DAYS) {
    const chip = p.getByTestId(`availability-day-${day}`);
    if ((await chip.getAttribute('aria-checked')) !== 'true') await chip.click();
  }
};

/** Runs `act` and returns the statuses of the next `n` proxy answers for `action` (60 s at most). */
const proxyResponses = async (p: Page, action: string, n: number, act: () => Promise<unknown>, timeoutMs = 60_000): Promise<number[]> => {
  const statuses: number[] = [];
  let finish = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const on = (res: import('@playwright/test').Response) => {
    if (res.url().includes('/api/secure-proxy') && (res.request().postData() ?? '').includes(`"action":"${action}"`)) {
      statuses.push(res.status());
      // Every refusal is kept with its text, for the findings report.
      if (res.status() >= 400) {
        void res.text().then((body) => fs.appendFileSync(path.join(SHOTS, 'proxy-refusals.log'), `${new Date().toISOString()} ${action} ${res.status()} ${body}\n`)).catch(() => undefined);
      }
      if (statuses.length >= n) finish();
    }
  };
  p.on('response', on);
  await act();
  await Promise.race([done, p.waitForTimeout(timeoutMs)]);
  p.off('response', on);
  return statuses;
};

/** Adds one shift with the roster form of `p`; returns the proxy status, or 0 when the form refused it. */
const addShiftByHand = async (p: Page, worker: string, template: string, date: string): Promise<number> => {
  await p.getByRole('button', { name: `Select worker ${worker}` }).first().click();
  await p.getByRole('button', { name: `Select template ${template}` }).first().click();
  await p.getByLabel('Date', { exact: true }).fill(date);
  const statuses = await proxyResponses(p, 'upsertRosterShift', 1, async () => {
    await p.getByRole('button', { name: 'Save as draft' }).click();
    await p.waitForTimeout(1_500);
  }, 15_000);
  if (statuses.length === 0) {
    // The form refused it before any request: keep its sentence for the report.
    const said = (await p.locator('body').innerText()).split('\n').filter((l) => /must|already|required|cover|overlap/i.test(l) && l.length < 300);
    fs.appendFileSync(path.join(SHOTS, 'form-refusals.log'), `${new Date().toISOString()} ${worker} / ${template} / ${date}: ${said.join(' | ')}\n`);
  }
  return statuses[0] ?? 0;
};

const showAll = async (p: Page = page) => {
  const more = p.getByTestId('roster-show-all');
  if ((await more.count()) > 0 && (await more.innerText()).startsWith('Show all')) await more.click();
};

// ─── 1. First-time setup ─────────────────────────────────────────────────────

test('FL-1 first visit: every tab agrees the account is empty, on the trial', async () => {
  fs.rmSync(path.join(SHOTS, 'observations.jsonl'), { force: true });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('location-setup-card')).toBeVisible({ timeout: 90_000 });
  const seen = await tour(page, '01-empty');
  const t = truth();
  expect(t.trialActive).toBe(true);
  expectCoherent(seen, t, 'trial', 'empty account');
  expect.soft(seen.home.checklist, 'Home shows the setup checklist').toBe(true);
  // Back to tabs that are already mounted: the document title must follow.
  for (const tab of ['Home', 'Scheduler', 'Analytics'] as const) {
    await goTab(page, tab);
    // BUG: F-1 — the title stays "Profile · Horario" (the last tab mounted).
    await expect.soft(page, `document title follows the ${tab} tab`).toHaveTitle(new RegExp(`^${tab} `), { timeout: 5_000 });
  }
});

test('FL-2 location on Home: Profile, Scheduler and Home agree (Peru, America/Lima)', async () => {
  await startSession();
  await goTab(page, 'Home');
  const card = page.getByTestId('location-setup-card');
  if ((await card.getByTestId('location-country-search').count()) === 0) await card.getByTestId('location-change-country').click();
  await card.getByTestId('location-country-search').fill('Peru');
  await card.getByTestId('country-option-PE').click();
  const other = card.getByTestId('region-option-other');
  if (await other.count()) await other.click();
  await card.getByTestId('location-name').fill(`Restaurante ${RUN}`);
  await card.getByTestId('location-timezone').fill(TZ);
  await card.getByTestId('industry-option-food_service').click();
  await card.getByTestId('location-headcount').fill('14');
  const saved = proxyResponse(page, 'upsertLocation');
  await card.getByTestId('location-save').click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByTestId('location-setup-card')).toHaveCount(0, { timeout: 30_000 });
  const seen = await tour(page, '02-location');
  const t = truth();
  expect(t.locations).toBe(1);
  // BUG: F-2 — Profile mounted in FL-1 keeps "Locations: 0" and "No locations yet." (no reload on focus).
  expectCoherent(seen, t, 'trial', 'after location');
  expect.soft(seen.profile.locationRows, 'Profile lists the new location').toBeGreaterThan(0);
  // The roster step's compliance panel needs the location; it must not still ask to set one up.
  expect.soft(seen.scheduler.raw, 'Scheduler does not still ask for a location').not.toMatch(/Add a location|set up a location|Set up your location/i);
});

test('FL-3 team: 6 by hand, 8 by CSV, availability; every tab counts 14', async () => {
  await startSession();
  await goStep(page, 'workers');
  for (const [i, name] of BY_HAND.entries()) expect(await addWorker(name, ROLE_OF(i))).toBe(200);
  const csv = CSV_PEOPLE.map((n, i) => `${n}, ${ROLE_OF(i)}, `).join('\n');
  await page.getByTestId('team-import-input').fill(csv);
  const imported = proxyResponse(page, 'importWorkers');
  await page.getByTestId('team-import-button').click();
  expect((await imported).status()).toBe(200);
  await expect(page.getByTestId('team-import-message')).toBeVisible();
  // Availability for everyone, all weekdays at once, all day (the night template crosses midnight).
  // The app saves one request per day: wait for all seven before the next person.
  await page.getByLabel('From', { exact: true }).fill('00:00');
  await page.getByLabel('To', { exact: true }).fill('23:59');
  for (const name of [...BY_HAND, ...CSV_PEOPLE]) {
    await page.getByRole('button', { name: `Select worker ${name}` }).first().click();
    await pickAllDays(page);
    const statuses = await proxyResponses(page, 'upsertAvailability', 7, () =>
      page.getByRole('button', { name: 'Add availability', exact: true }).click());
    expect(statuses, `availability for ${name}`).toEqual([200, 200, 200, 200, 200, 200, 200]);
  }
  const seen = await tour(page, '03-team');
  const t = truth();
  expect(t.workers).toBe(14);
  expect(num(`select count(*) from worker_availability where account_id=${acc()}`)).toBe(14 * 7);
  // BUG: F-2 — Profile still says "People: 0".
  expectCoherent(seen, t, 'trial', 'after team');
});

test('FL-4 templates (mañana, tarde, noche across midnight) and a demand override', async () => {
  await startSession();
  await goStep(page, 'templates');
  await addTemplate(T_MORNING, COOK, '07:00', '15:00', '2');
  await addTemplate(T_EVENING, WAIT, '15:00', '23:00', '2');
  await addTemplate(T_NIGHT, COOK, '22:00', '06:00', '1');
  await goStep(page, 'forecast');
  // Demand tomorrow for the cooks: 4, more than the templates cover, so a gap stays.
  await page.getByLabel('Date', { exact: true }).last().fill(dateKey(1));
  await page.getByLabel('Role', { exact: true }).last().fill(COOK);
  await page.getByLabel('Required', { exact: true }).last().fill('4');
  const saved = proxyResponse(page, 'upsertTargets');
  await page.getByText('Save target', { exact: true }).click();
  expect((await saved).status()).toBe(200);
  const seen = await tour(page, '04-templates-demand');
  const t = truth();
  expect(t.templates).toBe(3);
  expect(t.overrides).toBe(1);
  expectCoherent(seen, t, 'trial', 'after templates and demand');
  // Nothing is published yet: the demand of 4 is a gap of 4 on Home.
  expect.soft(seen.home.gaps, 'Home: one role to fill tomorrow').toBe(1);
  expect.soft(seen.home.checklist, 'Home: setup checklist done (team, templates, demand)').toBe(false);
  expect.soft(seen.analytics.coverage, 'Analytics coverage: 0 % (nothing published)').toBe('0%');
});

test('FL-5 auto-fill this week, apply, publish all, mark one as told', async () => {
  await startSession();
  await autoAssign(dateKey(0));
  await expect(page.getByTestId('apply-auto-assign')).toBeVisible({ timeout: 90_000 });
  await shot(page, '05-suggestions');
  const stored = proxyResponse(page, 'addRosterShifts');
  await page.getByTestId('apply-auto-assign').click();
  expect((await stored).status()).toBe(200);
  await expect(page.getByTestId('apply-auto-assign')).toHaveCount(0, { timeout: 30_000 });
  const afterApply = await tour(page, '05a-applied');
  const t1 = truth();
  expect(t1.rosterAll).toBeGreaterThan(0);
  // BUG: F-2 — Analytics (mounted earlier) keeps 0 drafts; Profile keeps "Auto-schedules: 0".
  expectCoherent(afterApply, t1, 'trial', 'after apply');

  // Publish tomorrow's shifts (the date with demand) and mark the first as told.
  await goStep(page, 'shifts');
  await showAll();
  const tomorrow = dateKey(1);
  const publishTomorrow = page.getByRole('button', { name: new RegExp(`^Publish this shift: .*, ${tomorrow}$`) });
  expect(await publishTomorrow.count()).toBeGreaterThan(0);
  const notPublished: string[] = [];
  for (let i = 0; i < 12 && (await publishTomorrow.count()) > notPublished.length; i += 1) {
    const button = publishTomorrow.nth(notPublished.length);
    const label = (await button.getAttribute('aria-label')) ?? '';
    const status = await proxyResponses(page, 'updateShiftStatus', 1, () => button.click(), 5_000);
    if (status[0] !== 200) {
      // Refused in the browser: the reason is in the banner at the top of the screen.
      const said = (await page.locator('body').innerText()).split('\n').filter((l) => /must cover|must match|no longer available/i.test(l));
      notPublished.push(`${label}: ${said.join(' | ') || '(no message on screen)'}`);
      fs.appendFileSync(path.join(SHOTS, 'form-refusals.log'), `${new Date().toISOString()} publish ${notPublished.at(-1)}\n`);
    }
  }
  await shot(page, '05b-publish-refused');
  // BUG: F-9 — the night shift auto-fill created cannot be published: "availability must cover 22:00 - 06:00".
  expect.soft(notPublished, 'every shift of tomorrow can be published').toEqual([]);
  const told = proxyResponse(page, 'markShiftNotified');
  await page.getByRole('button', { name: new RegExp(`^Mark this shift as told to the worker: .*, ${tomorrow}$`) }).first().click();
  expect((await told).status()).toBe(200);
  await expect(banner()).toContainText('No message was sent');
  const seen = await tour(page, '05b-published');
  const t = truth();
  expectCoherent(seen, t, 'trial', 'after publish');
  // Published cooks tomorrow cover part of the 4: the gap on Home is the same date/role.
  const cooksTomorrow = num(`select count(*) from roster r join shift_templates s on s.id=r.template_id where r.account_id=${acc()} and r.date='${tomorrow}' and r.status='Published' and s.role='${COOK}'`);
  expect.soft(seen.home.gaps, 'Home roles to fill').toBe(cooksTomorrow >= 4 ? 0 : 1);
  expect.soft(seen.home.raw, 'Home shows the remaining open count').toContain(`${Math.max(0, 4 - cooksTomorrow)} open`);
  expect.soft(seen.analytics.hoursBars, 'Analytics hours bars: one per person with published shifts').toBe(
    num(`select count(distinct worker_id) from roster where account_id=${acc()} and status='Published'`),
  );
});

// ─── 2. Daily use ────────────────────────────────────────────────────────────

test('FL-6 daily: add a shift by hand, remove one, a day off; every tab follows', async () => {
  await startSession();
  await goStep(page, 'shifts');
  // Hugo (a waiter) on the evening shift in two days, unless the auto-fill already has him then.
  const status = await addShiftByHand(page, CSV_PEOPLE[7], T_EVENING, dateKey(2));
  await shot(page, '06a-manual-shift');
  expect([200, 0]).toContain(status);

  await showAll();
  const removeFirst = page.locator('[data-testid^="remove-shift-"]').filter({ visible: true }).first();
  await removeFirst.click();
  const removed = await proxyResponses(page, 'deleteRosterShift', 1, () => removeFirst.click()); // two-tap remove
  expect(removed).toEqual([200]);

  await goStep(page, 'workers');
  const daysOff = page.getByTestId('team-days-off');
  await daysOff.getByRole('radio', { name: BY_HAND[1], exact: true }).click();
  await page.getByTestId('day-off-date').fill(dateKey(8));
  await page.getByTestId('day-off-reason').fill('Médico');
  const off = proxyResponse(page, 'upsertTimeOff');
  await page.getByTestId('day-off-add').click();
  expect((await off).status()).toBe(200);
  const seen = await tour(page, '06b-daily');
  // BUG: F-2 — Analytics keeps the counts from when it was first opened.
  expectCoherent(seen, truth(), 'trial', 'after daily edits');
});

test('FL-7 availability for several days, then the next person right away: nothing is lost', async () => {
  await startSession();
  await goStep(page, 'workers');
  const [a, b] = [CSV_PEOPLE[0], CSV_PEOPLE[1]];
  sql(`delete from worker_availability where account_id=${acc()} and worker_id in (select id from workers where account_id=${acc()} and name in ('${a}','${b}'))`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await goStep(page, 'workers');
  await page.getByLabel('From', { exact: true }).fill('00:00');
  await page.getByLabel('To', { exact: true }).fill('23:59');
  await page.getByRole('button', { name: `Select worker ${a}` }).first().click();
  await pickAllDays(page);
  const first = proxyResponse(page, 'upsertAvailability');
  await page.getByRole('button', { name: 'Add availability', exact: true }).click();
  await first;
  // A quick person: the next worker and their days while the first save is still running.
  await page.getByRole('button', { name: `Select worker ${b}` }).first().click();
  await pickAllDays(page);
  await page.waitForTimeout(8_000);
  await shot(page, '07-availability-fast-switch');
  const rows = (name: string) => num(`select count(*) from worker_availability a join workers w on w.id=a.worker_id where w.account_id=${acc()} and w.name='${name}'`);
  // BUG: F-5 — the first person is saved one day per request; the loop's end clears the days picked for the second.
  expect.soft(rows(a), `${a} has all seven days`).toBe(7);
  const checked = await Promise.all(DAYS.map((d) => page.getByTestId(`availability-day-${d}`).getAttribute('aria-checked')));
  expect.soft(checked.filter((c) => c === 'true').length, `the days picked for ${b} are still selected`).toBe(7);
  // Leave both people fully available for the rest of the flow.
  for (const name of [a, b]) {
    if (rows(name) === 7) continue;
    await page.getByRole('button', { name: `Select worker ${name}` }).first().click();
    for (const d of DAYS) {
      const chip = page.getByTestId(`availability-day-${d}`);
      if ((await chip.getAttribute('aria-checked')) === 'true') await chip.click();
    }
    const have = sql(`select string_agg(day_of_week::text, ',') from worker_availability a join workers w on w.id=a.worker_id where w.account_id=${acc()} and w.name='${name}'`).split(',');
    const missing = DAYS.filter((d) => !have.includes(d));
    for (const d of missing) await page.getByTestId(`availability-day-${d}`).click();
    await proxyResponses(page, 'upsertAvailability', missing.length, () => page.getByRole('button', { name: 'Add availability', exact: true }).click());
  }
  expect(rows(a) + rows(b)).toBe(14);
});

test('FL-8 the same worker edited in two tabs: the second save is refused with 409 and the list reloads', async () => {
  await startSession();
  const other = await page.context().newPage();
  await other.goto('/scheduler?section=workers', { waitUntil: 'domcontentloaded' });
  await expect(other.getByRole('button', { name: `Edit worker ${BY_HAND[2]}` })).toBeVisible({ timeout: 90_000 });
  await goStep(page, 'workers');
  await page.getByRole('button', { name: `Edit worker ${BY_HAND[2]}` }).click();
  await other.getByRole('button', { name: `Edit worker ${BY_HAND[2]}` }).click();
  await page.getByLabel('Worker skills').fill('parrilla');
  const first = proxyResponse(page, 'upsertWorker');
  await page.getByTestId('add-worker-btn').click();
  expect((await first).status()).toBe(200);
  await other.getByLabel('Worker skills').fill('caja');
  const second = proxyResponse(other, 'upsertWorker');
  await other.getByTestId('add-worker-btn').click();
  expect((await second).status()).toBe(409);
  await expect(other.getByText(/Someone else changed this/).first(), 'the 409 says someone else changed it').toBeVisible();
  await other.screenshot({ path: path.join(SHOTS, '08-conflict-second-tab.png'), fullPage: true });
  // After the refusal the list reloads (CLAUDE.md, Concurrency): the stored skills show in the second tab.
  // Passes today: the refused tab shows the stored skills; its form keeps the edit and says "Reload to see their change".
  await expect.soft(other.getByText('parrilla').first(), 'second tab reloads to the saved skills').toBeVisible({ timeout: 15_000 });
  await other.close();
});

test('FL-9 a template time edit that would double-book someone is refused (409), the form keeps the input', async () => {
  await startSession();
  // A split-shift template for the cooks, 16–20.
  await goStep(page, 'templates');
  await addTemplate(T_SPLIT, COOK, '16:00', '20:00', '1');
  await goStep(page, 'shifts');
  // Rosa (a cook) on the morning (07–15) and the split (16–20) of the same far-off day: no overlap.
  const day = addDays(mondayOf(dateKey(0)), 37);
  expect(await addShiftByHand(page, BY_HAND[0], T_MORNING, day)).toBe(200);
  expect(await addShiftByHand(page, BY_HAND[0], T_SPLIT, day)).toBe(200);
  // The same person can take a night shift (22–06) two days later: availability is all day, every day.
  // BUG: F-9 — the roster form refuses it (availability must cover 22:00–06:00 inside one day's slot),
  // while auto-assign gives the same people night shifts.
  expect.soft(await addShiftByHand(page, BY_HAND[0], T_NIGHT, addDays(day, 2)), 'a night shift by hand for someone available all day').toBe(200);
  // Stretching the morning to 17:00 would put her on two shifts from 16:00.
  await goStep(page, 'templates');
  await page.getByRole('button', { name: `Edit template ${T_MORNING}` }).click();
  await page.getByLabel('Shift end time').fill('17:00');
  expect(await proxyResponses(page, 'upsertShiftTemplate', 1, () => page.getByTestId('add-template-btn').click())).toEqual([409]);
  await shot(page, '09-template-409');
  const screen = await screenText(page);
  expect.soft(screen, 'the refusal says why in words').toMatch(/two shifts at once|overlap|at the same time/i);
  await expect.soft(page.getByLabel('Shift end time'), 'the form keeps the typed end time').toHaveValue('17:00');
  await expect.soft(page.getByLabel('Template name'), 'the form stays in edit mode').toHaveValue(T_MORNING);
  expect(sql(`select end_time from shift_templates where account_id=${acc()} and name='${T_MORNING}'`)).toMatch(/^15:00/);
  await page.getByTestId('cancel-template-edit').click();
});

// ─── 3. Weekly use ───────────────────────────────────────────────────────────

test('FL-10 weekly: auto-fill next week while another tab takes a suggested slot; the count agrees everywhere', async () => {
  await startSession();
  const other = await page.context().newPage();
  await other.goto('/scheduler?section=shifts', { waitUntil: 'domcontentloaded' });
  await expect(other.getByRole('button', { name: 'Save as draft' })).toBeVisible({ timeout: 90_000 });

  const nextMonday = addDays(mondayOf(dateKey(0)), 7);
  await autoAssign(nextMonday);
  await expect(page.getByTestId('apply-auto-assign')).toBeVisible({ timeout: 90_000 });
  await shot(page, '10a-suggestions');
  // The other tab gives the first suggested person a different shift that overlaps the suggestion.
  const firstLine = await page.getByText(/ → .+ on \d{4}-\d{2}-\d{2}$/).first().innerText();
  const [, who, tpl, date] = firstLine.match(/^(.+) → (.+) on (\d{4}-\d{2}-\d{2})$/) ?? [];
  expect(who && tpl && date).toBeTruthy();
  const otherStatus = await addShiftByHand(other, who, tpl, date);
  expect(otherStatus).toBe(200);

  const refused = await proxyResponses(page, 'addRosterShifts', 1, () => page.getByTestId('apply-auto-assign').click());
  expect(refused).toEqual([409]);
  await shot(page, '10b-apply-409');
  await expect(banner()).toContainText(/already on the roster|Reload/);
  await page.waitForTimeout(3_000);
  // The roster list of this tab does reload after the 409 (passes today); the suggestions below do not follow it.
  expect.soft(await stepCount(page, 'shifts'), 'after the 409 this tab counts the other tab\'s shift').toBe(truth().rosterAll);
  await expect.soft(page.getByText(firstLine, { exact: true }), 'the taken slot is no longer suggested').toHaveCount(0, { timeout: 10_000 });
  const again = await proxyResponses(page, 'addRosterShifts', 1, () => page.getByTestId('apply-auto-assign').click());
  expect.soft(again, 'applying again after the reload is not refused the same way').toEqual([200]);
  if (again[0] !== 200) {
    // Unstick: a fresh run sees the reloaded roster (still on the trial, so it is free).
    await autoAssign(nextMonday);
    await expect(page.getByTestId('apply-auto-assign')).toBeVisible({ timeout: 90_000 });
    const third = await proxyResponses(page, 'addRosterShifts', 1, () => page.getByTestId('apply-auto-assign').click());
    // BUG: F-6 — even a new run in this tab suggests the taken slot again; only a page reload clears it.
    expect.soft(third, 'a new run after the 409 can be applied').toEqual([200]);
    if (third[0] !== 200) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await autoAssign(nextMonday);
      await expect(page.getByTestId('apply-auto-assign')).toBeVisible({ timeout: 90_000 });
      expect(await proxyResponses(page, 'addRosterShifts', 1, () => page.getByTestId('apply-auto-assign').click())).toEqual([200]);
    }
  }
  await expect(page.getByTestId('apply-auto-assign')).toHaveCount(0, { timeout: 30_000 });
  await other.close();
  // Day off on day 8 is respected: Jorge has no shift that date.
  expect(num(`select count(*) from roster r join workers w on w.id=r.worker_id where r.account_id=${acc()} and w.name='${BY_HAND[1]}' and r.date='${dateKey(8)}'`)).toBe(0);
  const seen = await tour(page, '10c-weekly');
  const t = truth();
  // Refused applies are not counted: this week and next week.
  expect(t.autoRuns).toBe(2);
  // Profile and Analytics are stale here unless the page was reloaded above (F-2).
  expectCoherent(seen, t, 'trial', 'after next week');
  // BUG: F-12 — Home's "This week" counts today .. today + 7 (eight days, into next week), not the week Analytics calls "This week".
  expect.soft(seen.home.scheduled, 'Home "This week" = shifts of this Monday–Sunday week').toBe(t.isoWeek);
});

// ─── 4. Monthly: trial ends, Gratis, rollover ────────────────────────────────

test('FL-11 the trial ends mid-session with 14 people: the next write is 402 and every tab moves to Gratis', async () => {
  await startSession();
  sql(`update account_entitlements set revoked_at=now(), revoked_by='sim-${RUN}' where account_id=${acc()} and source='trial' and revoked_at is null`);
  // Without a reload, the next write is the first thing that learns of it.
  await goStep(page, 'workers');
  const refused = await addWorker(`Extra ${RUN}`, WAIT);
  expect(refused).toBe(402);
  await shot(page, '11a-402');
  const message = await screenText(page);
  expect.soft(message, 'the refusal names the Gratis people limit').toMatch(/covers 10|up to 10|read-only/i);
  // The optimistic row is rolled back.
  await expect.soft(page.getByText(`Extra ${RUN}`, { exact: true }), 'refused worker is not left in the list').toHaveCount(0);
  const seen = await tour(page, '11b-gratis-no-reload');
  // BUG: F-3 — without a reload Profile still shows the trial and the roster banner the trial.
  expectCoherent(seen, truth(), 'gratis', 'trial ended, no reload');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const reloaded = await tour(page, '11c-gratis-reloaded');
  // Passes today, and shows F-4 (product decision): the two runs of the trial count against Gratis, "2 / 1",
  // so an owner whose trial ends mid-month gets no free week that month.
  expectCoherent(reloaded, truth(), 'gratis', 'trial ended, after reload');
  // BUG: F-10 — nothing says the schedule is read-only until a write is refused.
  expect.soft(reloaded.scheduler.raw, 'Scheduler says the team is over the Gratis people limit').toMatch(/10 people|people limit|over the limit|read-only/i);
});

test('FL-12 Gratis over the people limit: deletes work, a publish is 402; removing the demand changes coverage', async () => {
  await startSession();
  await goStep(page, 'shifts');
  await showAll();
  const publish = page.locator('[data-testid^="publish-shift-"]').filter({ visible: true }).first();
  const pub = await proxyResponses(page, 'updateShiftStatus', 1, () => publish.click());
  expect(pub).toEqual([402]);
  await expect(banner()).toBeVisible();
  const msg = await banner().innerText();
  await shot(page, '12a-publish-402');
  expect.soft(msg, 'the refusal names the people limit').toMatch(/10/);
  // A delete is allowed over the limit.
  const remove = page.locator('[data-testid^="remove-shift-"]').filter({ visible: true }).first();
  await remove.click();
  expect(await proxyResponses(page, 'deleteRosterShift', 1, () => remove.click())).toEqual([200]);

  // Remove tomorrow's demand override (a delete): coverage has no demand left.
  await goStep(page, 'forecast');
  const removeOverride = page.getByTestId(`remove-override-${dateKey(1)}-${COOK}`);
  await removeOverride.click();
  expect(await proxyResponses(page, 'deleteDemandTarget', 1, () => removeOverride.click())).toEqual([200]);
  expect(truth().overrides).toBe(0);
  const seen = await tour(page, '12b-gratis-delete');
  expectCoherent(seen, truth(), 'gratis', 'Gratis over the people limit');
  // BUG: F-2 — Analytics still shows the coverage of the removed demand.
  expect.soft(seen.analytics.coverage, 'Analytics coverage has no demand left').toBe('—');
  expect.soft(seen.home.gaps, 'Home has no roles to fill without demand').toBe(0);
});

test('FL-13 back to 10 people, new month: two tabs at the one-week limit, one apply wins', async () => {
  await startSession();
  // Remove 4 people (deletes are allowed) to be within Gratis.
  await goStep(page, 'workers');
  for (const name of CSV_PEOPLE.slice(4)) await removePerson(name);
  // A new month: the trial's runs belong to last month.
  sql(`update usage_limits set auto_assign_month='2026-10' where account_id=${acc()}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const fresh = await tour(page, '13a-new-month');
  expectCoherent(fresh, truth(), 'gratis', 'new month, 10 people');

  // Two tabs, both with the free week still available, both run the same week.
  const other = await page.context().newPage();
  await other.goto('/scheduler?section=shifts', { waitUntil: 'domcontentloaded' });
  await expect(other.getByRole('button', { name: 'Save as draft' })).toBeVisible({ timeout: 90_000 });
  const weekAfter = addDays(mondayOf(dateKey(0)), 14);
  await autoAssign(weekAfter);
  await expect(page.getByTestId('apply-auto-assign')).toBeVisible({ timeout: 90_000 });
  // A different week in the other tab, so only the plan limit can refuse it.
  await other.getByLabel('Date', { exact: true }).fill(addDays(weekAfter, 7));
  await other.getByRole('button', { name: /^Auto-assign workers/ }).click();
  await expect(other.getByTestId('apply-auto-assign')).toBeVisible({ timeout: 90_000 });

  expect(await proxyResponses(page, 'addRosterShifts', 1, () => page.getByTestId('apply-auto-assign').click())).toEqual([200]);
  const second = await proxyResponses(other, 'addRosterShifts', 1, () => other.getByTestId('apply-auto-assign').click());
  expect(second).toEqual([402]);
  await other.screenshot({ path: path.join(SHOTS, '13b-second-tab-402.png'), fullPage: true });
  await expect(other.getByTestId('scheduler-action-banner')).toContainText(/auto-filled week|limit|plan/i);
  // The refused suggestions stay (nothing saved), and the tab now knows the limit is reached.
  await expect.soft(other.getByTestId('apply-auto-assign'), 'suggestions stay after the 402').toBeVisible();
  await expect.soft(other.getByText("You've used this month's free auto-filled week").first(), 'the other tab shows the limit').toBeVisible({ timeout: 10_000 });
  await other.getByRole('button', { name: /^Auto-assign workers/ }).click();
  await expect.soft(other.getByTestId('scheduler-action-banner'), 'a new run is stopped before it runs').toContainText(/auto-filled week|limit/i);
  await other.close();
  expect(truth().autoRuns).toBe(1);

  const used = await tour(page, '13c-used-the-free-week');
  // BUG: F-2 — Profile does not follow the count.
  expectCoherent(used, truth(), 'gratis', 'free week used');
  // A second week in this tab: refused before running.
  await autoAssign(addDays(weekAfter, 7));
  await expect(banner()).toContainText(/auto-filled week|limit/i);
  await shot(page, '13d-limit');
});

test('FL-14 phone width 390: Home, Scheduler, Analytics and Profile show the same numbers', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startSession();
  const seen = await tour(page, '14-phone');
  expectCoherent(seen, truth(), 'gratis', 'phone');
  for (const tab of ['Home', 'Scheduler', 'Analytics', 'Profile'] as const) {
    await goTab(page, tab);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect.soft(overflow, `${tab}: no horizontal scroll at 390 px`).toBeLessThanOrEqual(0);
  }
});

/**
 * Removes a person the way an owner would. A person with shifts is refused today
 * (409 "Record is still referenced"); the owner then removes their shifts first.
 */
async function removePerson(name: string) {
  await goStep(page, 'workers');
  const id = sql(`select id from workers where account_id=${acc()} and name='${name}'`);
  const btn = page.getByTestId(`remove-worker-${id}`);
  await btn.click();
  const first = await proxyResponses(page, 'deleteWorker', 1, () => btn.click());
  if (first[0] === 200) return;
  // BUG: F-11 — a person with shifts cannot be removed, and the message is "Record is still referenced".
  expect.soft(first, `remove ${name} (has shifts)`).toEqual([200]);
  expect.soft(await screenText(page), 'the refusal says what to do').not.toMatch(/Record is still referenced/);
  await goStep(page, 'shifts');
  await showAll();
  const shiftIds = sql(`select coalesce(string_agg(id::text, ','), '') from roster where account_id=${acc()} and worker_id='${id}'`).split(',').filter(Boolean);
  for (const shiftId of shiftIds) {
    const b = page.getByTestId(`remove-shift-${shiftId}`);
    const reachable = await b.click({ timeout: 10_000 }).then(() => true, () => false);
    // A shift the roster list does not show cannot be removed from the app; the database removes it so the flow goes on.
    expect.soft(reachable, `the roster list shows ${name}'s shift ${shiftId}`).toBe(true);
    if (!reachable) { sql(`delete from roster where account_id=${acc()} and id='${shiftId}'`); continue; }
    expect(await proxyResponses(page, 'deleteRosterShift', 1, () => b.click(), 10_000), `remove a shift of ${name}`).toEqual([200]);
  }
  await goStep(page, 'workers');
  await page.getByTestId(`remove-worker-${id}`).click();
  expect(await proxyResponses(page, 'deleteWorker', 1, () => page.getByTestId(`remove-worker-${id}`).click()), `remove ${name} after their shifts`).toEqual([200]);
}

/** Starts a guide from the header's tour button and walks it to the end. */
const finishGuide = async (guide: string) => {
  const start = page.getByRole('button', { name: guide, exact: true });
  await expect(async () => {
    if (!(await start.isVisible())) await page.getByRole('button', { name: 'Start app tour' }).first().click();
    await expect(start).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await start.click();
  for (let i = 0; i < 30 && (await page.getByTestId('tour-next').count()) > 0; i += 1) {
    await page.getByTestId('tour-next').click();
    await page.waitForTimeout(400);
  }
  await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
};

test('FL-15 everyone deleted: Home checklist and every tab agree; the tour adds no sample rows after a failed load', async () => {
  await startSession();
  await goStep(page, 'workers');
  const names = sql(`select string_agg(name, '|') from workers where account_id=${acc()}`).split('|').filter(Boolean);
  for (const name of names) await removePerson(name);
  expect(truth().workers).toBe(0);
  const seen = await tour(page, '15a-no-workers');
  expectCoherent(seen, truth(), 'gratis', 'no workers');
  expect.soft(seen.home.checklist, 'Home shows "Add workers" again').toBe(true);

  // The people list cannot load: finishing a guide must not seed sample people.
  await page.route('**/api/secure-proxy', async (route) => {
    if ((route.request().postData() ?? '').includes('"action":"listWorkers"')) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'simulated outage' }) });
    } else await route.continue();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await goStep(page, 'workers');
  await finishGuide('Scheduler Guide');
  await page.waitForTimeout(5_000);
  await shot(page, '15b-guide-after-failed-load');
  expect(truth().workers, 'no sample people after a failed load').toBe(0);
  await page.unroute('**/api/secure-proxy');

  // The load works again (Retry): still an account with templates, shifts and a location.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await goStep(page, 'workers');
  await page.waitForTimeout(5_000);
  await shot(page, '15c-after-retry');
  // Guards the coordinator's case (g); passes today (no sample rows after a failed load or after the retry).
  expect.soft(sql(`select coalesce(string_agg(name, ','), '') from workers where account_id=${acc()}`), 'no sample people in an account with templates and shifts').toBe('');
});
