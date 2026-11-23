/**
 * billingOf (hooks/useSubscription.ts): what the plans screen is told about the
 * Paddle side. A business "pays" only through a Paddle row that is still live;
 * a cancelled Paddle row or a row from another provider must not show "Switch
 * to …" (which would call changeSubscription on a subscription that is over).
 */
import { billingOf, type Loaded } from '@/hooks/useSubscription';

const base = (over: Partial<Loaded>): Loaded =>
  ({ status: 'active', provider: 'paddle', quantity: 2, hasBillingAccount: true, ...over }) as Loaded;

describe('billingOf', () => {
  it('says nothing is paid before the subscription loads', () => {
    expect(billingOf(null)).toEqual({ hasPaidSubscription: false, hasBillingAccount: false, paidQuantity: null });
  });

  it.each(['active', 'trialing', 'past_due', 'paused'] as const)('counts a Paddle row that is %s as paying', (status) => {
    expect(billingOf(base({ status }))).toEqual({ hasPaidSubscription: true, hasBillingAccount: true, paidQuantity: 2 });
  });

  it('does not count a cancelled Paddle row, but keeps its billing account for the portal', () => {
    expect(billingOf(base({ status: 'cancelled' }))).toEqual({ hasPaidSubscription: false, hasBillingAccount: true, paidQuantity: 2 });
  });

  it('does not count an active row from another provider', () => {
    expect(billingOf(base({ provider: 'stripe', hasBillingAccount: false, quantity: null })).hasPaidSubscription).toBe(false);
  });
});
