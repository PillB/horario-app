/**
 * @jest-environment node
 *
 * Scheduling writes in the secure proxy (CHG-088): workers, availability,
 * shift templates, roster shifts and demand overrides are validated before
 * any database call, and list paging is checked. No database needed (same
 * harness as workersProxy.test.ts: the Supabase URL is never contacted).
 */
import { installJwksFetch, signToken, TEST_JWKS_URL } from '../testUtils/testTokens';
import {
  newUuid,
  validateAvailabilityInput,
  validateDemandTargetInput,
  validateRosterShiftInput,
  validateShiftTemplateInput,
  validateWorkerInput,
} from '@/utils/schedulingValidation';

type Route = { POST: (req: Request) => Promise<Response> };

const W1 = '11111111-1111-4111-8111-111111111111';
const T1 = '33333333-3333-4333-8333-333333333333';

describe('secure proxy scheduling validation (no database)', () => {
  let route: Route;
  let fetchSpy: jest.SpyInstance;
  const saved = { ...process.env };

  beforeAll(() => {
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    delete process.env.CLERK_AUTHORIZED_PARTIES;
    fetchSpy = installJwksFetch();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
    route = require('../../app/api/secure-proxy+api') as Route;
  });

  afterAll(() => {
    fetchSpy.mockRestore();
    process.env = saved;
  });

  const call = async (body: Record<string, unknown>, token = signToken('user_x')) => {
    const res = await route.POST(
      new Request('http://localhost/api/secure-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it.each([
    ['a worker without a name', { action: 'upsertWorker', worker: { name: ' ', role: 'Cook' } }, /name is required/],
    ['a worker with a non-UUID id', { action: 'upsertWorker', worker: { id: 'w-1', name: 'Ana', role: 'Cook' } }, /UUID/],
    ['a worker with 51 skills', { action: 'upsertWorker', worker: { name: 'Ana', role: 'Cook', skills: Array(51).fill('x') } }, /skills/],
    ['availability on a made-up day', { action: 'upsertAvailability', availability: { workerId: W1, dayOfWeek: 'Funday', fromTime: '09:00', toTime: '17:00' } }, /Mon–Sun/],
    ['zero-length availability', { action: 'upsertAvailability', availability: { workerId: W1, dayOfWeek: 'Mon', fromTime: '09:00', toTime: '09:00' } }, /differ/],
    ['availability at 24:00', { action: 'upsertAvailability', availability: { workerId: W1, dayOfWeek: 'Mon', fromTime: '24:00', toTime: '06:00' } }, /HH:MM/],
    ['a template with coverage 0', { action: 'upsertShiftTemplate', template: { name: 'A', role: 'B', startTime: '09:00', endTime: '17:00', coverage: 0 } }, /coverage/],
    ['a template with coverage "2"', { action: 'upsertShiftTemplate', template: { name: 'A', role: 'B', startTime: '09:00', endTime: '17:00', coverage: '2' } }, /coverage/],
    ['a shift on 2026-02-30', { action: 'upsertRosterShift', shift: { date: '2026-02-30', workerId: W1, templateId: T1 } }, /real YYYY-MM-DD/],
    ['a notified draft', { action: 'upsertRosterShift', shift: { date: '2026-11-02', workerId: W1, templateId: T1, status: 'Draft', notified: true } }, /published/],
    ['a shift with notified "yes"', { action: 'upsertRosterShift', shift: { date: '2026-11-02', workerId: W1, templateId: T1, notified: 'yes' } }, /true or false/],
    ['a 201-char shift location', { action: 'upsertRosterShift', shift: { date: '2026-11-02', workerId: W1, templateId: T1, location: 'x'.repeat(201) } }, /location/],
    ['a status other than Draft / Published', { action: 'updateShiftStatus', id: W1, status: 'Archived' }, /Draft or Published/],
    ['a status change for a non-UUID id', { action: 'updateShiftStatus', id: 'shift-1', status: 'Draft' }, /UUID/],
    ['a notify for a non-UUID id', { action: 'markShiftNotified', id: 'shift-1' }, /UUID/],
    ['an override with negative demand', { action: 'upsertTargets', targets: [{ date: '2026-11-02', role: 'Cook', required: -1 }] }, /required/],
    ['an override with 501-char notes', { action: 'upsertTargets', targets: [{ date: '2026-11-02', role: 'Cook', required: 2, notes: 'x'.repeat(501) }] }, /notes/],
    ['an override with confidence 80', { action: 'upsertTargets', targets: [{ date: '2026-11-02', role: 'Cook', required: 2, confidence: 80 }] }, /confidence/],
    ['an override with crossed bounds', { action: 'upsertTargets', targets: [{ date: '2026-11-02', role: 'Cook', required: 2, lowerBound: 5, upperBound: 1 }] }, /lowerBound/],
    ['an override delete without a role', { action: 'deleteDemandTarget', target: { date: '2026-11-02' } }, /role/],
    ['a list page past the limit', { action: 'listWorkers', page: 20 }, /page/],
    ['a negative roster page', { action: 'listRoster', page: -1 }, /page/],
    ['a fractional overrides page', { action: 'loadTargets', page: 1.5 }, /page/],
  ])('rejects %s with 400 before touching the database', async (_label, body, message) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(message);
  });

  it('lets only admins delete an override', async () => {
    const member = signToken('user_m', { claims: { o: { id: 'org_m', rol: 'org:member' } } });
    expect((await call({ action: 'deleteDemandTarget', target: { date: '2026-11-02', role: 'Cook' } }, member)).status).toBe(403);
  });
});

