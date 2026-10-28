/**
 * @jest-environment node
 *
 * Tenant-isolation integration tests for the secure proxy against a real
 * local Supabase (PostgREST + Postgres with all migrations applied).
 *
 * Skipped unless SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_KEY are set:
 *   supabase start
 *   SUPABASE_TEST_URL=http://127.0.0.1:54321 \
 *   SUPABASE_TEST_SERVICE_KEY=<SECRET_KEY from `supabase status`> \
 *   npm run test:integration
 *
 * Tenant A is a personal account (user id); tenant B is a Clerk organization
 * whose member is user_b. For every action, B must not be able to read,
 * change or delete A's rows by id.
 */
import { randomUUID } from 'crypto';

import { installJwksFetch, signToken, TEST_JWKS_URL } from '../testUtils/testTokens';

const SUPABASE_URL = process.env.SUPABASE_TEST_URL;
const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY;
const describeIfDb = SUPABASE_URL && SERVICE_KEY ? describe : describe.skip;

type Route = { POST: (req: Request) => Promise<Response> };

const run = randomUUID().slice(0, 8);
const USER_A = `user_a_${run}`;
const USER_B = `user_b_${run}`;
const ORG_B = `org_b_${run}`;
const tokenA = () => signToken(USER_A);
const tokenB = () => signToken(USER_B, { claims: { o: { id: ORG_B, rol: 'org:admin' } } });

