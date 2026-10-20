/**
 * @jest-environment node
 *
 * Worker labor attributes in the secure proxy, checked before any database
 * call. No database needed (same harness as locationsProxy.test.ts).
 */
import { installJwksFetch, signToken, TEST_JWKS_URL } from '../testUtils/testTokens';
import { validateBirthDate, validateWorkerLabor } from '@/utils/workerLaborValidation';

type Route = { POST: (req: Request) => Promise<Response> };

describe('secure proxy worker labor attributes (no database)', () => {
  let route: Route;
  let fetchSpy: jest.SpyInstance;
  const saved = { ...process.env };

  beforeAll(() => {
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    // Never contacted: every request below is answered before a query runs.
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

  const upsert = async (worker: Record<string, unknown>) => {
    const res = await route.POST(
      new Request('http://localhost/api/secure-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken('user_x')}` },
        body: JSON.stringify({ action: 'upsertWorker', worker }),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  const valid = { name: 'Ana', role: 'Clerk', skills: [] };

  it.each([
    ['a malformed birth date', { birthDate: '17/04/2001' }, /real date/],
    ['an impossible calendar day', { birthDate: '2001-02-30' }, /real date/],
    ['a birth date before 1900', { birthDate: '1899-12-31' }, /real date/],
    ['a non-string birth date', { birthDate: 20010417 }, /real date/],
    ['a future birth date', { birthDate: '2999-01-01' }, /in the past/],
    ['a worker under 13', { birthDate: `${new Date().getUTCFullYear() - 5}-01-01` }, /at least 13/],
    ['a string flag', { nightWorker: 'yes' }, /true or false/],
    ['a numeric flag', { weeklyLimitOptOut: 1 }, /true or false/],
    ['a null flag', { noFixedHours: null }, /true or false/],
  ])('rejects %s with 400', async (_label, labor, message) => {
    const res = await upsert({ ...valid, ...labor });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(message);
  });
});

describe('validateWorkerLabor', () => {
  const TODAY = '2026-10-20';

  it('accepts valid attributes and leaves absent ones out', () => {
    expect(validateWorkerLabor({ birthDate: '2001-04-17', nightWorker: true }, TODAY)).toEqual({
      ok: true,
      values: { birthDate: '2001-04-17', nightWorker: true },
    });
    expect(validateWorkerLabor({}, TODAY)).toEqual({ ok: true, values: {} });
  });

  it('clears the birth date with null or an empty string', () => {
    expect(validateWorkerLabor({ birthDate: null }, TODAY)).toEqual({ ok: true, values: { birthDate: null } });
    expect(validateWorkerLabor({ birthDate: '' }, TODAY)).toEqual({ ok: true, values: { birthDate: null } });
  });

  it('allows a worker who turns 13 today but not one who turns 13 tomorrow', () => {
    expect(validateBirthDate('2013-10-20', TODAY)).toBeNull();
    expect(validateBirthDate('2013-10-21', TODAY)).toBe('BIRTH_DATE_TOO_YOUNG');
  });

  it('treats a 29 February birthday as reached on 1 March in a non-leap year', () => {
    expect(validateBirthDate('2012-02-29', '2025-02-28')).toBe('BIRTH_DATE_TOO_YOUNG');
    expect(validateBirthDate('2012-02-29', '2025-03-01')).toBeNull();
  });

  it('rejects today as a birth date', () => {
    expect(validateBirthDate(TODAY, TODAY)).toBe('BIRTH_DATE_FUTURE');
  });
});
