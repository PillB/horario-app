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
    for (const action of ['listWorkers', 'listWorkerAvailability', 'listShiftTemplates', 'listRoster']) {
      const a = await asA({ action });
      const b = await asB({ action });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const aRows = Object.values(a.body)[0] as unknown[];
      const bRows = Object.values(b.body)[0] as unknown[];
      expect(aRows.length).toBeGreaterThan(0);
      expect(bRows).toEqual([]);
    }
  });

  it('ignores an accountId sent in the body', async () => {
    const res = await asB({ action: 'listWorkers', accountId: USER_A });
    expect(res.body.workers).toEqual([]);
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
