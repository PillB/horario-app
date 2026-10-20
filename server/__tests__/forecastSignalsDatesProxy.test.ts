/**
 * @jest-environment node
 *
 * CHG-087 / QA F4 and F5 on the secure proxy.
 *
 * F4: listForecastSignals read [from, to) oldest first with limit 1000, so a tenant with
 * many signals lost the newest ones first: the future dates being forecast. Now the
 * target span is read first and a `truncated` flag is returned.
 *
 * F5: isISODate accepted impossible dates (2026-02-31), which Postgres then rejected
 * with a 500. Now they are a 400 for every action that takes a date.
 *
 * Supabase is replaced by a fake query builder that records each query's calls and
 * answers from `mockAnswer`.
 */
import { installJwksFetch, signToken, TEST_JWKS_URL } from '../testUtils/testTokens';

type Call = { method: string; args: unknown[] };
type Reply = { data: unknown[] | null; error: { message: string } | null; count?: number | null };

const mockQueries: { table: string; calls: Call[] }[] = [];
let mockAnswer: (table: string, calls: Call[]) => Reply = () => ({ data: [], error: null });

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const query = { table, calls: [] as Call[] };
      mockQueries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'gte', 'lt', 'lte', 'in', 'order', 'range', 'limit', 'upsert', 'delete', 'maybeSingle', 'single']) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (r: Reply) => unknown) => Promise.resolve(mockAnswer(table, query.calls)).then(resolve);
      return builder;
    },
  }),
}));

type Route = { POST: (req: Request) => Promise<Response> };

const argOf = (calls: Call[], method: string, column = 'date'): unknown =>
  calls.find((c) => c.method === method && c.args[0] === column)?.args[1];

/** `n` signals one per day from `start`, ascending. */
const signals = (start: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    return { date: d, role: 'global', signal_type: 'event', weight: '1.1' };
  });

describe('secure proxy: forecast signals and date validation (CHG-087)', () => {
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
    mockQueries.length = 0;
    mockAnswer = () => ({ data: [], error: null });
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

  /**
   * A table of 1200 past signals (two a day, 2024-01-01 … 2025-08-22) and 20 future ones
   * (from 2026-03-08), answered like Postgres would: filtered by the window, sorted, limited.
   */
  const past = signals('2024-01-01', 600);
  const store = [...past, ...past.map((s) => ({ ...s, signal_type: 'weather' })), ...signals('2026-03-08', 20)];
  const answerFromStore = (_table: string, calls: Call[]): Reply => {
    const gte = String(argOf(calls, 'gte'));
    const lt = String(argOf(calls, 'lt'));
    const order = calls.find((c) => c.method === 'order')?.args[1] as { ascending: boolean };
    const limit = Number(calls.find((c) => c.method === 'limit')?.args[0]);
    const rows = store.filter((s) => s.date >= gte && s.date < lt).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!order.ascending) rows.reverse();
    return { data: rows.slice(0, limit), error: null };
  };

  describe('F4: listForecastSignals', () => {
    it('keeps every future signal and flags that old ones were left out', async () => {
      mockAnswer = answerFromStore;
      const res = await call({ action: 'listForecastSignals', from: '2024-01-01', to: '2026-03-28', targetsFrom: '2026-03-08' });
      expect(res.status).toBe(200);
      const dates = (res.body.signals as { date: string }[]).map((s) => s.date);
      expect(dates).toHaveLength(1000);
      expect(dates.filter((d) => d >= '2026-03-08')).toHaveLength(20);
      // The newest past signals are kept, the oldest dropped.
      expect(dates).toContain('2025-08-22');
      expect(dates).not.toContain('2024-01-01');
      expect(res.body.truncated).toBe(true);
      // Two tenant-scoped queries: the target span ascending, the history descending.
      const queries = mockQueries.filter((q) => q.table === 'external_signals');
      expect(queries).toHaveLength(2);
      for (const q of queries) expect(q.calls).toEqual(expect.arrayContaining([{ method: 'eq', args: ['account_id', 'user_a'] }]));
      expect(queries.map((q) => [argOf(q.calls, 'gte'), argOf(q.calls, 'lt')])).toEqual([
        ['2026-03-08', '2026-03-28'],
        ['2024-01-01', '2026-03-08'],
      ]);
    });

    it('without targetsFrom reads newest first, so the future survives too', async () => {
      mockAnswer = answerFromStore;
      const res = await call({ action: 'listForecastSignals', from: '2024-01-01', to: '2026-03-28' });
      const dates = (res.body.signals as { date: string }[]).map((s) => s.date);
      expect(dates.filter((d) => d >= '2026-03-08')).toHaveLength(20);
      expect(res.body.truncated).toBe(true);
    });

    it('is not truncated when everything fits', async () => {
      mockAnswer = answerFromStore;
      const res = await call({ action: 'listForecastSignals', from: '2026-01-01', to: '2026-03-28', targetsFrom: '2026-03-08' });
      expect(res.body.truncated).toBe(false);
      expect((res.body.signals as unknown[]).length).toBe(20);
    });

    it.each([
      ['an impossible date', '2026-02-31'],
      ['a date before from', '2023-12-31'],
      ['a date after to', '2026-04-01'],
    ])('rejects targetsFrom as %s', async (_label, targetsFrom) => {
      const res = await call({ action: 'listForecastSignals', from: '2024-01-01', to: '2026-03-28', targetsFrom });
      expect(res.status).toBe(400);
      expect(mockQueries).toEqual([]);
    });
  });

  describe('F5: impossible dates are a 400', () => {
    it.each([
      ['forecastHistory from', { action: 'forecastHistory', from: '2026-02-31', to: '2026-03-10' }],
      ['forecastHistory to', { action: 'forecastHistory', from: '2026-01-01', to: '2026-04-31' }],
      ['listForecastSignals', { action: 'listForecastSignals', from: '2025-02-29', to: '2026-03-10' }],
      ['forecast filters', { action: 'forecast', filters: { date: '2026-02-30' } }],
      ['status filters', { action: 'status', filters: { date: '2026-02-30' } }],
      ['loadTargets filters', { action: 'loadTargets', filters: { date: '2026-06-31' } }],
      ['upsertTargets', { action: 'upsertTargets', targets: [{ date: '2026-02-31', role: 'Cook', required: 2 }] }],
      ['listRoster', { action: 'listRoster', fromDate: '2026-09-31' }],
    ])('%s', async (_label, body) => {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(mockQueries).toEqual([]);
    });

    it('still accepts real dates, including 29 February in a leap year', async () => {
      const res = await call({ action: 'forecastHistory', from: '2024-02-29', to: '2024-03-10' });
      expect(res.status).toBe(200);
    });
  });
});
