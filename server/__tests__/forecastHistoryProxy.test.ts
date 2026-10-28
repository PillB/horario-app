/**
 * @jest-environment node
 *
 * Forecast history actions of the secure proxy: they only read and sum rows
 * (the model is fitted on the client). Supabase is replaced by a recording
 * fake query builder; no database needed.
 */
import { installJwksFetch, signToken, TEST_JWKS_URL } from '../testUtils/testTokens';

type Call = { method: string; args: unknown[] };
type Reply = { data: unknown[] | null; error: { message: string } | null; count?: number | null };

const mockCalls: Call[] = [];
let mockTables: string[] = [];
let mockReply: Reply = { data: [], error: null };

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      mockTables.push(table);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'range', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          mockCalls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (r: Reply) => unknown) => Promise.resolve(mockReply).then(resolve);
      return builder;
    },
  }),
}));

type Route = { POST: (req: Request) => Promise<Response> };

describe('secure proxy forecast history actions', () => {
  let route: Route;
  let fetchSpy: jest.SpyInstance;
  const saved = { ...process.env };

  beforeAll(() => {
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    delete process.env.CLERK_AUTHORIZED_PARTIES;
    delete process.env.EXPO_PUBLIC_FORECAST_API_URL;
    fetchSpy = installJwksFetch();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
    route = require('../../app/api/secure-proxy+api') as Route;
  });

  afterAll(() => {
    fetchSpy.mockRestore();
    process.env = saved;
  });

  beforeEach(() => {
    mockCalls.length = 0;
    mockTables = [];
    mockReply = { data: [], error: null };
  });

  const call = async (body: Record<string, unknown>) => {
    const res = await route.POST(
      new Request('http://localhost/api/secure-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_a')}` },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it.each([
    ['missing dates', {}, /YYYY-MM-DD/],
    ['an empty window', { from: '2026-03-01', to: '2026-03-01' }, /before/],
    ['a window over 1100 days', { from: '2023-01-01', to: '2026-03-01' }, /limited/],
    ['a bad page', { from: '2026-01-01', to: '2026-03-01', page: 40 }, /page/],
    ['a negative page', { from: '2026-01-01', to: '2026-03-01', page: -1 }, /page/],
    ['an empty role', { from: '2026-01-01', to: '2026-03-01', role: '' }, /role/],
  ])('rejects %s with 400 before querying', async (_label, params, message) => {
    const res = await call({ action: 'forecastHistory', ...params });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(message);
    expect(mockTables).toEqual([]);
  });

  it('sums one page of shifts per date and role, scoped to the tenant, newest first', async () => {
    mockReply = {
      data: [
        { date: '2026-02-28', role: 'Cook', hours: 8 },
        { date: '2026-02-28', role: 'Cook', hours: 6 },
        { date: '2026-02-28', role: 'Host', hours: 4 },
        { date: '2026-02-27', role: 'Cook', hours: null },
      ],
      error: null,
      count: 2500,
    };
    const res = await call({ action: 'forecastHistory', from: '2026-01-01', to: '2026-03-01' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      days: [
        { date: '2026-02-28', role: 'Cook', shifts: 2, hours: 14 },
        { date: '2026-02-28', role: 'Host', shifts: 1, hours: 4 },
        { date: '2026-02-27', role: 'Cook', shifts: 1, hours: 0 },
      ],
      page: 0,
      pageSize: 1000,
      rows: 4,
      total: 2500,
    });
    expect(mockTables).toEqual(['shifts']);
    expect(mockCalls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['account_id', 'user_a'] },
        { method: 'gte', args: ['date', '2026-01-01'] },
        { method: 'lt', args: ['date', '2026-03-01'] },
        { method: 'order', args: ['date', { ascending: false }] },
        { method: 'range', args: [0, 999] },
      ]),
    );
  });

  it('pages with range and filters by role', async () => {
    await call({ action: 'forecastHistory', from: '2026-01-01', to: '2026-03-01', role: 'Cook', page: 2 });
    expect(mockCalls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['role', 'Cook'] },
        { method: 'range', args: [2000, 2999] },
      ]),
    );
  });

  it("returns signals for a role together with the global ones", async () => {
    mockReply = { data: [{ date: '2026-03-02', role: 'global', signal_type: 'holiday', weight: '1.5000' }], error: null };
    const res = await call({ action: 'listForecastSignals', from: '2026-01-01', to: '2026-03-15', role: 'Cook' });
    expect(res.status).toBe(200);
    expect(res.body.signals).toEqual([{ date: '2026-03-02', role: 'global', signal_type: 'holiday', weight: 1.5 }]);
    expect(mockTables).toEqual(['external_signals']);
    expect(mockCalls).toEqual(expect.arrayContaining([{ method: 'in', args: ['role', ['Cook', 'global']] }]));
  });

  it('the forecast action no longer computes averages without the external API', async () => {
    mockReply = { data: [{ date: '2026-03-02', role: 'Cook', worker_id: 'w1', hours: 8 }], error: null };
    const res = await call({ action: 'forecast', filters: { date: '2026-03-02', role: 'Cook' } });
    expect(res.status).toBe(200);
    expect(res.body.forecasts).toEqual([]);
    expect(res.body.metadata).toMatchObject({ usedApi: false, usedFallback: true, apiAvailable: false });
  });

  it('reports a database error without details', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockReply = { data: null, error: { message: 'relation "shifts" does not exist' } };
    const res = await call({ action: 'forecastHistory', from: '2026-01-01', to: '2026-03-01' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/relation/);
  });
});
