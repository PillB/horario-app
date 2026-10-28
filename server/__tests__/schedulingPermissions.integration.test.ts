/**
 * @jest-environment node
 *
 * CHG-091 (QA step 3c) against a real local Supabase. Skipped unless
 * SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_KEY are set (see
 * proxyTenantIsolation.integration.test.ts).
 *   - G1: an org member (`org:member`) gets 403 on every scheduling write and
 *     nothing changes; members still read; a member's forecast stores no model rows.
 *   - G4: `upsertRosterShift` never takes `notified` from the client.
 *   - G5: the service-role key cannot delete location history; purging needs an age of 2+ years.
 */
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { installJwksFetch, signToken, TEST_JWKS_URL } from '../testUtils/testTokens';

const SUPABASE_URL = process.env.SUPABASE_TEST_URL;
const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY;
const describeIfDb = SUPABASE_URL && SERVICE_KEY ? describe : describe.skip;

type Route = { POST: (req: Request) => Promise<Response> };
type Shift = { id: string; date: string; workerId: string; templateId: string; location: string; status: string; notified: boolean };

const FORECAST_URL = 'https://forecast.horario.test/v1';
const run = randomUUID().slice(0, 8);
const ORG = `org_perm_${run}`;
const ADMIN = `user_padmin_${run}`;
const MEMBER = `user_pmember_${run}`;

