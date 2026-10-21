/**
 * @jest-environment node
 *
 * Location actions of the secure proxy that are decided before any database
 * call: input validation and the admin-only delete. No database needed.
 */
import { installJwksFetch, signToken, TEST_JWKS_URL } from '../testUtils/testTokens';

type Route = { POST: (req: Request) => Promise<Response> };

describe('secure proxy location actions (no database)', () => {
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

  const valid = { name: 'Berkeley store', countryCode: 'US', regionCode: 'CA', cityCode: 'BERKELEY', jurisdictionCode: 'US-CA-BERKELEY', timeZone: 'America/Los_Angeles', industry: 'retail' };

  it.each([
    ['a pack that does not match the place', { ...valid, jurisdictionCode: 'US-CA' }, /does not match/],
    ['an unknown jurisdiction', { ...valid, jurisdictionCode: 'MARS' }, /not a known jurisdiction/],
    ['an invalid time zone', { ...valid, timeZone: 'Pacific/Nowhere' }, /IANA/],
    ['a long name', { ...valid, name: 'x'.repeat(81) }, /name/],
    ['an unknown industry', { ...valid, industry: 'casino' }, /industry/],
    ['a bad country code', { ...valid, countryCode: 'USA' }, /countryCode/],
    // CHG-089: overrides may only make the rules stricter.
    ['an override laxer than the law', { ...valid, countryCode: 'ES', regionCode: null, cityCode: null, jurisdictionCode: 'ES', timeZone: 'Europe/Madrid', overrides: [{ rule: 'rest.minHours', value: 10 }] }, /overrides\[0\]: a minimum rest of 10 h between shifts is not stricter than the law in Spain on \d{4}-\d{2}-\d{2}, which sets a minimum rest of 12 h between shifts\. A location override can only make a rule stricter\./],
    ['an override equal to the law', { ...valid, countryCode: 'FR', regionCode: null, cityCode: null, jurisdictionCode: 'FR', timeZone: 'Europe/Paris', overrides: [{ rule: 'weekly.maxHours', value: 48 }] }, /not stricter/],
    ['an override of an unknown rule', { ...valid, overrides: [{ rule: 'minWage', value: 20 }] }, /rule must be one of/],
    ['an untyped override', { ...valid, overrides: [{ note: 'free text' }] }, /rule must be one of/],
  ])('rejects %s with 400', async (_label, location, message) => {
    const res = await call(signToken('user_x'), { action: 'upsertLocation', location });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(message);
  });

  it('only lets an org admin create, change or delete a location', async () => {
    const member = signToken('user_m', { claims: { o: { id: 'org_m', rol: 'org:member' } } });
    expect((await call(member, { action: 'deleteLocation', id: '00000000-0000-0000-0000-000000000001' })).status).toBe(403);
    expect((await call(member, { action: 'upsertLocation', location: valid })).status).toBe(403);
  });

  it('rejects history queries with a bad location id or limit', async () => {
    for (const body of [{ locationId: 'abc' }, { limit: 0 }, { limit: 201 }, { limit: 1.5 }]) {
      const res = await call(signToken('user_x'), { action: 'listLocationHistory', ...body });
      expect(res.status).toBe(400);
    }
  });

  it('rejects a delete without a UUID', async () => {
    const res = await call(signToken('user_x'), { action: 'deleteLocation', id: 'abc' });
    expect(res.status).toBe(400);
  });

  it('requires a session', async () => {
    const res = await route.POST(
      new Request('http://localhost/api/secure-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'listLocations' }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
