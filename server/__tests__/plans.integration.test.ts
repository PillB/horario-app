/**
 * @jest-environment node
 *
 * Plans on the server, against a real local database (CHG-099): the trial,
 * the Gratis limits, read-only over the limit, platform-admin grants, and the
 * rules the table itself enforces. Skipped unless SUPABASE_TEST_URL and
 * SUPABASE_TEST_SERVICE_KEY are set (see proxyTenantIsolation.integration).
 */
import { randomUUID } from 'crypto';

import { installJwksFetch, signToken, TEST_JWKS_URL } from '../testUtils/testTokens';

const SUPABASE_URL = process.env.SUPABASE_TEST_URL;
const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY;
const describeIfDb = SUPABASE_URL && SERVICE_KEY ? describe : describe.skip;

type Route = { POST: (req: Request) => Promise<Response> };
type Plan = { plan: string; source: string; isTrial: boolean; endsAt: string | null; limits: Record<string, number | null> };

const run = randomUUID().slice(0, 8);
const OWNER = `user_plan_${run}`;
const OTHER = `user_plan_other_${run}`;
const PLATFORM_ADMIN = `user_platform_${run}`;
const RACER = `user_plan_race_${run}`;

describeIfDb('plans and entitlements (local Supabase)', () => {
  let route: Route;
  let fetchSpy: jest.SpyInstance;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
  const db = () => createClient(SUPABASE_URL as string, SERVICE_KEY as string, { auth: { persistSession: false } });

  const call = async (user: string, body: Record<string, unknown>) => {
    const res = await route.POST(
      new Request('http://localhost/api/secure-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(user)}` },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const asOwner = (body: Record<string, unknown>) => call(OWNER, body);
  const planOf = async (user: string) => (await call(user, { action: 'getSubscription' })).body.plan as Plan;
  const addWorker = (n: number) => asOwner({ action: 'upsertWorker', worker: { name: `Worker ${n}`, role: 'Cook' } });
  const endTrial = async (accountId: string) => {
    const { error } = await db()
      .from('account_entitlements')
      .update({ revoked_at: new Date().toISOString(), revoked_by: 'test' })
      .eq('account_id', accountId)
      .eq('source', 'trial');
    expect(error).toBeNull();
  };

  beforeAll(() => {
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.HORARIO_PLATFORM_ADMIN_USER_IDS = PLATFORM_ADMIN;
    delete process.env.EXPO_PUBLIC_FORECAST_API_URL;
    fetchSpy = installJwksFetch();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
    route = require('../../app/api/secure-proxy+api') as Route;
  });

  afterAll(() => {
    fetchSpy.mockRestore();
    delete process.env.HORARIO_PLATFORM_ADMIN_USER_IDS;
  });

  it('starts one 14-day Pro trial on first sight and never a second', async () => {
    const first = await planOf(OWNER);
    expect(first).toMatchObject({ plan: 'pro', source: 'trial', isTrial: true });
    const days = (Date.parse(first.endsAt as string) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    expect(first.limits).toEqual({ maxWorkers: null, maxLocations: null, maxAutoSchedulesPerMonth: null });

    await Promise.all([planOf(OWNER), planOf(OWNER), planOf(OWNER)]);
    const { data } = await db().from('account_entitlements').select('id').eq('account_id', OWNER).eq('source', 'trial');
    expect(data).toHaveLength(1);
  });

  it('lets a trial account past every Gratis limit', async () => {
    for (let n = 1; n <= 11; n += 1) expect((await addWorker(n)).status).toBe(200);
    expect((await asOwner({ action: 'forecastHistory', from: '2026-01-01', to: '2026-02-01' })).status).toBe(200);
  });

  it('drops to Gratis when the trial ends: nothing is lost, the schedule is read-only over the limit', async () => {
    await endTrial(OWNER);
    const plan = await planOf(OWNER);
    expect(plan).toMatchObject({ plan: 'gratis', source: 'default', isTrial: false });
    expect(plan.limits).toEqual({ maxWorkers: 10, maxLocations: 1, maxAutoSchedulesPerMonth: 3 });

    // No second trial.
    const { data: trials } = await db().from('account_entitlements').select('id').eq('account_id', OWNER).eq('source', 'trial');
    expect(trials).toHaveLength(1);

    // 11 people on a 10-person plan: reads work, writes are refused with the reason, deletes work.
    const listed = await asOwner({ action: 'listWorkers' });
    expect(listed.status).toBe(200);
    const workers = listed.body.workers as { id: string }[];
    expect(workers).toHaveLength(11);

    const template = { name: 'Day', role: 'Cook', startTime: '09:00', endTime: '17:00', coverage: 1 };
    const refused = await asOwner({ action: 'upsertShiftTemplate', template });
    expect(refused.status).toBe(402);
    expect(String(refused.body.error)).toMatch(/11 people.*Gratis plan covers 10.*read-only/);

    // Bad input is still a 400, before the plan is even looked at.
    expect((await asOwner({ action: 'upsertShiftTemplate', template: { ...template, coverage: 0 } })).status).toBe(400);

    expect((await asOwner({ action: 'deleteWorker', id: workers[0].id })).status).toBe(200);
    // At the limit (10): writes work again, an 11th person does not.
    expect((await asOwner({ action: 'upsertShiftTemplate', template })).status).toBe(200);
    const eleventh = await addWorker(12);
    expect(eleventh.status).toBe(402);
    expect(String(eleventh.body.error)).toMatch(/up to 10 people/);
    // Editing someone already on the team is not adding.
    expect((await asOwner({ action: 'upsertWorker', worker: { id: workers[1].id, name: 'Renamed', role: 'Cook' } })).status).toBe(200);
  });

  it('keeps the forecast and the sales upload for Pro', async () => {
    for (const body of [
      { action: 'forecastHistory', from: '2026-01-01', to: '2026-02-01' },
      { action: 'listForecastSignals', from: '2026-01-01', to: '2026-02-01' },
      { action: 'forecast', filters: {} },
      { action: 'uploadPosSales', rows: [{ date: '2026-10-01', revenue: 100 }] },
    ]) {
      const res = await asOwner(body);
      expect(res.status).toBe(402);
      expect(String(res.body.error)).toMatch(/Pro plan/);
    }
    // Manual demand targets stay.
    expect((await asOwner({ action: 'upsertTargets', targets: [{ date: '2026-11-02', role: 'Cook', required: 2 }] })).status).toBe(200);
  });

  it('allows one location on Gratis', async () => {
    const lima = { name: 'Lima', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service' };
    const first = await asOwner({ action: 'upsertLocation', location: lima });
    expect(first.status).toBe(200);
    const second = await asOwner({ action: 'upsertLocation', location: { ...lima, name: 'Cusco' } });
    expect(second.status).toBe(402);
    expect(String(second.body.error)).toMatch(/covers 1 location\b/);
    // Editing the one location is fine.
    const id = (first.body.location as { id: string }).id;
    expect((await asOwner({ action: 'upsertLocation', location: { ...lima, id, name: 'Lima centro' } })).status).toBe(200);
  });

  it('counts 3 auto-schedules a month on Gratis, for the whole account', async () => {
    expect((await asOwner({ action: 'getUsageLimit' })).body).toEqual({ count: 0, limit: 3, canAutoAssign: true });
    for (const expected of [1, 2, 3]) {
      const res = await asOwner({ action: 'incrementAutoAssign' });
      expect(res.body).toMatchObject({ success: true, count: expected, canAutoAssign: expected < 3 });
    }
    const fourth = await asOwner({ action: 'incrementAutoAssign' });
    expect(fourth.status).toBe(402);
    expect(String(fourth.body.error)).toMatch(/3 auto-schedules a month/);
    expect((await asOwner({ action: 'getUsageLimit' })).body).toEqual({ count: 3, limit: 3, canAutoAssign: false });

    // Last month's runs do not count.
    const { error } = await db().from('usage_limits').update({ auto_assign_month: '2020-01' }).eq('account_id', OWNER);
    expect(error).toBeNull();
    expect((await asOwner({ action: 'getUsageLimit' })).body).toEqual({ count: 0, limit: 3, canAutoAssign: true });
    expect((await asOwner({ action: 'incrementAutoAssign' })).body).toMatchObject({ count: 1 });
  });

  it('lets only a platform admin grant and revoke, and the grant lifts the limits', async () => {
    const grant = { action: 'adminGrantEntitlement', accountId: OWNER, plan: 'esencial', source: 'tester', days: 90, reason: 'pilot restaurant' };
    expect((await asOwner(grant)).status).toBe(403);
    expect((await call(OTHER, grant)).status).toBe(403);

    for (const bad of [{ plan: 'gratis' }, { source: 'paddle' }, { source: 'trial' }, { days: 0 }, { days: 1.5 }, { reason: '' }, { accountId: '' }]) {
      expect((await call(PLATFORM_ADMIN, { ...grant, ...bad })).status).toBe(400);
    }

    const granted = await call(PLATFORM_ADMIN, grant);
    expect(granted.status).toBe(200);
    const entitlement = granted.body.entitlement as { id: string; grantedBy: string; active: boolean };
    expect(entitlement).toMatchObject({ grantedBy: PLATFORM_ADMIN, active: true });

    const plan = await planOf(OWNER);
    expect(plan).toMatchObject({ plan: 'esencial', source: 'tester', isTrial: false });
    expect(plan.limits).toEqual({ maxWorkers: 40, maxLocations: 1, maxAutoSchedulesPerMonth: null });
    expect((await addWorker(13)).status).toBe(200);
    // Esencial still has no forecast.
    expect((await asOwner({ action: 'forecastHistory', from: '2026-01-01', to: '2026-02-01' })).status).toBe(402);

    const list = await call(PLATFORM_ADMIN, { action: 'adminListEntitlements', accountId: OWNER });
    expect((list.body.entitlements as { source: string }[]).map((e) => e.source).sort()).toEqual(['tester', 'trial']);

    expect((await asOwner({ action: 'adminRevokeEntitlement', id: entitlement.id })).status).toBe(403);
    expect((await call(PLATFORM_ADMIN, { action: 'adminRevokeEntitlement', id: entitlement.id })).status).toBe(200);
    expect((await call(PLATFORM_ADMIN, { action: 'adminRevokeEntitlement', id: entitlement.id })).status).toBe(404);
    expect((await planOf(OWNER)).plan).toBe('gratis');
  });

  it('keeps a grant as written: no edits, no deletes, one revoke', async () => {
    const granted = await call(PLATFORM_ADMIN, { action: 'adminGrantEntitlement', accountId: OTHER, plan: 'pro', source: 'comp', days: 30, reason: 'immutability check' });
    const id = (granted.body.entitlement as { id: string }).id;
    const client = db();

    const edit = await client.from('account_entitlements').update({ plan: 'esencial' }).eq('id', id);
    expect(edit.error?.message).toMatch(/cannot be edited/);
    const extend = await client.from('account_entitlements').update({ ends_at: '2099-01-01T00:00:00Z' }).eq('id', id);
    expect(extend.error?.message).toMatch(/cannot be edited/);
    const del = await client.from('account_entitlements').delete().eq('id', id);
    expect(del.error?.code).toBe('42501');

    expect((await call(PLATFORM_ADMIN, { action: 'adminRevokeEntitlement', id })).status).toBe(200);
    const unrevoke = await client.from('account_entitlements').update({ revoked_at: null, revoked_by: null }).eq('id', id);
    expect(unrevoke.error?.message).toMatch(/already revoked/);
  });

  it('holds the people and location limits when requests arrive at the same moment (CHG-100)', async () => {
    await planOf(RACER);
    await endTrial(RACER);
    const add = (n: number) => call(RACER, { action: 'upsertWorker', worker: { name: `Racer ${n}`, role: 'Cook' } });
    for (let n = 0; n < 8; n += 1) expect((await add(n)).status).toBe(200);

    // Two places left, six simultaneous adds: two get in, four are told why not.
    const people = await Promise.all([8, 9, 10, 11, 12, 13].map(add));
    expect(people.map((r) => r.status).sort()).toEqual([200, 200, 402, 402, 402, 402]);
    expect(String(people.find((r) => r.status === 402)?.body.error)).toMatch(/covers up to 10 people/);
    const { count } = await db().from('workers').select('id', { count: 'exact', head: true }).eq('account_id', RACER);
    expect(count).toBe(10);
    // At the limit, not over it: the schedule is still writable.
    expect((await call(RACER, { action: 'upsertShiftTemplate', template: { name: 'AM', role: 'Cook', startTime: '08:00', endTime: '16:00', coverage: 1 } })).status).toBe(200);

    const lima = { name: 'Lima', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service' };
    const places = await Promise.all(['A', 'B', 'C', 'D'].map((name) => call(RACER, { action: 'upsertLocation', location: { ...lima, name } })));
    expect(places.map((r) => r.status).sort()).toEqual([200, 402, 402, 402]);
    const stored = await db().from('locations').select('id', { count: 'exact', head: true }).eq('account_id', RACER);
    expect(stored.count).toBe(1);
  });

  it('imports a team all or nothing, and the same import twice adds nobody twice (CHG-100)', async () => {
    const TEAM = `user_plan_team_${run}`;
    await planOf(TEAM);
    await endTrial(TEAM);
    const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: randomUUID(), name: `Import ${i}`, role: 'Cook', skills: ['grill'] }));
    const countPeople = async () => (await db().from('workers').select('id', { count: 'exact', head: true }).eq('account_id', TEAM)).count;

    // 12 people on a 10-person plan: none is saved.
    const tooMany = await call(TEAM, { action: 'importWorkers', workers: people(12) });
    expect(tooMany.status).toBe(402);
    expect(await countPeople()).toBe(0);

    // A bad row refuses the whole file before anything is written.
    const bad = await call(TEAM, { action: 'importWorkers', workers: [...people(2), { id: randomUUID(), name: '', role: 'Cook' }] });
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toMatch(/^Row 3:/);
    expect(await countPeople()).toBe(0);

    const six = people(6);
    const first = await call(TEAM, { action: 'importWorkers', workers: six });
    expect(first.status).toBe(200);
    expect(first.body.added).toBe(6);
    // The answer was lost and the user imports the same file again.
    const again = await call(TEAM, { action: 'importWorkers', workers: six });
    expect(again.status).toBe(200);
    expect(again.body.added).toBe(0);
    expect((again.body.workers as unknown[]).length).toBe(6);
    expect(await countPeople()).toBe(6);

    // Two imports of 3 at the same moment with 4 places left: one fits, the other is refused whole.
    const both = await Promise.all([call(TEAM, { action: 'importWorkers', workers: people(3) }), call(TEAM, { action: 'importWorkers', workers: people(3) })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 402]);
    expect(await countPeople()).toBe(9);
  });

  it('saves a location edit only if nobody changed it since it was read (CHG-100)', async () => {
    const lima = { name: 'Lima', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service' };
    const id = randomUUID();
    const created = await call(OTHER, { action: 'upsertLocation', location: { ...lima, id } });
    expect(created.status).toBe(200);
    // The same create again (a retry after a lost answer) is the same location, not a second one.
    expect((await call(OTHER, { action: 'upsertLocation', location: { ...lima, id } })).status).toBe(200);
    const listed = ((await call(OTHER, { action: 'listLocations' })).body.locations as { id: string; updatedAt: string }[]).filter((l) => l.id === id);
    expect(listed).toHaveLength(1);
    const readAt = listed[0]?.updatedAt as string;

    // Two admins edit what they both read: the first save wins, the second is told.
    const [a, b] = await Promise.all([
      call(OTHER, { action: 'upsertLocation', location: { ...lima, id, name: 'Lima A' }, ifUpdatedAt: readAt }),
      call(OTHER, { action: 'upsertLocation', location: { ...lima, id, name: 'Lima B' }, ifUpdatedAt: readAt }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    const fresh = (winner.body.location as { updatedAt: string; name: string });
    expect((await call(OTHER, { action: 'upsertLocation', location: { ...lima, id, name: 'Lima C' }, ifUpdatedAt: fresh.updatedAt })).status).toBe(200);

    // Deleted by someone else while the form was open: not created again.
    expect((await call(OTHER, { action: 'deleteLocation', id })).status).toBe(200);
    expect((await call(OTHER, { action: 'upsertLocation', location: { ...lima, id, name: 'Lima D' }, ifUpdatedAt: fresh.updatedAt })).status).toBe(404);
    expect((await call(OTHER, { action: 'upsertLocation', location: { ...lima, id }, ifUpdatedAt: 'yesterday' })).status).toBe(400);
  });

  it('keeps a finished setup step finished when another tab sends false (CHG-100)', async () => {
    const done = await call(OTHER, { action: 'upsertOnboarding', flags: { workers: true, templates: false, forecast: true } });
    expect(done.body.progress).toEqual({ workers: true, templates: false, forecast: true });
    const stale = await call(OTHER, { action: 'upsertOnboarding', flags: { workers: false, templates: true, forecast: false } });
    expect(stale.body.progress).toEqual({ workers: true, templates: true, forecast: true });
  });
});