describe('scheduling validators (shared by client and proxy)', () => {
  it('returns an explicit object: unknown fields are dropped and text is trimmed', () => {
    expect(validateWorkerInput({ name: ' Ana ', role: 'Cook ', accountId: 'other', created_at: 'x', skills: [' Grill '] })).toEqual({
      ok: true,
      value: { name: 'Ana', role: 'Cook', skills: ['Grill'] },
    });
    expect(validateShiftTemplateInput({ id: T1, name: 'Night', role: 'Cook', startTime: '22:00', endTime: '06:00', coverage: 2, account_id: 'x' })).toEqual({
      ok: true,
      value: { id: T1, name: 'Night', role: 'Cook', startTime: '22:00', endTime: '06:00', coverage: 2 },
    });
    expect(validateAvailabilityInput({ workerId: W1, dayOfWeek: 'Sun', fromTime: '21:00', toTime: '07:00', extra: true })).toEqual({
      ok: true,
      value: { workerId: W1, dayOfWeek: 'Sun', fromTime: '21:00', toTime: '07:00' },
    });
  });

  it('defaults a shift to an un-notified draft and allows notifying a published one', () => {
    expect(validateRosterShiftInput({ date: '2026-11-02', workerId: W1, templateId: T1 })).toEqual({
      ok: true,
      value: { date: '2026-11-02', workerId: W1, templateId: T1, location: '', status: 'Draft', notified: false },
    });
    expect(validateRosterShiftInput({ date: '2026-11-02', workerId: W1, templateId: T1, status: 'Published', notified: true, location: ' Bar ' })).toMatchObject({
      ok: true,
      value: { status: 'Published', notified: true, location: 'Bar' },
    });
  });

  it('keeps an override to its stored columns, rounding the headcount', () => {
    expect(validateDemandTargetInput({ date: '2026-11-02', role: 'Cook', required: 2.6, source: 'model', expected: 9, notes: '  ' })).toEqual({
      ok: true,
      value: { date: '2026-11-02', role: 'Cook', required: 3, notes: null, confidence: null, lowerBound: null, upperBound: null },
    });
  });

  it('keeps labor attributes absent when the payload leaves them out', () => {
    const result = validateWorkerInput({ name: 'Ana', role: 'Cook' });
    expect(result.ok && 'nightWorker' in result.value).toBe(false);
  });

  it('makes v4 UUIDs the proxy accepts', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
