import React, { useEffect } from 'react';
import renderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@/services/analyticsTransport', () => ({
  enqueue: jest.fn(),
}));

import { enqueue } from '@/services/analyticsTransport';
import {
  trackEvent,
  getTrackedEvents,
  setBaseProps,
  setAnalyticsProvider,
} from '../analytics';

const mockEnqueue = enqueue as jest.Mock;

type EventRecord = {
  event: string;
  ts: number;
  props?: Record<string, string | number | boolean>;
};

function resetModule(): void {
  jest.resetModules();
}

let consoleWarnSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

  setBaseProps({
    account_id: 'unknown',
    user_id: 'unknown',
    role: 'unknown',
    locale: 'unknown',
    source_tab: 'unknown',
    experiment_variant: '',
    timestamp: 0,
    platform: 'ios',
  });

  setAnalyticsProvider({ track: jest.fn() });
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe('trackEvent', () => {
  it('stores the event in AsyncStorage so getTrackedEvents returns it', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

    let capturedJson = '';
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      async (_key: string, value: string) => {
        capturedJson = value;
      },
    );

    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async () => capturedJson);

    await trackEvent('signup_viewed');

    const records = await getTrackedEvents();
    expect(records).toHaveLength(1);
    expect(records[0].event).toBe('signup_viewed');
  });

  it('merges _baseProps into stored event props', async () => {
    setBaseProps({
      account_id: 'acc-123',
      user_id: 'usr-456',
      role: 'manager',
      locale: 'en-US',
    });

    let capturedJson = '';
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      async (_key: string, value: string) => {
        capturedJson = value;
      },
    );

    await trackEvent('signup_viewed');

    const records = JSON.parse(capturedJson) as EventRecord[];
    expect(records[0].props).toMatchObject({
      account_id: 'acc-123',
      user_id: 'usr-456',
      role: 'manager',
      locale: 'en-US',
    });
  });

  it('calls enqueue() with correct TransportEvent shape', async () => {
    const before = Date.now();

    await trackEvent('signin_submitted');

    const after = Date.now();

    expect(mockEnqueue).toHaveBeenCalledTimes(1);

    const arg = mockEnqueue.mock.calls[0][0] as {
      id: string;
      event: string;
      props: Record<string, string | number | boolean>;
      ts: number;
    };

    expect(typeof arg.id).toBe('string');
    expect(arg.id.length).toBeGreaterThan(0);
    expect(arg.event).toBe('signin_submitted');
    expect(typeof arg.props).toBe('object');
    expect(arg.ts).toBeGreaterThanOrEqual(before);
    expect(arg.ts).toBeLessThanOrEqual(after);
  });

  it('calls _provider.track() with event name and merged props when provider is set', async () => {
    const mockTrack = jest.fn();
    setAnalyticsProvider({ track: mockTrack });

    await trackEvent('signup_submitted');

    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack.mock.calls[0][0]).toBe('signup_submitted');
    expect(typeof mockTrack.mock.calls[0][1]).toBe('object');
  });

  it('does NOT throw when AsyncStorage.getItem fails', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('storage read error'));

    await expect(trackEvent('signup_viewed')).resolves.toBeUndefined();
  });

  it('does NOT throw when AsyncStorage.setItem fails', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('storage write error'));

    await expect(trackEvent('signup_viewed')).resolves.toBeUndefined();
  });

  it('does NOT throw when enqueue throws', async () => {
    mockEnqueue.mockImplementationOnce(() => {
      throw new Error('transport failure');
    });

    await expect(trackEvent('signup_viewed')).resolves.toBeUndefined();
  });

  it('caps stored events at MAX_EVENTS (200) — oldest are dropped', async () => {
    const existing: EventRecord[] = Array.from({ length: 200 }, (_, i) => ({
      event: 'signup_viewed',
      ts: i,
      props: {},
    }));

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(existing));

    let capturedJson = '';
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      async (_key: string, value: string) => {
        capturedJson = value;
      },
    );

    await trackEvent('activation_reached', { time_to_activation_ms: 5000 });

    const stored = JSON.parse(capturedJson) as EventRecord[];
    expect(stored).toHaveLength(200);
    expect(stored[stored.length - 1].event).toBe('activation_reached');
    expect(stored[0].ts).toBe(1);
  });

  it('typed constraint: error_displayed requires code and screen props, and they flow into stored props', async () => {
    let capturedJson = '';
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      async (_key: string, value: string) => {
        capturedJson = value;
      },
    );

    await trackEvent('error_displayed', { code: 'ERR_404', screen: 'HomeScreen' });

    const records = JSON.parse(capturedJson) as EventRecord[];
    expect(records[0].props).toMatchObject({
      code: 'ERR_404',
      screen: 'HomeScreen',
    });
  });
});

