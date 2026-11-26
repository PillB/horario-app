/**
 * F-10 and F-3 (CHG-109): over the plan's people limit the Scheduler says the
 * schedule is read-only before a write is refused, and a refused write (402)
 * makes every plan reader read the plan again at once.
 */
import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('@/contexts/LocaleContext', () => {
  const { en } = jest.requireActual('@/locales/en');
  const resolve = (path: string): unknown =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], en);
  return {
    useT: () => ({
      t: (path: string, params?: Record<string, string>) => {
        const value = resolve(path);
        if (typeof value !== 'string') return path;
        return value.replace(/\{(\w+)\}/g, (_: string, k: string) => params?.[k] ?? `{${k}}`);
      },
    }),
  };
});
jest.mock('@/contexts/IdentityContext', () => ({ useIdentity: () => ({ accountId: 'acc-1', userId: 'u1', isLoaded: true }) }));
jest.mock('@/components/PricingModal', () => ({ PricingModal: () => null }));

const mockGetAccountPlan = jest.fn();
jest.mock('@/services/subscriptionService', () => ({
  ...jest.requireActual('@/services/subscriptionService'),
  getAccountPlan: () => mockGetAccountPlan(),
}));

// eslint-disable-next-line import/first
import { PlanLimitNotice, peopleOverLimit } from '../PlanLimitNotice';
// eslint-disable-next-line import/first
import { reportPlanRefusal } from '@/services/planSignal';

const plan = (tier: 'gratis' | 'pro', isTrial: boolean, workers: number) => ({
  success: true,
  plan: { plan: tier, source: isTrial ? 'trial' : 'default', isTrial, endsAt: null, limits: { maxWorkers: tier === 'gratis' ? 10 : null, maxLocations: 1, maxAutoSchedulesPerMonth: tier === 'gratis' ? 1 : null } },
  usage: { workers, locations: 1, autoSchedulesThisMonth: 0 },
  subscription: { status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: null },
  isPlatformAdmin: false,
});

const textOf = (tree: ReactTestRenderer): string =>
  tree.root.findAll((n) => typeof n.props.children === 'string').map((n) => n.props.children as string).join(' | ');

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
};

describe('peopleOverLimit (the server rule: more people than the plan covers)', () => {
  it('is null at the limit and over it by one is over', () => {
    expect(peopleOverLimit({ workers: 10 }, { maxWorkers: 10 })).toBeNull();
    expect(peopleOverLimit({ workers: 11 }, { maxWorkers: 10 })).toEqual({ count: 11, max: 10 });
  });
  it('is null without a people limit or before the plan is known', () => {
    expect(peopleOverLimit({ workers: 500 }, { maxWorkers: null })).toBeNull();
    expect(peopleOverLimit(null, { maxWorkers: 10 })).toBeNull();
  });
});

describe('PlanLimitNotice', () => {
  const mounted: ReactTestRenderer[] = [];
  beforeEach(() => mockGetAccountPlan.mockReset());
  // A mounted notice keeps listening for refusals: unmount each one.
  afterEach(() => act(() => mounted.splice(0).forEach((t) => t.unmount())));

  it('says the schedule is read-only on Gratis with 14 people, with the numbers', async () => {
    mockGetAccountPlan.mockResolvedValue(plan('gratis', false, 14));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlanLimitNotice />);
      mounted.push(tree);
    });
    await flush();
    const text = textOf(tree);
    expect(text).toContain('The schedule is read-only');
    expect(text).toContain('Your team has 14 people and the Gratis plan covers 10. Until you upgrade or remove 4 of them');
  });

  it('shows nothing within the limit, and on the trial', async () => {
    mockGetAccountPlan.mockResolvedValue(plan('gratis', false, 10));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlanLimitNotice />);
      mounted.push(tree);
    });
    await flush();
    expect(tree.toJSON()).toBeNull();
    mockGetAccountPlan.mockResolvedValue(plan('pro', true, 14));
    await act(async () => {
      tree = renderer.create(<PlanLimitNotice />);
      mounted.push(tree);
    });
    await flush();
    expect(tree.toJSON()).toBeNull();
  });

  it('appears without a reload when a write is refused because the trial ended (402)', async () => {
    mockGetAccountPlan.mockResolvedValueOnce(plan('pro', true, 14));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlanLimitNotice />);
      mounted.push(tree);
    });
    await flush();
    expect(tree.toJSON()).toBeNull();
    // The trial ends on the server; the next write is refused and the proxy client reports it.
    mockGetAccountPlan.mockResolvedValueOnce(plan('gratis', false, 14));
    await act(async () => {
      reportPlanRefusal();
    });
    await flush();
    expect(mockGetAccountPlan).toHaveBeenCalledTimes(2);
    expect(textOf(tree)).toContain('The schedule is read-only');
  });
});
