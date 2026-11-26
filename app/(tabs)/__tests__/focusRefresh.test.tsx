/**
 * Tabs stay mounted, so returning to a screen must reload what another screen
 * may have changed (CHG-109, D5): Home's locations (the "set up your location"
 * card goes away after a location is added on Profile) and Profile's plan.
 * The first focus is the mount, which already loads: no second request then.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

let mockFocus: (() => void) | null = null;
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: jest.fn(), setParams: jest.fn() }),
  useFocusEffect: (cb: () => void) => { mockFocus = cb; },
}));

jest.mock('@/contexts/LocaleContext', () => ({
  useT: () => ({ t: (key: string) => key, langCode: 'en', setLanguage: jest.fn(), locale: {} }),
}));
jest.mock('@/contexts/IdentityContext', () => ({
  useIdentity: () => ({ accountId: 'acc', userId: 'u1', isLoaded: true }),
}));
jest.mock('@/contexts/WelcomeTourContext', () => ({
  TOUR_MODES: [],
  useWelcomeTour: () => ({ startTourMode: jest.fn(), registerTarget: jest.fn() }),
}));
jest.mock('@/hooks/useColorScheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/useResponsive', () => ({ useResponsive: () => ({ isWideLayout: false }) }));
jest.mock('@/components/TourStep', () => ({ TourStep: ({ children }: { children: React.ReactNode }) => children }));

// ── Home's data ──
const mockLocationsState = { locations: [] as { id: string }[], loaded: true };
const mockRefreshLocations = jest.fn(async () => {
  // What the server holds now: the location added on Profile.
  mockLocationsState.locations = [{ id: 'loc-1' }];
});
jest.mock('@/hooks/useLocations', () => ({
  useLocations: () => ({ ...mockLocationsState, save: jest.fn(), refresh: mockRefreshLocations }),
}));
const mockRefreshRoster = jest.fn();
jest.mock('@/hooks/useLiveRosterSummary', () => ({
  useLiveRosterSummary: () => ({
    upcomingShifts: [], shiftCount: 0, publishedCount: 0, staffingGaps: [], windowTargets: 0,
    setup: { workers: 1, templates: 1, targets: 1 }, loading: false, error: 'offline', refresh: mockRefreshRoster,
  }),
}));
const mockRefreshHabit = jest.fn();
jest.mock('@/hooks/usePostingHabit', () => ({
  usePostingHabit: () => ({ habit: null, goal: { days: 7 }, loading: false, error: null, refresh: mockRefreshHabit }),
}));
jest.mock('@/hooks/useHiddenCard', () => ({ useHiddenCard: () => ({ hidden: true, setHidden: jest.fn() }) }));
jest.mock('@/hooks/useTeamInvite', () => ({
  useTeamInvite: () => ({ inviteModalVisible: false, inviteMode: 'manager', openInviteAsManager: jest.fn(), closeInvite: jest.fn() }),
}));
jest.mock('@/components/TeamInviteModal', () => ({ TeamInviteModal: () => null }));
jest.mock('@/components/locations/LocationSetupCard', () => {
  const { View } = jest.requireActual('react-native');
  return { LocationSetupCard: () => <View testID="location-setup-card" /> };
});

// ── Profile's data ──
const mockRefreshPlan = jest.fn();
jest.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    tier: 'gratis', isTrialing: false, isSubscribed: false, trialDaysLeft: null, endsAt: null, loading: false,
    usage: null, limits: { maxWorkers: 10, maxLocations: 1, maxAutoSchedulesPerMonth: 1 }, refresh: mockRefreshPlan,
  }),
}));
const mockLocationsManager = jest.fn();
jest.mock('@/components/locations/LocationsManager', () => ({
  LocationsManager: (props: { reloadSignal?: number }) => {
    mockLocationsManager(props);
    return null;
  },
}));
jest.mock('@/components/CapabilityMatrix', () => ({ CapabilityMatrix: () => null }));
jest.mock('@/components/LanguageSelector', () => ({ LanguageSelector: () => null }));

// eslint-disable-next-line import/first
import HomeScreen from '../index';
// eslint-disable-next-line import/first
import ProfileScreen from '../profile';

const hasSetupCard = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAll((node) => node.props.testID === 'location-setup-card').length > 0;

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus = null;
  mockLocationsState.locations = [];
});

describe('Home on focus', () => {
  it('reloads locations on a return, and the setup card goes once a location exists', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<HomeScreen />);
    });
    expect(hasSetupCard(tree)).toBe(true);

    act(() => mockFocus!()); // the mount's focus
    expect(mockRefreshLocations).not.toHaveBeenCalled();
    expect(mockRefreshRoster).not.toHaveBeenCalled();

    await act(async () => {
      mockFocus!(); // back from Profile, where a location was added
    });
    expect(mockRefreshLocations).toHaveBeenCalledTimes(1);
    expect(mockRefreshRoster).toHaveBeenCalledTimes(1);
    expect(mockRefreshHabit).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.update(<HomeScreen />);
    });
    expect(hasSetupCard(tree)).toBe(false);
    act(() => tree.unmount());
  });
});

describe('Profile on focus', () => {
  it('reloads the plan and the locations on a return, not on the first focus', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ProfileScreen />);
    });
    act(() => mockFocus!());
    expect(mockRefreshPlan).not.toHaveBeenCalled();
    expect(mockLocationsManager).toHaveBeenLastCalledWith(expect.objectContaining({ reloadSignal: 0 }));

    act(() => mockFocus!());
    expect(mockRefreshPlan).toHaveBeenCalledTimes(1);
    expect(mockLocationsManager).toHaveBeenLastCalledWith(expect.objectContaining({ reloadSignal: 1 }));
    act(() => tree.unmount());
  });
});