describe('setBaseProps', () => {
  it('injects updated base props into subsequent trackEvent calls', async () => {
    setBaseProps({ account_id: 'new-account', user_id: 'new-user', role: 'admin' });

    let capturedJson = '';
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      async (_key: string, value: string) => {
        capturedJson = value;
      },
    );

    await trackEvent('signup_viewed');

    const records = JSON.parse(capturedJson) as EventRecord[];
    expect(records[0].props).toMatchObject({
      account_id: 'new-account',
      user_id: 'new-user',
      role: 'admin',
    });
  });

  it('does not affect events that were already tracked before the update', async () => {
    let firstCaptured = '';
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      async (_key: string, value: string) => {
        firstCaptured = value;
      },
    );

    await trackEvent('signup_viewed');

    setBaseProps({ account_id: 'changed-after' });

    const firstRecords = JSON.parse(firstCaptured) as EventRecord[];
    expect(firstRecords[0].props?.account_id).not.toBe('changed-after');
  });
});

describe('setAnalyticsProvider', () => {
  it('provider.track is called on the next event after being set', async () => {
    const firstProvider = { track: jest.fn() };
    setAnalyticsProvider(firstProvider);

    await trackEvent('signup_viewed');

    expect(firstProvider.track).toHaveBeenCalledTimes(1);
  });

  it('replacing the provider means only the new provider is called on subsequent events', async () => {
    const firstProvider = { track: jest.fn() };
    const secondProvider = { track: jest.fn() };

    setAnalyticsProvider(firstProvider);
    await trackEvent('signup_viewed');

    setAnalyticsProvider(secondProvider);
    await trackEvent('signin_viewed');

    expect(firstProvider.track).toHaveBeenCalledTimes(1);
    expect(secondProvider.track).toHaveBeenCalledTimes(1);
  });
});

describe('getTrackedEvents', () => {
  it('returns an empty array when AsyncStorage has no stored value', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);

    const result = await getTrackedEvents();

    expect(result).toEqual([]);
  });

  it('returns an empty array when AsyncStorage.getItem throws', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('read error'));

    const result = await getTrackedEvents();

    expect(result).toEqual([]);
  });

  it('parses and returns stored EventRecords from AsyncStorage', async () => {
    const stored: EventRecord[] = [
      { event: 'signup_viewed', ts: 1000, props: { account_id: 'a1', user_id: 'u1', role: 'manager', locale: 'en', platform: 'ios', source_tab: 'home', experiment_variant: '', timestamp: 1000 } },
      { event: 'signin_submitted', ts: 2000, props: { account_id: 'a1', user_id: 'u1', role: 'manager', locale: 'en', platform: 'ios', source_tab: 'home', experiment_variant: '', timestamp: 2000 } },
    ];

    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(stored));

    const result = await getTrackedEvents();

    expect(result).toHaveLength(2);
    expect(result[0].event).toBe('signup_viewed');
    expect(result[0].ts).toBe(1000);
    expect(result[1].event).toBe('signin_submitted');
    expect(result[1].ts).toBe(2000);
  });
});