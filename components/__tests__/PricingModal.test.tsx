/* eslint-disable import/first */
/**
 * The plans screen with checkout switched on (CHG-104): a business on no paid
 * plan gets a checkout, one that already pays switches plan in place and can
 * open Manage billing, and iOS shows no purchase button.
 */
process.env.EXPO_PUBLIC_CHECKOUT_ENABLED = '1';

jest.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/contexts/IdentityContext', () => ({ useIdentity: () => ({ accountId: 'org_mine' }) }));
jest.mock('@/hooks/useLocations', () => ({ useLocations: () => mockLocations }));
jest.mock('@/hooks/useSubscription', () => ({ useSubscription: () => mockSubscription }));
jest.mock('@/services/subscriptionService', () => ({
  createCheckoutSession: jest.fn(async () => ({ success: true, checkoutUrl: 'https://horario.app/pay?_ptxn=txn_01', transactionId: 'txn_01', quantity: 1 })),
  changeSubscription: jest.fn(async () => ({ success: true, pending: true, quantity: 1 })),
  createBillingPortalSession: jest.fn(async () => ({ success: true, portalUrl: 'https://customer-portal.paddle.com/cpl_01' })),
}));
jest.mock('@/contexts/LocaleContext', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { en } = require('@/locales/en');
  const resolve = (obj: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], obj);
  const t = (key: string, params?: Record<string, string>) => {
    let out = resolve(en, key);
    if (typeof out !== 'string') return key;
    for (const [k, v] of Object.entries(params ?? {})) out = (out as string).split(`{${k}}`).join(v);
    return out as string;
  };
  return { useT: () => ({ t, langCode: 'en' }) };
});

let mockLocations: { locations: { countryCode: string }[] } = { locations: [{ countryCode: 'US' }] };
let mockSubscription: Record<string, unknown> = {};

import React from 'react';
import { Linking, Platform } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import { PricingModal } from '@/components/PricingModal';
import * as service from '@/services/subscriptionService';

const subscription = (over: Record<string, unknown> = {}) => ({
  tier: 'gratis',
  isTrialing: false,
  trialDaysLeft: null,
  hasPaidSubscription: false,
  hasBillingAccount: false,
  status: 'active',
  refresh: jest.fn(),
  ...over,
});

const labels = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string').map((n) => n.props.accessibilityLabel as string);
const press = async (tree: renderer.ReactTestRenderer, label: string) => {
  const node = tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  if (!node) throw new Error(`No button "${label}" among ${labels(tree).join(', ')}`);
  await act(async () => {
    await node.props.onPress();
  });
};
const text = (tree: renderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());

function render(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<PricingModal visible onClose={() => {}} />);
  });
  return tree;
}

describe('PricingModal with checkout on', () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocations = { locations: [{ countryCode: 'US' }] };
  });

  it('opens a checkout for a business that pays nothing yet', async () => {
    mockSubscription = subscription();
    const tree = render('android');
    expect(labels(tree)).toEqual(expect.arrayContaining(['Choose Esencial', 'Choose Pro']));
    expect(labels(tree)).not.toContain('Manage billing');
    await press(tree, 'Choose Pro');
    expect(service.createCheckoutSession).toHaveBeenCalledWith({ tier: 'pro', billingInterval: 'month' });
    expect(service.changeSubscription).not.toHaveBeenCalled();
    expect(openURL).toHaveBeenCalledWith('https://horario.app/pay?_ptxn=txn_01');
  });

  it('switches plan in place for a business that already pays, and offers Manage billing', async () => {
    mockSubscription = subscription({ tier: 'esencial', hasPaidSubscription: true, hasBillingAccount: true });
    const tree = render('android');
    // No button for the plan already paid for.
    expect(labels(tree)).not.toContain('Switch to Esencial');
    await press(tree, 'Switch to Pro');
    expect(service.changeSubscription).toHaveBeenCalledWith({ tier: 'pro', billingInterval: 'month' });
    expect(service.createCheckoutSession).not.toHaveBeenCalled();
    expect(text(tree)).toContain('Plan change sent');
    await press(tree, 'Manage billing');
    expect(openURL).toHaveBeenCalledWith('https://customer-portal.paddle.com/cpl_01');
  });

  it('shows the server error instead of opening anything', async () => {
    mockSubscription = subscription();
    (service.createCheckoutSession as jest.Mock).mockResolvedValueOnce({ success: false, error: 'The payment service did not answer. Nothing was charged. Try again in a minute' });
    const tree = render('android');
    await press(tree, 'Choose Pro');
    expect(openURL).not.toHaveBeenCalled();
    expect(text(tree)).toContain('Nothing was charged');
  });

  it('warns about a failed renewal and says a plan is charged per location', () => {
    mockSubscription = subscription({ tier: 'pro', status: 'past_due', hasPaidSubscription: true, hasBillingAccount: true });
    mockLocations = { locations: [{ countryCode: 'US' }, { countryCode: 'US' }, { countryCode: 'US' }] };
    const out = text(render('android'));
    expect(out).toContain('The last payment did not go through');
    expect(out).toContain('You have 3 locations, so a paid plan is charged 3 times the price shown.');
  });

  it('shows no purchase button on iOS, only where to buy', () => {
    mockSubscription = subscription();
    const tree = render('ios');
    expect(labels(tree).filter((l) => l.startsWith('Choose') || l.startsWith('Switch'))).toEqual([]);
    expect(text(tree)).toContain('Plans are bought on the website');
  });
});
