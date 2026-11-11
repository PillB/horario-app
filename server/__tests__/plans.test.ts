/**
 * @jest-environment node
 *
 * The plan in force (server/plans.ts) and the price list (constants/pricing.ts),
 * checked against the product research: Gratis / Esencial / Pro, per location,
 * US$19 / S/ 59 and US$39 / S/ 119 a month, a year for the price of ten months,
 * 10 / 40 / unlimited people, 3 auto-schedules a month on Gratis, 14-day Pro trial.
 */
import {
  ANNUAL_MONTHS_FREE,
  FEATURE_GATES,
  TIERS,
  TIER_LIMITS,
  TIER_PRICES_USD,
  TRIAL_DAYS,
  formatPlanPrice,
  nextTier,
  pricesForCountry,
  tierCanAccessFeature,
  tierFromLegacy,
} from '@/constants/pricing';
import { effectivePlanFrom, gatedClient, PlanRefusal, type EntitlementRow } from '@/server/plans';

const NOW = new Date('2026-11-11T12:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString();

const row = (over: Partial<EntitlementRow>): EntitlementRow => ({
  id: 'e1',
  account_id: 'acct',
  plan: 'pro',
  source: 'trial',
  starts_at: day(-1),
  ends_at: day(13),
  location_quota: null,
  granted_by: 'system',
  reason: null,
  revoked_at: null,
  revoked_by: null,
  created_at: day(-1),
  ...over,
});

describe('price list', () => {
  it('has the three plans and the researched prices', () => {
    expect(TIERS).toEqual(['gratis', 'esencial', 'pro']);
    expect(TIER_PRICES_USD).toEqual({
      gratis: { monthly: 0, annual: 0 },
      esencial: { monthly: 19, annual: 190 },
      pro: { monthly: 39, annual: 390 },
    });
    const pe = pricesForCountry('pe');
    expect([pe.esencial, pe.pro]).toEqual([{ monthly: 59, annual: 590 }, { monthly: 119, annual: 1190 }]);
    expect(pe.taxIncluded).toBe(true);
    expect(ANNUAL_MONTHS_FREE).toBe(2);
    expect(TRIAL_DAYS).toBe(14);
  });

  it('charges every other country the USD list', () => {
    for (const country of ['US', 'MX', 'DE', '', null, undefined]) {
      expect(pricesForCountry(country)).toMatchObject({ currency: 'USD', esencial: { monthly: 19 } });
    }
    expect(formatPlanPrice(1190, pricesForCountry('PE'))).toBe('S/ 1,190');
    expect(formatPlanPrice(19, pricesForCountry('US'))).toBe('US$19');
  });

  it('has the researched limits and gates', () => {
    expect(TIER_LIMITS.gratis).toEqual({ maxWorkers: 10, maxLocations: 1, maxAutoSchedulesPerMonth: 3 });
    expect(TIER_LIMITS.esencial).toMatchObject({ maxWorkers: 40, maxAutoSchedulesPerMonth: Infinity });
    expect(TIER_LIMITS.pro).toMatchObject({ maxWorkers: Infinity, maxLocations: Infinity });
    expect(tierCanAccessFeature('gratis', 'labor_law.warnings')).toBe(true);
    expect(tierCanAccessFeature('esencial', 'demand_forecast')).toBe(false);
    expect(tierCanAccessFeature('pro', 'demand_forecast')).toBe(true);
    expect(tierCanAccessFeature('pro', 'not.a.feature')).toBe(true);
    expect(tierCanAccessFeature('esencial', 'not.a.feature')).toBe(false);
    expect(new Set(Object.values(FEATURE_GATES))).toEqual(new Set(TIERS));
    expect([nextTier('gratis'), nextTier('esencial'), nextTier('pro')]).toEqual(['esencial', 'pro', null]);
  });

  it('maps the four old tier names', () => {
    expect(['free', 'starter', 'growth', 'pro', 'gratis', 'esencial', undefined, 'x'].map(tierFromLegacy)).toEqual([
      'gratis', 'esencial', 'pro', 'pro', 'gratis', 'esencial', 'gratis', 'gratis',
    ]);
  });
});

describe('effectivePlanFrom', () => {
  it('is Gratis with nothing active', () => {
    expect(effectivePlanFrom([], null, NOW)).toEqual({
      plan: 'gratis',
      source: 'default',
      endsAt: null,
      isTrial: false,
      trialEndsAt: null,
      limits: { maxWorkers: 10, maxLocations: 1, maxAutoSchedulesPerMonth: 3 },
    });
  });

  it('is Pro during the trial, without limits', () => {
    const plan = effectivePlanFrom([row({})], null, NOW);
    expect(plan).toMatchObject({ plan: 'pro', source: 'trial', isTrial: true, endsAt: day(13), trialEndsAt: day(13) });
    expect(plan.limits).toEqual({ maxWorkers: null, maxLocations: null, maxAutoSchedulesPerMonth: null });
  });

  it.each([
    ['ended', row({ starts_at: day(-20), ends_at: day(-6) })],
    ['ends this instant', row({ ends_at: NOW.toISOString() })],
    ['revoked', row({ revoked_at: day(-1), revoked_by: 'admin' })],
    ['not started', row({ starts_at: day(1), ends_at: day(15) })],
    ['unknown plan name', row({ plan: 'growth' })],
  ])('ignores a grant that is %s', (_label, entitlement) => {
    const plan = effectivePlanFrom([entitlement], null, NOW);
    expect(plan.plan).toBe('gratis');
    expect(plan.isTrial).toBe(false);
  });

  it('takes the highest active plan', () => {
    const rows = [row({ id: 'a', plan: 'esencial', source: 'tester', ends_at: day(90) }), row({ id: 'b' })];
    expect(effectivePlanFrom(rows, null, NOW)).toMatchObject({ plan: 'pro', source: 'trial', isTrial: true });
    // When the trial is over, the tester grant is what is left.
    const later = new Date(NOW.getTime() + 20 * 86_400_000);
    expect(effectivePlanFrom(rows, null, later)).toMatchObject({ plan: 'esencial', source: 'tester', isTrial: false, trialEndsAt: day(13) });
  });

  it('prefers a paid or granted Pro to the trial, and the longest one', () => {
    const rows = [row({ id: 't' }), row({ id: 'c', source: 'comp', ends_at: day(30) }), row({ id: 'p', source: 'paddle', ends_at: null })];
    expect(effectivePlanFrom(rows, null, NOW)).toMatchObject({ plan: 'pro', source: 'paddle', isTrial: false, endsAt: null });
  });

  it('counts an active subscription row, under its old or new name', () => {
    expect(effectivePlanFrom([], { tier: 'starter', status: 'active', current_period_end: day(20) }, NOW)).toMatchObject({
      plan: 'esencial', source: 'subscription', endsAt: day(20),
    });
    expect(effectivePlanFrom([], { tier: 'pro', status: 'trialing' }, NOW).plan).toBe('pro');
    for (const status of ['past_due', 'cancelled', 'unpaid', undefined]) {
      expect(effectivePlanFrom([], { tier: 'pro', status }, NOW).plan).toBe('gratis');
    }
    expect(effectivePlanFrom([], { tier: 'gratis', status: 'active' }, NOW).source).toBe('default');
  });

  it('uses the location quota of the winning grant', () => {
    const rows = [row({ plan: 'esencial', source: 'paddle', ends_at: null, location_quota: 3 })];
    expect(effectivePlanFrom(rows, null, NOW).limits).toEqual({ maxWorkers: 40, maxLocations: 3, maxAutoSchedulesPerMonth: null });
  });
});

describe('gatedClient', () => {
  type Reply = { data: unknown; error: null; count?: number };
  const fakeClient = (answers: Record<string, Reply>, log: string[]) => {
    const builder = (table: string): Record<string, unknown> => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'order', 'limit', 'insert', 'update', 'delete', 'maybeSingle', 'single']) b[m] = () => b;
      b.then = (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) => {
        log.push(table);
        return Promise.resolve(answers[table] ?? { data: null, error: null }).then(resolve, reject);
      };
      return b;
    };
    return { from: builder, rpc: (name: string) => builder(`rpc:${name}`) } as never;
  };
  const WRITES = new Set(['upsertWorker', 'deleteWorker']);
  const expiredTrial = row({ starts_at: day(-30), ends_at: day(-16) });

  it('does not look at the plan for an action that is not gated', async () => {
    const log: string[] = [];
    const client = gatedClient(fakeClient({}, log), 'acct', { action: 'listWorkers' }, WRITES);
    await client.from('workers').select('id');
    expect(log).toEqual(['workers']);
  });

  it('checks the plan once, at the first request, and lets a Pro account through', async () => {
    const log: string[] = [];
    const client = gatedClient(fakeClient({ account_entitlements: { data: [row({})], error: null } }, log), 'acct', { action: 'forecastHistory' }, WRITES);
    await client.from('shifts').select('date');
    await client.from('shifts').select('date');
    expect(log).toEqual(['account_entitlements', 'subscriptions', 'shifts', 'shifts']);
  });

  it('refuses the forecast on Gratis before the data is read', async () => {
    const log: string[] = [];
    const client = gatedClient(fakeClient({ account_entitlements: { data: [expiredTrial], error: null } }, log), 'acct', { action: 'forecastHistory' }, WRITES);
    await expect(client.from('shifts').select('date')).rejects.toBeInstanceOf(PlanRefusal);
    await expect(client.rpc('anything')).rejects.toMatchObject({ refusal: { status: 402 } });
    expect(log).not.toContain('shifts');
  });

  it('refuses a write over the people limit but not a delete', async () => {
    const answers = {
      account_entitlements: { data: [expiredTrial], error: null },
      workers: { data: null, error: null, count: 12 },
    };
    const write = gatedClient(fakeClient(answers, []), 'acct', { action: 'upsertWorker', worker: { name: 'x' } }, WRITES);
    await expect(write.from('workers').insert({})).rejects.toMatchObject({ refusal: { status: 402, error: expect.stringMatching(/12 people.*covers 10/) } });
    const del = gatedClient(fakeClient(answers, []), 'acct', { action: 'deleteWorker', id: 'w' }, WRITES);
    await expect(del.from('workers').delete().eq('id', 'w')).resolves.toBeDefined();
  });

  it('lets the action run when the plan cannot be read', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const broken = fakeClient({ account_entitlements: { data: null, error: { message: 'down', code: '08006' } as never } }, []);
    const client = gatedClient(broken, 'acct', { action: 'forecastHistory' }, WRITES);
    await expect(client.from('shifts').select('date')).resolves.toBeDefined();
    errorSpy.mockRestore();
  });
});
