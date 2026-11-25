/**
 * A screen's focus counter passed to a child (CHG-109): the child reloads each
 * time the counter changes after its mount, never on the mount itself, even
 * when the counter is already above 0 then (the child's hooks load on mount).
 * Before, UpgradeBanner and LocationsManager reloaded on a mount with a
 * counter above 0: two loads at once.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { useReloadOnSignal } from '@/hooks/useRefreshOnFocus';

const mockSubscriptionRefresh = jest.fn();
jest.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ tier: 'gratis', isTrialing: false, isSubscribed: false, refresh: mockSubscriptionRefresh }),
}));
const mockLocationsRefresh = jest.fn(async () => true);
let mockLocationsRefreshFor: Record<string, jest.Mock> = {};
jest.mock('@/hooks/useLocations', () => ({
  useLocations: (accountId: string) => ({
    locations: [],
    loading: false,
    loaded: true,
    error: null,
    // A new tenant gets a new function, as the real hook does.
    refresh: mockLocationsRefreshFor[accountId] ?? mockLocationsRefresh,
    save: jest.fn(),
    remove: jest.fn(),
  }),
}));
jest.mock('@/components/PricingModal', () => ({ PricingModal: () => null }));
jest.mock('@/components/locations/LocationHistoryList', () => ({ LocationHistoryList: () => null }));
jest.mock('@/components/locations/LocationSetupCard', () => ({ LocationSetupCard: () => null }));
jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn(async () => undefined) }));
jest.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/contexts/LocaleContext', () => ({ useT: () => ({ t: (key: string) => key }) }));

// Imported after the mocks.
// eslint-disable-next-line import/first
import { UpgradeBanner } from '@/components/UpgradeBanner';
// eslint-disable-next-line import/first
import { LocationsManager } from '@/components/locations/LocationsManager';

function Probe({ signal, reload }: { signal?: number; reload: () => void }) {
  useReloadOnSignal(signal, reload);
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLocationsRefreshFor = {};
});

describe('useReloadOnSignal', () => {
  it('never reloads on the mount, then once per change of the signal', () => {
    const reload = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Probe signal={3} reload={reload} />);
    });
    expect(reload).not.toHaveBeenCalled();
    act(() => tree.update(<Probe signal={3} reload={reload} />)); // a re-render, same signal
    expect(reload).not.toHaveBeenCalled();
    act(() => tree.update(<Probe signal={4} reload={reload} />));
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it('calls the newest reload function, without reloading when only the function changes', () => {
    const first = jest.fn();
    const second = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Probe signal={0} reload={first} />);
    });
    act(() => tree.update(<Probe signal={0} reload={second} />));
    expect(second).not.toHaveBeenCalled();
    act(() => tree.update(<Probe signal={1} reload={second} />));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe('UpgradeBanner', () => {
  it('does not reload the plan on a mount whose signal is already above 0', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<UpgradeBanner autoAssignUsesLeft={1} reloadSignal={2} />);
    });
    expect(mockSubscriptionRefresh).not.toHaveBeenCalled();
    act(() => tree.update(<UpgradeBanner autoAssignUsesLeft={1} reloadSignal={3} />));
    expect(mockSubscriptionRefresh).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe('LocationsManager', () => {
  it('reloads only when the signal changes: not on the mount, not on a tenant switch', () => {
    const forB = jest.fn(async () => true);
    mockLocationsRefreshFor = { acc_b: forB };
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<LocationsManager accountId="acc_a" reloadSignal={5} />);
    });
    expect(mockLocationsRefresh).not.toHaveBeenCalled();
    // The hook loads the new tenant itself; the signal adds no second load.
    act(() => tree.update(<LocationsManager accountId="acc_b" reloadSignal={5} />));
    expect(forB).not.toHaveBeenCalled();
    act(() => tree.update(<LocationsManager accountId="acc_b" reloadSignal={6} />));
    expect(forB).toHaveBeenCalledTimes(1);
    expect(mockLocationsRefresh).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
