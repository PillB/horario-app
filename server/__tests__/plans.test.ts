/**
 * @jest-environment node
 *
 * The plan in force (server/plans.ts) and the price list (constants/pricing.ts),
 * checked against the product research: Gratis / Esencial / Pro, per location,
 * US$19 / S/ 59 and US$39 / S/ 119 a month, a year for the price of ten months,
 * 10 / 40 / unlimited people, 1 auto-filled week a month on Gratis (one run fills Monday to Sunday, CHG-108), 14-day Pro trial.
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
import { en } from '@/locales/en';
import { es } from '@/locales/es';
import { effectivePlanFrom, gatedClient, insertWithinLimit, PAST_DUE_GRACE_DAYS, PlanRefusal, resolvePlan, type EntitlementRow } from '@/server/plans';

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
    expect(TIER_LIMITS.gratis).toEqual({ maxWorkers: 10, maxLocations: 1, maxAutoSchedulesPerMonth: 1 });
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

describe('the free plan copy (CHG-108)', () => {
  // The copy says "1 auto-filled week" in words; a change of the limit must change the copy too.
  // The landing plan string takes the limit as {n} (app/welcome.tsx passes it), so it is
  // checked as the page renders it, and it must not hard-code the number (CHG-109).
  const n = TIER_LIMITS.gratis.maxAutoSchedulesPerMonth;
  const rendered = (text: string) => text.replace('{n}', String(n));
  it.each([
    ['en pricing', en.pricing.feature.autoScheduleLimited, `${n} auto-filled week a month`],
    ['en profile', en.profile.subscription.gratisDesc, `${n} auto-filled week a month`],
    ['en landing plan', rendered(en.landing.plans.autoLimited), `${n} auto-filled week a month`],
    ['en landing FAQ', en.landing.faq.a3, `${n} auto-filled week a month`],
    ['es pricing', es.pricing.feature.autoScheduleLimited, `${n} semana automática al mes`],
    ['es profile', es.profile.subscription.gratisDesc, `${n} semana automática al mes`],
    ['es landing plan', rendered(es.landing.plans.autoLimited), `${n} semana automática al mes`],
    ['es landing FAQ', es.landing.faq.a3, `${n} semana automática al mes`],
  ])('%s states the limit the server enforces', (_where, text, expected) => {
    expect(text).toContain(expected);
  });

  it.each([
    ['en', en.landing.plans.autoLimited],
    ['es', es.landing.plans.autoLimited],
  ])('the %s landing plan string takes the limit from the page, not a fixed number', (_code, text) => {
    expect(text.startsWith('{n} ')).toBe(true);
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
      limits: { maxWorkers: 10, maxLocations: 1, maxAutoSchedulesPerMonth: 1 },
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

describe('effectivePlanFrom with a Paddle subscription (CHG-104)', () => {
  const paddle = (over: Record<string, unknown>) => ({
    tier: 'pro',
    status: 'active',
    current_period_end: day(30),
    quantity: 3,
    payment_provider: 'paddle',
    past_due_since: null,
    ...over,
  });

  it('pays for as many locations as the subscription quantity, Pro included', () => {
    expect(effectivePlanFrom([], paddle({}), NOW)).toMatchObject({
      plan: 'pro',
      source: 'subscription',
      endsAt: day(30),
      limits: { maxWorkers: null, maxLocations: 3, maxAutoSchedulesPerMonth: null },
    });
    expect(effectivePlanFrom([], paddle({ tier: 'esencial', quantity: 2 }), NOW).limits.maxLocations).toBe(2);
  });

  it(`keeps the plan for ${PAST_DUE_GRACE_DAYS} days after the first failed renewal, then Gratis`, () => {
    // Boundary on both sides: one minute before the grace ends, and at the end.
    const failedAt = new Date(NOW.getTime() - PAST_DUE_GRACE_DAYS * 86_400_000 + 60_000).toISOString();
    const stillOn = effectivePlanFrom([], paddle({ status: 'past_due', past_due_since: failedAt }), NOW);
    expect(stillOn).toMatchObject({ plan: 'pro', endsAt: new Date(Date.parse(failedAt) + PAST_DUE_GRACE_DAYS * 86_400_000).toISOString() });
    const atEnd = new Date(Date.parse(failedAt) + PAST_DUE_GRACE_DAYS * 86_400_000);
    expect(effectivePlanFrom([], paddle({ status: 'past_due', past_due_since: failedAt }), atEnd).plan).toBe('gratis');
  });

  it('gives no plan once paused or cancelled; a tester grant still applies', () => {
    for (const status of ['paused', 'cancelled']) {
      expect(effectivePlanFrom([], paddle({ status }), NOW).plan).toBe('gratis');
    }
    const grant = row({ id: 'g', plan: 'esencial', source: 'tester', ends_at: day(30) });
    expect(effectivePlanFrom([grant], paddle({ status: 'cancelled' }), NOW)).toMatchObject({ plan: 'esencial', source: 'tester' });
  });

  it('ignores a quantity on a row that is not from Paddle (old manual rows)', () => {
    expect(effectivePlanFrom([], paddle({ payment_provider: null }), NOW).limits.maxLocations).toBeNull();
  });
});

describe('gatedClient', () => {
  type Reply = { data: unknown; error: null; count?: number };
  const fakeClient = (answers: Record<string, Reply>, log: string[]) => {
    const builder = (table: string): Record<string, unknown> => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'order', 'limit', 'update', 'delete', 'maybeSingle', 'single']) b[m] = () => b;
      b.insert = () => {
        log.push(`insert:${table}`);
        return b;
      };
      b.then = (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) => {
        log.push(table);
        return Promise.resolve(answers[table] ?? { data: null, error: null }).then(resolve, reject);
      };
      return b;
    };
    return { from: builder, rpc: (name: string) => builder(`rpc:${name}`) } as never;
  };
  const WRITES = new Set(['upsertWorker', 'deleteWorker', 'upsertShiftTemplate']);
  const expiredTrial = row({ starts_at: day(-30), ends_at: day(-16) });

  // gatedClient reads the real clock (resolvePlan's default `now`), and the
  // rows above are dated around NOW. Without pinning the clock, the trial
  // row "ends in 13 days" stopped being active on 2026-11-24 and two tests
  // turned red with no code change (found by `npm run test:drift`, CHG-103).
  // Only Date is faked; promises and timers stay real.
  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime', 'performance'],
    });
  });
  afterEach(() => jest.useRealTimers());

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
      locations: { data: null, error: null, count: 1 },
    };
    const write = gatedClient(fakeClient(answers, []), 'acct', { action: 'upsertWorker', worker: { name: 'x' } }, WRITES);
    await expect(write.from('workers').insert({})).rejects.toMatchObject({ refusal: { status: 402, error: expect.stringMatching(/12 people.*covers 10/) } });
    const del = gatedClient(fakeClient(answers, []), 'acct', { action: 'deleteWorker', id: 'w' }, WRITES);
    await expect(del.from('workers').delete().eq('id', 'w')).resolves.toBeDefined();
  });

  // CHG-109: before, a plan read that failed let the action run with no limit at all (fail open).
  it.each([
    ['a scheduling write', { action: 'upsertShiftTemplate', template: {} }, 'shift_templates'],
    ['a new location', { action: 'upsertLocation', location: { name: 'x' } }, 'locations'],
    ['a Pro read', { action: 'forecastHistory' }, 'shifts'],
  ])('refuses %s with 503 when the plan cannot be read', async (_label, payload, table) => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const log: string[] = [];
    const broken = fakeClient({ account_entitlements: { data: null, error: { message: 'down', code: '08006' } as never } }, log);
    const client = gatedClient(broken, 'acct', payload, WRITES);
    await expect(client.from(table).select('id')).rejects.toMatchObject({ refusal: { status: 503, error: 'Could not check your plan; try again' } });
    expect(log).not.toContain(table);
    errorSpy.mockRestore();
  });

  it('still lets an action that is not gated run when the plan cannot be read', async () => {
    const broken = fakeClient({ account_entitlements: { data: null, error: { message: 'down', code: '08006' } as never } }, []);
    const client = gatedClient(broken, 'acct', { action: 'deleteWorker', id: 'w' }, new Set(['upsertWorker']));
    await expect(client.from('workers').delete().eq('id', 'w')).resolves.toBeDefined();
  });

  describe('locations over the plan (CHG-109)', () => {
    // A trial ended (or a grant, or a paid plan was reduced) with 3 locations stored; Gratis covers 1.
    const overQuota = {
      account_entitlements: { data: [expiredTrial], error: null },
      workers: { data: null, error: null, count: 2 },
      locations: { data: null, error: null, count: 3 },
    };

    it('makes the schedule read-only, editing a location included, and says how to get back', async () => {
      const write = gatedClient(fakeClient(overQuota, []), 'acct', { action: 'upsertShiftTemplate', template: {} }, WRITES);
      await expect(write.from('shift_templates').insert({})).rejects.toMatchObject({
        refusal: { status: 402, error: 'Your business has 3 locations and the Gratis plan covers 1. The schedule is read-only until you remove a location or upgrade' },
      });
      const edit = gatedClient(fakeClient({ ...overQuota, locations: { data: { id: 'l1' }, error: null, count: 3 } }, []), 'acct', { action: 'upsertLocation', location: { id: 'l1' } }, WRITES);
      await expect(edit.from('locations').update({})).rejects.toMatchObject({ refusal: { status: 402, error: expect.stringMatching(/3 locations.*covers 1/) } });
    });

    it('keeps deletes open so the account can get under the quota', async () => {
      const del = gatedClient(fakeClient(overQuota, []), 'acct', { action: 'deleteWorker', id: 'w' }, WRITES);
      await expect(del.from('workers').delete().eq('id', 'w')).resolves.toBeDefined();
      // deleteLocation is not a scheduling write and not upsertLocation: never gated.
      const log: string[] = [];
      const delLocation = gatedClient(fakeClient(overQuota, log), 'acct', { action: 'deleteLocation', id: 'l1' }, WRITES);
      await expect(delLocation.rpc('delete_location')).resolves.toBeDefined();
      expect(log).toEqual(['rpc:delete_location']);
    });

    it('allows writes at the quota, and the quota of the winning grant counts (3 paid locations)', async () => {
      const atOne = gatedClient(fakeClient({ ...overQuota, locations: { data: null, error: null, count: 1 } }, []), 'acct', { action: 'upsertShiftTemplate', template: {} }, WRITES);
      await expect(atOne.from('shift_templates').insert({})).resolves.toBeDefined();
      const paid = { ...overQuota, account_entitlements: { data: [row({ plan: 'esencial', source: 'paddle', ends_at: null, location_quota: 3 })], error: null } };
      const write = gatedClient(fakeClient(paid, []), 'acct', { action: 'upsertShiftTemplate', template: {} }, WRITES);
      await expect(write.from('shift_templates').insert({})).resolves.toBeDefined();
      // At 3 of 3, a fourth location is refused with the add-a-location sentence, not the read-only one.
      const fourth = gatedClient(fakeClient(paid, []), 'acct', { action: 'upsertLocation', location: { name: 'D' } }, WRITES);
      await expect(fourth.from('locations').insert({})).rejects.toMatchObject({ refusal: { status: 402, error: expect.stringMatching(/covers 3 locations\. Add a location/) } });
    });
  });

  describe('resolvePlan', () => {
    it('starts the trial on first sight, and not when asked not to (admin lookup, CHG-109)', async () => {
      const log: string[] = [];
      const plan = await resolvePlan(fakeClient({ account_entitlements: { data: [], error: null } }, log), 'acct_new', NOW, { startTrial: false });
      expect(plan).toEqual({ ok: true, plan: expect.objectContaining({ plan: 'gratis', source: 'default', trialEndsAt: null }) });
      expect(log).not.toContain('insert:account_entitlements');

      const started: string[] = [];
      await resolvePlan(fakeClient({ account_entitlements: { data: [], error: null } }, started), 'acct_new', NOW);
      expect(started).toContain('insert:account_entitlements');
    });
  });

  describe('insertWithinLimit', () => {
    const gratis = {
      account_entitlements: { data: [expiredTrial], error: null },
      workers: { data: null, error: null, count: 9 },
      locations: { data: null, error: null, count: 1 },
    };
    const gated = (answers: Record<string, unknown>, log: string[] = []) =>
      gatedClient(fakeClient(answers as Record<string, Reply>, log), 'acct', { action: 'upsertWorker', worker: { name: 'x' } }, WRITES);

    it('counts and inserts in one database call, with the limit of the plan', async () => {
      const log: string[] = [];
      const client = gated({ ...gratis, 'rpc:insert_within_limit': { data: { rows: [{ id: 'w1' }] }, error: null } }, log);
      await expect(insertWithinLimit(client, 'workers', 'acct', { name: 'x' })).resolves.toEqual({ data: { id: 'w1' }, error: null });
      expect(log).toContain('rpc:insert_within_limit');
    });

    it('refuses with the plan sentence when another request took the last place', async () => {
      const client = gated({ ...gratis, 'rpc:insert_within_limit': { data: { limited: true, count: 10 }, error: null } });
      await expect(insertWithinLimit(client, 'workers', 'acct', { name: 'x' })).rejects.toMatchObject({
        refusal: { status: 402, error: expect.stringMatching(/covers up to 10 people/) },
      });
    });

    it('leaves the insert to the caller when the plan has no limit, the client is not gated, or the function is missing', async () => {
      const log: string[] = [];
      const pro = gated({ account_entitlements: { data: [row({})], error: null } }, log);
      await expect(insertWithinLimit(pro, 'workers', 'acct', {})).resolves.toBeNull();
      await expect(insertWithinLimit(fakeClient(gratis as never, log), 'workers', 'acct', {})).resolves.toBeNull();
      expect(log).not.toContain('rpc:insert_within_limit');

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const old = gated({ ...gratis, 'rpc:insert_within_limit': { data: null, error: { code: 'PGRST202', message: 'no function' } } });
      await expect(insertWithinLimit(old, 'workers', 'acct', {})).resolves.toBeNull();
      errorSpy.mockRestore();
    });

    it('refuses with 503 instead of inserting without the limit when the plan cannot be read (CHG-109)', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const log: string[] = [];
      const client = gated({ account_entitlements: { data: null, error: { message: 'down', code: '08006' } } }, log);
      await expect(insertWithinLimit(client, 'workers', 'acct', { name: 'x' })).rejects.toMatchObject({ refusal: { status: 503 } });
      expect(log).not.toContain('rpc:insert_within_limit');
      errorSpy.mockRestore();
    });

    it('passes a database error on', async () => {
      const client = gated({ ...gratis, 'rpc:insert_within_limit': { data: null, error: { code: '23505', message: 'dup' } } });
      await expect(insertWithinLimit(client, 'workers', 'acct', {})).resolves.toEqual({ data: null, error: { code: '23505', message: 'dup' } });
    });
  });
});
