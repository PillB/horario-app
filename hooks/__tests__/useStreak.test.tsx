import React, { useEffect } from 'react';
import { act, create } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useStreak } from '../useStreak';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();

  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      __store: store,
      __reset: () => store.clear(),
    },
  };
});

type StreakSnapshot = ReturnType<typeof useStreak>;

type HarnessProps = {
  actionKey: string;
  onRender: (value: StreakSnapshot) => void;
  today?: Date;
};

const flushMicrotasks = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const StreakHarness = ({ actionKey, onRender, today }: HarnessProps) => {
  const streak = useStreak(actionKey, today);

  useEffect(() => {
    onRender(streak);
  }, [streak, onRender]);

  return null;
};

describe('useStreak with async storage', () => {
  const storage = AsyncStorage as unknown as {
    getItem: jest.Mock;
    setItem: jest.Mock;
    __store: Map<string, string>;
    __reset: () => void;
  };

  beforeEach(() => {
    storage.__reset();
    jest.clearAllMocks();
  });

  it('hydrates streak state from persisted async storage', async () => {
    const storedState = { count: 2, longest: 3, lastActionDate: '2024-02-01' };
    await storage.setItem('streak::hydrate', JSON.stringify(storedState));

    const renders: StreakSnapshot[] = [];
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(<StreakHarness actionKey="hydrate" onRender={(value) => renders.push(value)} />);
    });

    await flushMicrotasks();
    await flushMicrotasks();
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }

    const hydrated = renders[renders.length - 1];
    expect(hydrated.streakCount).toBe(2);
    expect(hydrated.longestStreak).toBe(3);
    expect(hydrated.lastActionDate).toBe('2024-02-01');
  });

  it('persists updates when recording an action', async () => {
    let latest: StreakSnapshot | null = null;

    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(<StreakHarness actionKey="persist" onRender={(value) => (latest = value)} />);
    });

    await flushMicrotasks();

    await act(async () => {
      await latest?.recordAction(new Date('2024-03-01T00:00:00Z'));
    });

    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }

    expect(storage.setItem).toHaveBeenCalledWith(
      'streak::persist',
      JSON.stringify({ count: 1, longest: 1, lastActionDate: '2024-03-01' })
    );
  });

  it('continues streak across sessions using persisted storage', async () => {
    let firstSession: StreakSnapshot | null = null;

    let initialRenderer: ReturnType<typeof create>;
    await act(async () => {
      initialRenderer = create(
        <StreakHarness
          actionKey="session"
          onRender={(value) => (firstSession = value)}
          today={new Date('2024-04-01T12:00:00Z')}
        />
      );
    });

    await flushMicrotasks();

    await act(async () => {
      await firstSession?.recordAction(new Date('2024-04-01T12:00:00Z'));
      await firstSession?.recordAction(new Date('2024-04-02T08:00:00Z'));
    });

    await act(async () => {
      initialRenderer.unmount();
    });

    let nextSession: StreakSnapshot | null = null;
    await act(async () => {
      create(
        <StreakHarness
          actionKey="session"
          onRender={(value) => (nextSession = value)}
          today={new Date('2024-04-02T20:00:00Z')}
        />
      );
    });

    await flushMicrotasks();

    expect(nextSession?.streakCount).toBe(2);
    expect(nextSession?.lastActionDate).toBe('2024-04-02');
  });
});
