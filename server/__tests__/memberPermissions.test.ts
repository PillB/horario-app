/**
 * @jest-environment node
 *
 * Who may call which secure-proxy action (CHG-091, QA step 3c G1). Every
 * scheduling write is manager-only: a personal account, or an admin of the
 * organization. A member (`org:member`) keeps every read and their own
 * per-user data. The 403 comes before any database call, so no database is
 * needed (the Supabase URL points nowhere).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { installJwksFetch, signToken, TEST_JWKS_URL } from '../testUtils/testTokens';

type Route = { POST: (req: Request) => Promise<Response> };

const W1 = '11111111-1111-4111-8111-111111111111';
const T1 = '33333333-3333-4333-8333-333333333333';

/** One valid-looking payload per manager-only action. */
const MANAGER_ONLY: Record<string, Record<string, unknown>> = {
  // Includes the labor attributes (see the weekly-limit opt-out test below).
  upsertWorker: { worker: { name: 'Ana', role: 'Cook', nightWorker: true } },
  deleteWorker: { id: W1 },
  upsertAvailability: { availability: { workerId: W1, dayOfWeek: 'Mon', fromTime: '09:00', toTime: '17:00' } },
  deleteAvailability: { id: W1 },
  upsertShiftTemplate: { template: { name: 'Early', role: 'Cook', startTime: '06:00', endTime: '14:00', coverage: 1 } },
  deleteShiftTemplate: { id: T1 },
  upsertRosterShift: { shift: { date: '2026-11-02', workerId: W1, templateId: T1 } },
  updateShiftStatus: { id: W1, status: 'Published' },
  markShiftNotified: { id: W1 },
  deleteRosterShift: { id: W1 },
  upsertTargets: { targets: [{ date: '2026-11-02', role: 'Cook', required: 2 }] },
  deleteDemandTarget: { target: { date: '2026-11-02', role: 'Cook' } },
  uploadPosSales: { rows: [{ date: '2026-11-02', revenue: 100 }] },
  upsertLocation: { location: { name: 'HQ' } },
  deleteLocation: { id: W1 },
  cancelSubscription: {},
  createCheckoutSession: {},
  createBillingPortalSession: {},
};

/** Open to members: reads, a forecast (model rows are stored only for a manager), their own per-user data. */
const MEMBER_OPEN = [
  'forecast',
  'status',
  'forecastHistory',
  'listForecastSignals',
  'loadTargets',
  'getOnboarding',
  'upsertOnboarding',
  'listWorkers',
  'listWorkerAvailability',
  'listShiftTemplates',
  'listRoster',
  'listLocations',
  'listLocationHistory',
  'getUsageLimit',
  'incrementAutoAssign',
  'listPosSales',
  'getSubscription',
];

const SCHEDULE_MESSAGE = /Only an admin of this business can change the schedule/;

describe('secure proxy: member vs manager actions (no database)', () => {
  let route: Route;
  let fetchSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  const saved = { ...process.env };

  beforeAll(() => {
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    delete process.env.CLERK_AUTHORIZED_PARTIES;
    delete process.env.EXPO_PUBLIC_FORECAST_API_URL;
    fetchSpy = installJwksFetch();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
    route = require('../../app/api/secure-proxy+api') as Route;
  });

  afterAll(() => {
    fetchSpy.mockRestore();
    errorSpy.mockRestore();
    process.env = saved;
  });

  const member = () => signToken('user_member', { claims: { o: { id: 'org_perm', rol: 'org:member' } } });
  const admin = () => signToken('user_admin', { claims: { o: { id: 'org_perm', rol: 'org:admin' } } });
  const personal = () => signToken('user_solo');

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

  it('classifies every action the dispatcher handles', () => {
    const source = readFileSync(join(__dirname, '../../app/api/secure-proxy+api.ts'), 'utf8');
    const dispatch = source.slice(source.indexOf('async function dispatch('), source.indexOf('export async function POST('));
    const actions = [...dispatch.matchAll(/case '(\w+)':/g)].map((m) => m[1]).sort();
    expect(actions).toEqual([...Object.keys(MANAGER_ONLY), ...MEMBER_OPEN].sort());
  });

  it.each(Object.entries(MANAGER_ONLY))('refuses %s to an org member with 403', async (action, payload) => {
    const res = await call(member(), { action, ...payload });
    expect(res.status).toBe(403);
    expect(String(res.body.error)).toMatch(/Only an admin of this business/);
  });

  it('explains a refused scheduling write in words the banner can show', async () => {
    const res = await call(member(), { action: 'upsertWorker', worker: { name: 'Ana', role: 'Cook', weeklyLimitOptOut: true } });
    expect(res.status).toBe(403);
    expect(String(res.body.error)).toMatch(SCHEDULE_MESSAGE);
  });

  it.each(Object.keys(MANAGER_ONLY))('lets an org admin and a personal account past the check for %s', async (action) => {
    // Invalid payloads: a 400 shows the request passed the role check without touching the database.
    for (const token of [admin(), personal()]) {
      const res = await call(token, { action, id: 'not-a-uuid' });
      expect(res.status).not.toBe(403);
    }
  });

  it.each(MEMBER_OPEN)('lets an org member call %s', async (action) => {
    const res = await call(member(), { action });
    expect(res.status).not.toBe(403);
  });
});
