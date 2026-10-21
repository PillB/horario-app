/**
 * @jest-environment node
 *
 * Location change history and stricter-only overrides through the secure
 * proxy against a real local Supabase (CHG-089). Skipped unless
 * SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_KEY are set (see
 * proxyTenantIsolation.integration.test.ts).
 */
import { randomUUID } from 'crypto';

import { installJwksFetch, signToken, TEST_JWKS_URL } from '../testUtils/testTokens';
import type { LocationHistoryEntry } from '@/utils/locationValidation';

const SUPABASE_URL = process.env.SUPABASE_TEST_URL;
const SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY;
const describeIfDb = SUPABASE_URL && SERVICE_KEY ? describe : describe.skip;

type Route = { POST: (req: Request) => Promise<Response> };

const run = randomUUID().slice(0, 8);
const USER_A = `user_ha_${run}`;
const USER_B = `user_hb_${run}`;
const ORG_B = `org_hb_${run}`;

describeIfDb('location history and overrides (local Supabase)', () => {
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
  const asA = (body: Record<string, unknown>) => call(signToken(USER_A), body);
  const asB = (body: Record<string, unknown>) => call(signToken(USER_B, { claims: { o: { id: ORG_B, rol: 'org:admin' } } }), body);
  const historyOf = async (asCaller: typeof asA, locationId?: string) => {
    const res = await asCaller({ action: 'listLocationHistory', ...(locationId ? { locationId } : {}) });
    expect(res.status).toBe(200);
    return res.body.history as LocationHistoryEntry[];
  };

  beforeAll(() => {
    process.env.CLERK_JWKS_URL = TEST_JWKS_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    fetchSpy = installJwksFetch();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- load after env is set
    route = require('../../app/api/secure-proxy+api') as Route;
  });

  afterAll(() => fetchSpy.mockRestore());

  const lima = { name: 'Lima', countryCode: 'PE', jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service', employerHeadcount: 12 };
  const madrid = { name: 'Madrid', countryCode: 'ES', jurisdictionCode: 'ES', timeZone: 'Europe/Madrid', industry: 'retail', employerHeadcount: 40 };

  it('records who changed what, and when, for every upsert and delete', async () => {
    const created = await asA({ action: 'upsertLocation', location: lima });
    expect(created.status).toBe(200);
    const id = (created.body.location as { id: string }).id;

    const moved = await asA({
      action: 'upsertLocation',
      location: { ...madrid, id, overrides: [{ rule: 'rest.minHours', value: 13, note: 'Convenio' }] },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.location).toMatchObject({ jurisdictionCode: 'ES', overrides: [{ rule: 'rest.minHours', value: 13, note: 'Convenio' }] });

    // A rejected change leaves no trace.
    const laxer = await asA({ action: 'upsertLocation', location: { ...madrid, id, overrides: [{ rule: 'rest.minHours', value: 10 }] } });
    expect(laxer.status).toBe(400);
    expect(String(laxer.body.error)).toMatch(/not stricter than the law in Spain/);

    expect((await asA({ action: 'deleteLocation', id })).status).toBe(200);

    const history = await historyOf(asA, id);
    expect(history.map((h) => h.action)).toEqual(['delete', 'update', 'insert']);
    expect(history.every((h) => h.changedBy === USER_A && h.locationId === id)).toBe(true);
    const [deleted, updated, inserted] = history;
    expect(inserted.old).toBeNull();
    expect(inserted.new).toEqual({ jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service', employerHeadcount: 12, overrides: [] });
    expect(updated.old).toMatchObject({ jurisdictionCode: 'PE', timeZone: 'America/Lima', industry: 'food_service', employerHeadcount: 12, overrides: [] });
    expect(updated.new).toMatchObject({
      jurisdictionCode: 'ES', timeZone: 'Europe/Madrid', industry: 'retail', employerHeadcount: 40,
      overrides: [{ rule: 'rest.minHours', value: 13, note: 'Convenio' }],
    });
    expect(deleted.new).toBeNull();
    expect(deleted.old).toMatchObject({ jurisdictionCode: 'ES', overrides: [{ rule: 'rest.minHours', value: 13, note: 'Convenio' }] });
    expect(Date.parse(deleted.changedAt)).toBeGreaterThanOrEqual(Date.parse(inserted.changedAt));
  });

  it('shows each tenant only its own history', async () => {
    const created = await asB({ action: 'upsertLocation', location: lima });
    const idB = (created.body.location as { id: string }).id;
    const bHistory = await historyOf(asB);
    expect(bHistory.length).toBeGreaterThan(0);
    expect(bHistory.every((h) => h.changedBy === USER_B)).toBe(true);
    expect(await historyOf(asA, idB)).toEqual([]);
    expect((await historyOf(asA)).some((h) => h.locationId === idB)).toBe(false);
    expect((await asB({ action: 'deleteLocation', id: idB })).status).toBe(200);
  });

  it('rechecks kept overrides when the jurisdiction changes', async () => {
    const santiago = { name: 'Santiago', countryCode: 'CL', jurisdictionCode: 'CL', timeZone: 'America/Santiago', industry: 'retail' };
    // Chile has no rest minimum, so an 11.5 h rest override is stricter there.
    const created = await asA({ action: 'upsertLocation', location: { ...santiago, overrides: [{ rule: 'rest.minHours', value: 11.5 }] } });
    expect(created.status).toBe(200);
    const id = (created.body.location as { id: string }).id;
    // An update that leaves overrides out keeps them; same jurisdiction, accepted.
    const renamed = await asA({ action: 'upsertLocation', location: { ...santiago, id, name: 'Santiago Centro' } });
    expect(renamed.body.location).toMatchObject({ name: 'Santiago Centro', overrides: [{ rule: 'rest.minHours', value: 11.5 }] });
    // Moving it to Spain (12 h) would keep an override laxer than the law: refused, nothing stored.
    const moved = await asA({ action: 'upsertLocation', location: { ...madrid, id } });
    expect(moved.status).toBe(400);
    expect(String(moved.body.error)).toMatch(/saved overrides do not fit the new jurisdiction.*12 h/);
    const listed = ((await asA({ action: 'listLocations' })).body.locations as { id: string; jurisdictionCode: string }[]).find((l) => l.id === id);
    expect(listed?.jurisdictionCode).toBe('CL');
    expect((await historyOf(asA, id)).map((h) => h.action)).toEqual(['update', 'insert']);
    // Sending stricter overrides with the move is accepted.
    expect((await asA({ action: 'upsertLocation', location: { ...madrid, id, overrides: [{ rule: 'rest.minHours', value: 12.5 }] } })).status).toBe(200);
    expect((await asA({ action: 'deleteLocation', id })).status).toBe(200);
  });
});