describeIfDb('secure proxy tenant isolation (local Supabase)', () => {
  let route: Route;
  let fetchSpy: jest.SpyInstance;

  const call = async (token: string, body: Record<string, unknown>) => {
    const res = await route.POST(
      new Request('http://localhost/api/secure-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const asA = (body: Record<string, unknown>) => call(tokenA(), body);
  const asB = (body: Record<string, unknown>) => call(tokenB(), body);

  // Tenant A's fixtures, created through the proxy.
  let workerA: string;
  let templateA: string;
  let availabilityA: string;
  let rosterA: string;

  beforeAll(async () => {
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    delete process.env.EXPO_PUBLIC_FORECAST_API_URL;
    fetchSpy = installJwksFetch();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
    route = require('../../app/api/secure-proxy+api') as Route;

    const w = await asA({ action: 'upsertWorker', worker: { id: randomUUID(), name: 'Ana', role: 'Barista' } });
    expect(w.status).toBe(200);
    workerA = (w.body.worker as { id: string }).id;

    const t = await asA({ action: 'upsertShiftTemplate', template: { name: 'Night', role: 'Barista', startTime: '22:00', endTime: '06:00', coverage: 1 } });
    expect(t.status).toBe(200);
    templateA = (t.body.template as { id: string }).id;

    const av = await asA({ action: 'upsertAvailability', availability: { workerId: workerA, dayOfWeek: 'Mon', fromTime: '21:00', toTime: '07:00' } });
    expect(av.status).toBe(200);
    availabilityA = (av.body.availability as { id: string }).id;

    const r = await asA({ action: 'upsertRosterShift', shift: { date: '2026-10-19', workerId: workerA, templateId: templateA } });
    expect(r.status).toBe(200);
    rosterA = (r.body.shift as { id: string }).id;
  });

  afterAll(() => fetchSpy.mockRestore());

  it('lists only the caller tenant rows', async () => {
    const lists = { listWorkers: 'workers', listWorkerAvailability: 'availabilities', listShiftTemplates: 'templates', listRoster: 'shifts' };
    for (const [action, key] of Object.entries(lists)) {
      const a = await asA({ action });
      const b = await asB({ action });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const aRows = a.body[key] as unknown[];
      const bRows = b.body[key] as unknown[];
      expect(aRows.length).toBeGreaterThan(0);
      expect(bRows).toEqual([]);
    }
  });

  it('ignores an accountId sent in the body', async () => {
    const res = await asB({ action: 'listWorkers', accountId: USER_A });
    expect(res.body.workers).toEqual([]);
  });

  it('stores worker labor attributes and keeps them when an update leaves them out', async () => {
    const id = randomUUID();
    const created = await asA({
      action: 'upsertWorker',
      worker: { id, name: 'Lia', role: 'Barista', birthDate: '2001-04-17', nightWorker: true, weeklyLimitOptOut: true, noFixedHours: true },
    });
    expect(created.status).toBe(200);
    expect(created.body.worker).toMatchObject({ birthDate: '2001-04-17', nightWorker: true, weeklyLimitOptOut: true, noFixedHours: true });

    const renamed = await asA({ action: 'upsertWorker', worker: { id, name: 'Lia M.', role: 'Barista' } });
    expect(renamed.body.worker).toMatchObject({ name: 'Lia M.', birthDate: '2001-04-17', nightWorker: true });

    const cleared = await asA({ action: 'upsertWorker', worker: { id, name: 'Lia M.', role: 'Barista', birthDate: null, nightWorker: false } });
    expect(cleared.body.worker).toMatchObject({ birthDate: null, nightWorker: false, weeklyLimitOptOut: true });

    const plain = (await asA({ action: 'listWorkers' })).body.workers as { id: string; nightWorker: boolean; birthDate: string | null }[];
    expect(plain.find((w) => w.id === workerA)).toMatchObject({ birthDate: null, nightWorker: false });
  });

  it("cannot overwrite A's worker by reusing its id", async () => {
    const res = await asB({ action: 'upsertWorker', worker: { id: workerA, name: 'Hijacked', role: 'Cook' } });
    expect(res.status).toBe(409);
    const a = await asA({ action: 'listWorkers' });
    expect((a.body.workers as { id: string; name: string }[]).find((w) => w.id === workerA)?.name).toBe('Ana');
  });

  it("cannot overwrite A's template or roster shift by id", async () => {
    const t = await asB({ action: 'upsertShiftTemplate', template: { id: templateA, name: 'X', role: 'Cook', startTime: '08:00', endTime: '09:00', coverage: 1 } });
    expect(t.status).toBe(409);
    const workerB = (await asB({ action: 'upsertWorker', worker: { name: 'Bruno', role: 'Cook' } })).body.worker as { id: string };
    const templateB = (await asB({ action: 'upsertShiftTemplate', template: { name: 'Day', role: 'Cook', startTime: '08:00', endTime: '16:00', coverage: 1 } })).body.template as { id: string };
    const r = await asB({ action: 'upsertRosterShift', shift: { id: rosterA, date: '2026-10-20', workerId: workerB.id, templateId: templateB.id } });
    expect(r.status).toBe(409);
  });

  it("cannot reference A's worker or template from B's writes", async () => {
    const templateB = (await asB({ action: 'listShiftTemplates' })).body.templates as { id: string }[];
    const workerB = (await asB({ action: 'listWorkers' })).body.workers as { id: string }[];
    expect((await asB({ action: 'upsertRosterShift', shift: { date: '2026-10-21', workerId: workerA, templateId: templateB[0].id } })).status).toBe(404);
    expect((await asB({ action: 'upsertRosterShift', shift: { date: '2026-10-21', workerId: workerB[0].id, templateId: templateA } })).status).toBe(404);
    expect((await asB({ action: 'upsertAvailability', availability: { workerId: workerA, dayOfWeek: 'Mon', fromTime: '21:00', toTime: '07:00' } })).status).toBe(404);
  });

  it("cannot delete or update A's rows by id", async () => {
    expect((await asB({ action: 'deleteWorker', id: workerA })).status).toBe(404);
    expect((await asB({ action: 'deleteAvailability', id: availabilityA })).status).toBe(404);
    expect((await asB({ action: 'deleteShiftTemplate', id: templateA })).status).toBe(404);
    expect((await asB({ action: 'deleteRosterShift', id: rosterA })).status).toBe(404);
    expect((await asB({ action: 'updateShiftStatus', id: rosterA, status: 'Published' })).status).toBe(404);
    expect((await asB({ action: 'markShiftNotified', id: rosterA })).status).toBe(404);

    const shifts = (await asA({ action: 'listRoster' })).body.shifts as { id: string; status: string; notified: boolean }[];
    expect(shifts.find((s) => s.id === rosterA)).toMatchObject({ status: 'Draft', notified: false });
  });

  it('owner can update and delete its own rows', async () => {
    expect((await asA({ action: 'updateShiftStatus', id: rosterA, status: 'Published' })).status).toBe(200);
    expect((await asA({ action: 'markShiftNotified', id: rosterA })).status).toBe(200);
    const extra = (await asA({ action: 'upsertWorker', worker: { name: 'Temp', role: 'Barista' } })).body.worker as { id: string };
    expect((await asA({ action: 'deleteWorker', id: extra.id })).status).toBe(200);
    expect((await asA({ action: 'deleteWorker', id: extra.id })).status).toBe(404);
  });

  it('keeps demand targets per tenant for the same date and role', async () => {
    const target = { date: '2026-10-19', role: 'Barista' };
    expect((await asA({ action: 'upsertTargets', targets: [{ ...target, required: 2 }] })).status).toBe(200);
    expect((await asB({ action: 'upsertTargets', targets: [{ ...target, required: 9 }] })).status).toBe(200);
    const a = (await asA({ action: 'loadTargets', filters: target })).body.targets as { required: number }[];
    const b = (await asB({ action: 'loadTargets', filters: target })).body.targets as { required: number }[];
    expect(a.map((t) => t.required)).toEqual([2]);
    expect(b.map((t) => t.required)).toEqual([9]);
    const forecast = (await asB({ action: 'forecast', filters: target })).body.forecasts as { required: number; source: string }[];
    expect(forecast).toEqual([expect.objectContaining({ required: 9, source: 'override' })]);
  });

  it('keeps onboarding, usage, POS sales and subscriptions per tenant', async () => {
    await asA({ action: 'upsertOnboarding', flags: { workers: true, templates: false, forecast: false } });
    expect((await asA({ action: 'getOnboarding' })).body.progress).toEqual({ workers: true, templates: false, forecast: false });
    expect((await asB({ action: 'getOnboarding' })).body.progress).toBeNull();

    expect((await asA({ action: 'incrementAutoAssign' })).body.count).toBe(1);
    expect((await asA({ action: 'incrementAutoAssign' })).body.count).toBe(2);
    expect((await asB({ action: 'getUsageLimit' })).body).toEqual({ count: 0, canAutoAssign: true });

    expect((await asA({ action: 'uploadPosSales', rows: [{ date: '2026-10-01', revenue: 1200 }] })).status).toBe(200);
    expect((await asB({ action: 'listPosSales' })).body.total).toBe(0);

    const subA = (await asA({ action: 'getSubscription' })).body.subscription as { accountId: string; tier: string };
    const subB = (await asB({ action: 'getSubscription' })).body.subscription as { accountId: string; tier: string };
    expect(subA).toMatchObject({ accountId: USER_A, tier: 'free' });
    expect(subB).toMatchObject({ accountId: ORG_B, tier: 'free' });
  });

  it('offers no client action that changes a plan', async () => {
    for (const action of ['upsertSubscription', 'stripeWebhook', 'culqiWebhook']) {
      const res = await asA({ action, subscription: { tier: 'pro' }, accountId: USER_A });
      expect(res.status).toBe(400);
    }
    const sub = (await asA({ action: 'getSubscription' })).body.subscription as { tier: string };
    expect(sub.tier).toBe('free');
  });

  it('keeps business locations per tenant and records who confirmed them', async () => {
    const berkeley = { name: 'Berkeley store', countryCode: 'US', regionCode: 'CA', cityCode: 'BERKELEY', jurisdictionCode: 'US-CA-BERKELEY', timeZone: 'America/Los_Angeles', industry: 'retail', employerHeadcount: 120 };
    const created = await asA({ action: 'upsertLocation', location: { ...berkeley, accountId: ORG_B, confirmedBy: 'someone-else' } });
    expect(created.status).toBe(200);
    const locA = created.body.location as { id: string; confirmedBy: string; jurisdictionCode: string; overrides: unknown[] };
    expect(locA).toMatchObject({ confirmedBy: USER_A, jurisdictionCode: 'US-CA-BERKELEY', overrides: [] });

    expect(((await asA({ action: 'listLocations' })).body.locations as { id: string }[]).map((l) => l.id)).toEqual([locA.id]);
    expect((await asB({ action: 'listLocations' })).body.locations).toEqual([]);

    // B cannot overwrite or delete A's location by id.
    expect((await asB({ action: 'upsertLocation', location: { ...berkeley, id: locA.id, name: 'Hijacked' } })).status).toBe(409);
    expect((await asB({ action: 'deleteLocation', id: locA.id })).status).toBe(404);
    const still = (await asA({ action: 'listLocations' })).body.locations as { name: string }[];
    expect(still.map((l) => l.name)).toEqual(['Berkeley store']);

    // A can switch the place; the pack must follow.
    expect((await asA({ action: 'upsertLocation', location: { ...berkeley, id: locA.id, cityCode: null } })).status).toBe(400);
    const moved = await asA({ action: 'upsertLocation', location: { ...berkeley, id: locA.id, cityCode: null, jurisdictionCode: 'US-CA' } });
    expect(moved.body.location).toMatchObject({ id: locA.id, cityCode: null, jurisdictionCode: 'US-CA' });

    const member = signToken(`user_m_${run}`, { claims: { o: { id: ORG_B, rol: 'org:member' } } });
    const locB = (await asB({ action: 'upsertLocation', location: { name: 'Lima', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service' } })).body.location as { id: string };
    expect((await call(member, { action: 'deleteLocation', id: locB.id })).status).toBe(403);
    expect((await call(member, { action: 'upsertLocation', location: { id: locB.id, name: 'Lima', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service', employerHeadcount: 1 } })).status).toBe(403);
    expect((await asB({ action: 'deleteLocation', id: locB.id })).status).toBe(200);
    expect((await asA({ action: 'deleteLocation', id: locA.id })).status).toBe(200);
  });

  // ── CHG-088: every scheduling record survives a reload and stays per tenant ──

  it('persists worker and availability updates and deletes, per tenant', async () => {
    const worker = (await asA({ action: 'upsertWorker', worker: { id: randomUUID(), name: 'Iris', role: 'Barista', skills: ['Latte'] } })).body.worker as { id: string };
    expect((await asA({ action: 'upsertWorker', worker: { id: worker.id, name: 'Iris K.', role: 'Lead', skills: [] } })).status).toBe(200);
    const slotId = randomUUID();
    expect((await asA({ action: 'upsertAvailability', availability: { id: slotId, workerId: worker.id, dayOfWeek: 'Fri', fromTime: '18:00', toTime: '02:00' } })).status).toBe(200);
    expect((await asA({ action: 'upsertAvailability', availability: { id: slotId, workerId: worker.id, dayOfWeek: 'Fri', fromTime: '17:00', toTime: '01:00' } })).status).toBe(200);

    // "Reload": a fresh list returns the stored values.
    const workers = (await asA({ action: 'listWorkers' })).body.workers as { id: string; name: string; role: string; skills: string[] }[];
    expect(workers.find((w) => w.id === worker.id)).toMatchObject({ name: 'Iris K.', role: 'Lead', skills: [] });
    const slots = (await asA({ action: 'listWorkerAvailability' })).body.availabilities as { id: string; fromTime: string; toTime: string }[];
    expect(slots.filter((s) => s.id === slotId)).toEqual([expect.objectContaining({ fromTime: '17:00', toTime: '01:00' })]);

    // B can neither change nor delete them.
    expect((await asB({ action: 'upsertAvailability', availability: { id: slotId, workerId: worker.id, dayOfWeek: 'Fri', fromTime: '09:00', toTime: '10:00' } })).status).toBe(404);
    expect((await asB({ action: 'deleteAvailability', id: slotId })).status).toBe(404);
    expect((await asB({ action: 'deleteWorker', id: worker.id })).status).toBe(404);

    expect((await asA({ action: 'deleteAvailability', id: slotId })).status).toBe(200);
    expect((await asA({ action: 'deleteWorker', id: worker.id })).status).toBe(200);
    expect(((await asA({ action: 'listWorkers' })).body.workers as { id: string }[]).some((w) => w.id === worker.id)).toBe(false);
  });

  it('persists template updates, refuses deleting a template in use, and keeps B out', async () => {
    const id = randomUUID();
    expect((await asA({ action: 'upsertShiftTemplate', template: { id, name: 'Close', role: 'Barista', startTime: '16:00', endTime: '23:30', coverage: 2 } })).status).toBe(200);
    expect((await asA({ action: 'upsertShiftTemplate', template: { id, name: 'Late close', role: 'Barista', startTime: '17:00', endTime: '00:30', coverage: 3 } })).status).toBe(200);
    const templates = (await asA({ action: 'listShiftTemplates' })).body.templates as { id: string; name: string; endTime: string; coverage: number }[];
    expect(templates.find((t) => t.id === id)).toMatchObject({ name: 'Late close', endTime: '00:30', coverage: 3 });
    expect(((await asB({ action: 'listShiftTemplates' })).body.templates as { id: string }[]).some((t) => t.id === id)).toBe(false);

    const shift = (await asA({ action: 'upsertRosterShift', shift: { date: '2026-11-05', workerId: workerA, templateId: id } })).body.shift as { id: string };
    expect((await asA({ action: 'deleteShiftTemplate', id })).status).toBe(409);
    expect((await asA({ action: 'deleteRosterShift', id: shift.id })).status).toBe(200);
    expect((await asB({ action: 'deleteShiftTemplate', id })).status).toBe(404);
    expect((await asA({ action: 'deleteShiftTemplate', id })).status).toBe(200);
  });

  it('persists roster status and notified, with notify only after publish', async () => {
    const created = await asA({ action: 'upsertRosterShift', shift: { id: randomUUID(), date: '2026-11-06', workerId: workerA, templateId: templateA, location: ' Bar ' } });
    expect(created.status).toBe(200);
    const id = (created.body.shift as { id: string }).id;
    expect(created.body.shift).toMatchObject({ status: 'Draft', notified: false, location: 'Bar' });

    expect((await asA({ action: 'markShiftNotified', id })).status).toBe(409);
    expect((await asA({ action: 'updateShiftStatus', id, status: 'Published' })).body.shift).toMatchObject({ status: 'Published', notified: false });
    expect((await asA({ action: 'markShiftNotified', id })).body.shift).toMatchObject({ status: 'Published', notified: true });
    // Publishing again changes nothing (a retry keeps the sent notification).
    expect((await asA({ action: 'updateShiftStatus', id, status: 'Published' })).body.shift).toMatchObject({ notified: true });

    const reloaded = (await asA({ action: 'listRoster', fromDate: '2026-11-06', toDate: '2026-11-06' })).body.shifts as { id: string; status: string; notified: boolean }[];
    expect(reloaded.find((s) => s.id === id)).toMatchObject({ status: 'Published', notified: true });

    // Unpublishing clears notified, so a re-publish must be sent again.
    expect((await asA({ action: 'updateShiftStatus', id, status: 'Draft' })).body.shift).toMatchObject({ status: 'Draft', notified: false });

    // B sees nothing and cannot touch it.
    expect((await asB({ action: 'listRoster', fromDate: '2026-11-06', toDate: '2026-11-06' })).body.shifts).toEqual([]);
    expect((await asB({ action: 'updateShiftStatus', id, status: 'Published' })).status).toBe(404);
    expect((await asA({ action: 'deleteRosterShift', id })).status).toBe(200);
  });

  it('refuses a second roster row for the same worker, date and template (409)', async () => {
    const shift = { date: '2026-11-07', workerId: workerA, templateId: templateA };
    const first = await asA({ action: 'upsertRosterShift', shift: { ...shift, id: randomUUID() } });
    expect(first.status).toBe(200);
    const second = await asA({ action: 'upsertRosterShift', shift: { ...shift, id: randomUUID() } });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).not.toMatch(/duplicate key|roster_account_slot_key/);
    expect((await asA({ action: 'deleteRosterShift', id: (first.body.shift as { id: string }).id })).status).toBe(200);
  });

  it('pages the roster 500 rows at a time without gaps or overlap', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- test-only direct insert
    const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
    const db = createClient(SUPABASE_URL as string, SERVICE_KEY as string, { auth: { persistSession: false } });
    const pagingTenant = `user_p_${run}`;
    const asP = (body: Record<string, unknown>) => call(signToken(pagingTenant), body);
    const w = (await asP({ action: 'upsertWorker', worker: { name: 'Pat', role: 'Cook' } })).body.worker as { id: string };
    const t = (await asP({ action: 'upsertShiftTemplate', template: { name: 'Day', role: 'Cook', startTime: '08:00', endTime: '16:00', coverage: 1 } })).body.template as { id: string };
    const start = Date.UTC(2027, 0, 1);
    const rows = Array.from({ length: 503 }, (_, i) => ({
      account_id: pagingTenant,
      date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
      worker_id: w.id,
      template_id: t.id,
    }));
    const { error } = await db.from('roster').insert(rows);
    expect(error).toBeNull();

    const page0 = await asP({ action: 'listRoster', page: 0 });
    const page1 = await asP({ action: 'listRoster', page: 1 });
    expect(page0.body).toMatchObject({ page: 0, pageSize: 500, hasMore: true });
    expect(page1.body).toMatchObject({ page: 1, hasMore: false });
    const ids = [...(page0.body.shifts as { id: string }[]), ...(page1.body.shifts as { id: string }[])].map((s) => s.id);
    expect(ids).toHaveLength(503);
    expect(new Set(ids).size).toBe(503);
    expect((await asA({ action: 'listRoster', page: 1 })).body.shifts).toEqual([]);

    await db.from('roster').delete().eq('account_id', pagingTenant);
  });

  it('lists and deletes manual demand overrides per tenant, never model rows', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- test-only direct insert
    const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
    const db = createClient(SUPABASE_URL as string, SERVICE_KEY as string, { auth: { persistSession: false } });
    await db.from('demand_targets').insert({ account_id: USER_A, date: '2026-11-10', role: 'Barista', required: 6, source: 'model' });

    const saved = await asA({ action: 'upsertTargets', targets: [{ date: '2026-11-11', role: 'Barista', required: 4.4, notes: ' Launch ', source: 'model', accountId: ORG_B }] });
    expect(saved.status).toBe(200);
    expect(saved.body.targets).toEqual([{ date: '2026-11-11', role: 'Barista', required: 4, notes: 'Launch', source: 'override' }]);

    const listed = (await asA({ action: 'loadTargets', fromDate: '2026-11-10', toDate: '2026-11-11' })).body;
    expect(listed).toMatchObject({ page: 0, hasMore: false });
    expect(listed.targets).toEqual([expect.objectContaining({ date: '2026-11-11', required: 4, notes: 'Launch', source: 'override' })]);
    expect((await asB({ action: 'loadTargets', fromDate: '2026-11-10', toDate: '2026-11-11' })).body.targets).toEqual([]);

    expect((await asB({ action: 'deleteDemandTarget', target: { date: '2026-11-11', role: 'Barista' } })).status).toBe(404);
    expect((await asA({ action: 'deleteDemandTarget', target: { date: '2026-11-10', role: 'Barista' } })).status).toBe(404);
    expect((await asA({ action: 'deleteDemandTarget', target: { date: '2026-11-11', role: 'Barista' } })).status).toBe(200);
    expect((await asA({ action: 'loadTargets', fromDate: '2026-11-10', toDate: '2026-11-11' })).body.targets).toEqual([]);

    await db.from('demand_targets').delete().eq('account_id', USER_A).eq('date', '2026-11-10');
  });

  it('does not leak database error details', async () => {
    const res = await asB({ action: 'upsertWorker', worker: { id: workerA, name: 'X', role: 'Y' } });
    expect(JSON.stringify(res.body)).not.toMatch(/duplicate key|violates|constraint|pkey/i);
  });
});

describeIfDb('referrals API (local Supabase)', () => {
  let route: Route;
  let fetchSpy: jest.SpyInstance;

  const call = async (token: string, body: Record<string, unknown>) => {
    const res = await route.POST(
      new Request('http://localhost/api/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  beforeAll(() => {
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    fetchSpy = installJwksFetch();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
    route = require('../../app/api/referrals+api') as Route;
  });

  afterAll(() => fetchSpy.mockRestore());

  it('creates one reusable pending code, redeems it once per user, and keeps lists private', async () => {
    const first = await call(tokenA(), { action: 'create', channel: 'whatsapp' });
    const again = await call(tokenA(), { action: 'create' });
    expect(first.status).toBe(200);
    expect(again.body.referralCode).toBe(first.body.referralCode);

    const code = first.body.referralCode as string;
    expect((await call(tokenA(), { action: 'redeem', code })).status).toBe(400);
    const redeemed = await call(tokenB(), { action: 'redeem', code: code.toLowerCase() });
    expect(redeemed.body).toEqual({ success: true, referrerId: USER_A });
    expect((await call(tokenB(), { action: 'redeem', code })).status).toBe(400);

    expect((await call(tokenA(), { action: 'stats' })).body).toEqual({ sent: 1, accepted: 1, pending: 1 });
    expect((await call(tokenB(), { action: 'list' })).body.referrals).toEqual([]);
    expect((await call(tokenB(), { action: 'redeem', code: 'NOPE1234' })).body).toEqual({ error: 'This referral code is not valid' });
  });
});
