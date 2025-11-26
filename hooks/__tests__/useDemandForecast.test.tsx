import React, { useEffect } from 'react';
import renderer, { act } from 'react-test-renderer';

import { useDemandForecast } from '../useDemandForecast';
import { getSupabaseClient } from '@/services/supabaseClient';

jest.mock('@/services/supabaseClient', () => ({
  getSupabaseClient: jest.fn(),
}));

describe('useDemandForecast failure handling', () => {
  const mockGetClient = getSupabaseClient as jest.Mock;
  const target = { date: '2024-01-01', role: 'barista', required: 3 };
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClient.mockReturnValue(null);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does not mark existing targets when override persistence fails', async () => {
    let hookState: ReturnType<typeof useDemandForecast> | null = null;

    const TestComponent = () => {
      const hook = useDemandForecast();
      useEffect(() => {
        hookState = hook;
      }, [hook]);
      return null;
    };

    await act(async () => {
      renderer.create(<TestComponent />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await hookState?.overrideTarget(target);
    });

    expect(hookState?.dataStatus.hasExistingTargets).toBe(false);
    expect(hookState?.demandTargets).toEqual([]);
    expect(hookState?.error).toBe('Supabase client is not available');
  });

  it('does not mark existing targets when seeding baseline targets fails', async () => {
    let hookState: ReturnType<typeof useDemandForecast> | null = null;

    const TestComponent = () => {
      const hook = useDemandForecast();
      useEffect(() => {
        hookState = hook;
      }, [hook]);
      return null;
    };

    await act(async () => {
      renderer.create(<TestComponent />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await hookState?.seedBaselineTargets([target]);
    });

    expect(hookState?.dataStatus.hasExistingTargets).toBe(false);
    expect(hookState?.demandTargets).toEqual([]);
    expect(hookState?.error).toBe('Supabase client is not available');
  });
});