describeIfDb('scheduling permissions and roster notified (local Supabase)', () => {
  let route: Route;
  let fetchSpy: jest.SpyInstance;
  let db: SupabaseClient;

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
  const asAdmin = (body: Record<string, unknown>) => call(signToken(ADMIN, { claims: { o: { id: ORG, rol: 'org:admin' } } }), body);
  const asMember = (body: Record<string, unknown>) => call(signToken(MEMBER, { claims: { o: { id: ORG, rol: 'org:member' } } }), body);

  let worker1: string;
  let worker2: string;
  let template1: string;
  let template2: string;
  let availability: string;

  const saveShift = async (shift: Record<string, unknown>) => {
    const res = await asAdmin({ action: 'upsertRosterShift', shift });
    expect(res.status).toBe(200);
    return res.body.shift as Shift;
  };
  /** A published, notified shift on `date`. */
  const notifiedShift = async (date: string): Promise<Shift> => {
    const shift = await saveShift({ id: randomUUID(), date, workerId: worker1, templateId: template1, location: 'HQ' });
    expect((await asAdmin({ action: 'updateShiftStatus', id: shift.id, status: 'Published' })).status).toBe(200);
    const notified = await asAdmin({ action: 'markShiftNotified', id: shift.id });
    expect(notified.body.shift).toMatchObject({ status: 'Published', notified: true });
    return notified.body.shift as Shift;
  };

  beforeAll(async () => {
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.EXPO_PUBLIC_FORECAST_API_URL = FORECAST_URL;
    fetchSpy = installJwksFetch();
    const passThrough = fetchSpy.getMockImplementation()!;
    // The external forecast API answers one model forecast for December.
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === FORECAST_URL) {
        return Promise.resolve(new Response(JSON.stringify([{ date: '2026-12-01', role: 'Cook', required: 3 }]), { status: 200 }));
      }
      return passThrough(input, init);
    });
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
    route = require('../../app/api/secure-proxy+api') as Route;
    db = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

    const w1 = await asAdmin({ action: 'upsertWorker', worker: { id: randomUUID(), name: 'Ana', role: 'Cook' } });
    const w2 = await asAdmin({ action: 'upsertWorker', worker: { id: randomUUID(), name: 'Bea', role: 'Cook' } });
    const t1 = await asAdmin({ action: 'upsertShiftTemplate', template: { id: randomUUID(), name: 'Early', role: 'Cook', startTime: '06:00', endTime: '14:00', coverage: 1 } });
    const t2 = await asAdmin({ action: 'upsertShiftTemplate', template: { id: randomUUID(), name: 'Late', role: 'Cook', startTime: '14:00', endTime: '22:00', coverage: 1 } });
    worker1 = (w1.body.worker as { id: string }).id;
    worker2 = (w2.body.worker as { id: string }).id;
    template1 = (t1.body.template as { id: string }).id;
    template2 = (t2.body.template as { id: string }).id;
    const av = await asAdmin({ action: 'upsertAvailability', availability: { id: randomUUID(), workerId: worker1, dayOfWeek: 'Mon', fromTime: '06:00', toTime: '22:00' } });
    availability = (av.body.availability as { id: string }).id;
  });

  afterAll(() => fetchSpy.mockRestore());

  describe('G1: an org member cannot change scheduling data', () => {
    it('refuses every scheduling write with 403 and changes nothing', async () => {
      const shift = await notifiedShift('2026-11-16');
      await asAdmin({ action: 'upsertTargets', targets: [{ date: '2026-11-16', role: 'Cook', required: 2 }] });

      const writes: Record<string, unknown>[] = [
        { action: 'upsertWorker', worker: { id: randomUUID(), name: 'Mallory', role: 'Cook' } },
        { action: 'upsertWorker', worker: { id: worker1, name: 'Ana', role: 'Cook', weeklyLimitOptOut: true, nightWorker: true } },
        { action: 'deleteWorker', id: worker2 },
        { action: 'upsertAvailability', availability: { workerId: worker1, dayOfWeek: 'Tue', fromTime: '06:00', toTime: '22:00' } },
        { action: 'deleteAvailability', id: availability },
        { action: 'upsertShiftTemplate', template: { id: template1, name: 'Renamed', role: 'Cook', startTime: '06:00', endTime: '14:00', coverage: 1 } },
        { action: 'deleteShiftTemplate', id: template2 },
        { action: 'upsertRosterShift', shift: { date: '2026-11-17', workerId: worker1, templateId: template1 } },
        { action: 'upsertRosterShift', shift: { id: shift.id, date: shift.date, workerId: worker2, templateId: template1, status: 'Published' } },
        { action: 'updateShiftStatus', id: shift.id, status: 'Draft' },
        { action: 'markShiftNotified', id: shift.id },
        { action: 'deleteRosterShift', id: shift.id },
        { action: 'upsertTargets', targets: [{ date: '2026-11-16', role: 'Cook', required: 9 }] },
        { action: 'deleteDemandTarget', target: { date: '2026-11-16', role: 'Cook' } },
        { action: 'uploadPosSales', rows: [{ date: '2026-11-16', revenue: 999 }] },
      ];
      for (const body of writes) {
        const res = await asMember(body);
        expect({ action: body.action, status: res.status }).toEqual({ action: body.action, status: 403 });
        expect(String(res.body.error)).toMatch(/Only an admin of this business can change the schedule/);
      }

      const workers = (await asMember({ action: 'listWorkers' })).body.workers as { id: string; name: string; weeklyLimitOptOut: boolean; nightWorker: boolean }[];
      expect(workers.map((w) => w.id).sort()).toEqual([worker1, worker2].sort());
      expect(workers.find((w) => w.id === worker1)).toMatchObject({ weeklyLimitOptOut: false, nightWorker: false });
      const slots = (await asMember({ action: 'listWorkerAvailability' })).body.availabilities as { id: string }[];
      expect(slots.map((s) => s.id)).toEqual([availability]);
      const templates = (await asMember({ action: 'listShiftTemplates' })).body.templates as { id: string; name: string }[];
      expect(templates.find((t) => t.id === template1)?.name).toBe('Early');
      expect(templates).toHaveLength(2);
      const roster = (await asMember({ action: 'listRoster', fromDate: '2026-11-16', toDate: '2026-11-17' })).body.shifts as Shift[];
      expect(roster).toEqual([expect.objectContaining({ id: shift.id, workerId: worker1, status: 'Published', notified: true })]);
      const targets = (await asMember({ action: 'loadTargets', fromDate: '2026-11-16', toDate: '2026-11-16' })).body.targets as { required: number }[];
      expect(targets.map((t) => t.required)).toEqual([2]);
      expect((await asMember({ action: 'listPosSales' })).body.rows).toEqual([]);
    });

    it("lets a member read and keep their own onboarding", async () => {
      for (const action of ['listWorkers', 'listWorkerAvailability', 'listShiftTemplates', 'listRoster', 'loadTargets', 'listLocations', 'listLocationHistory', 'getUsageLimit', 'getSubscription']) {
        expect({ action, status: (await asMember({ action })).status }).toEqual({ action, status: 200 });
      }
      const saved = await asMember({ action: 'upsertOnboarding', flags: { workers: true } });
      expect(saved.status).toBe(200);
      expect((await asMember({ action: 'getOnboarding' })).body.progress).toMatchObject({ workers: true });
      // The admin's own onboarding is untouched.
      expect((await asAdmin({ action: 'getOnboarding' })).body.progress).toBeNull();
    });

    it("gives a member the forecast but stores model rows only for a manager", async () => {
      const modelRows = async () => {
        const { data, error } = await db.from('demand_targets').select('required').eq('account_id', ORG).eq('source', 'model');
        expect(error).toBeNull();
        return data ?? [];
      };
      const asMemberForecast = await asMember({ action: 'forecast' });
      expect(asMemberForecast.status).toBe(200);
      const forecasts = asMemberForecast.body.forecasts as { date: string; required: number; source: string }[];
      expect(forecasts.find((f) => f.date === '2026-12-01')).toMatchObject({ required: 3, source: 'model' });
      expect(await modelRows()).toEqual([]);

      expect((await asAdmin({ action: 'forecast' })).status).toBe(200);
      expect(await modelRows()).toEqual([{ required: 3 }]);
    });
  });

  describe('G4: notified is never taken from the client', () => {
    it('saves a new shift un-notified even when the client sends notified', async () => {
      const created = await saveShift({ id: randomUUID(), date: '2026-11-23', workerId: worker1, templateId: template1, status: 'Published', notified: true });
      expect(created).toMatchObject({ status: 'Published', notified: false });
      const withoutId = await saveShift({ date: '2026-11-24', workerId: worker1, templateId: template1, status: 'Published', notified: true });
      expect(withoutId.notified).toBe(false);
    });

    it('keeps the stored value on an edit that does not reassign, whatever the client sends', async () => {
      const shift = await notifiedShift('2026-11-25');
      const edited = await saveShift({ ...shift, location: 'Bar', notified: false });
      expect(edited).toMatchObject({ location: 'Bar', notified: true });
      const listed = (await asAdmin({ action: 'listRoster', fromDate: '2026-11-25', toDate: '2026-11-25' })).body.shifts as Shift[];
      expect(listed.find((s) => s.id === shift.id)?.notified).toBe(true);
    });

    it.each([
      ['worker', (s: Shift, w2: string) => ({ workerId: w2 })],
      ['date', () => ({ date: '2026-11-27' })],
      ['template', (_s: Shift, _w2: string, t2: string) => ({ templateId: t2 })],
    ])('clears notified when the %s changes, even when the client sends notified true', async (_label, change) => {
      const shift = await notifiedShift('2026-11-26');
      const moved = await saveShift({ ...shift, ...change(shift, worker2, template2), notified: true });
      expect(moved.notified).toBe(false);
      const listed = (await asAdmin({ action: 'listRoster', fromDate: '2026-11-26', toDate: '2026-11-27' })).body.shifts as Shift[];
      expect(listed.find((s) => s.id === shift.id)?.notified).toBe(false);
      expect((await asAdmin({ action: 'deleteRosterShift', id: shift.id })).status).toBe(200);
    });

    it('clears notified when an upsert changes the status', async () => {
      const shift = await notifiedShift('2026-11-28');
      // A draft cannot be notified, so the client sends notified false; the change still clears the stored flag.
      const draft = await saveShift({ ...shift, status: 'Draft', notified: false });
      expect(draft).toMatchObject({ status: 'Draft', notified: false });
    });
  });

  describe('G5: location history cannot be erased with the service-role key', () => {
    it('refuses a direct delete and a purge younger than 2 years', async () => {
      const location = await asAdmin({
        action: 'upsertLocation',
        location: { name: 'Lima', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service', employerHeadcount: 12 },
      });
      expect(location.status).toBe(200);
      const before = await db.from('location_history').select('id').eq('account_id', ORG);
      expect(before.data?.length).toBeGreaterThan(0);

      const deleted = await db.from('location_history').delete().eq('account_id', ORG).select('id');
      expect(deleted.error?.code).toBe('42501');
      const young = await db.rpc('purge_location_history', { p_older_than: '1 year' });
      expect(young.error?.code).toBe('22023');
      const old = await db.rpc('purge_location_history', { p_older_than: '10 years' });
      expect(old.error).toBeNull();

      const after = await db.from('location_history').select('id').eq('account_id', ORG);
      expect(after.data?.length).toBe(before.data?.length);
    });
  });
});
