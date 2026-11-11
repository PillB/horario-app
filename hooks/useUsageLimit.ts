import { useCallback, useEffect, useRef, useState } from 'react';

import { TIER_LIMITS } from '@/constants/pricing';
import { getUsageLimit, incrementAutoAssign } from '@/services/usageService';

/** Auto-schedules a month on Gratis. Paid plans have no limit: the server says so in `canAutoAssign`. */
export const FREE_AUTO_ASSIGN_LIMIT = TIER_LIMITS.gratis.maxAutoSchedulesPerMonth;

type UsageLimitState = {
  count: number;
  canAutoAssign: boolean;
  loading: boolean;
};

export const useUsageLimit = (userId: string, accountId: string) => {
  const [state, setState] = useState<UsageLimitState>({
    count: 0,
    canAutoAssign: true, // optimistic default — fail open
    loading: true,
  });

  // Prevent stale async updates if userId/accountId changes
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    const result = await getUsageLimit(userId, accountId);
    if (requestId !== requestRef.current) return;
    setState({
      count: result.success ? result.count : 0,
      canAutoAssign: result.success ? result.canAutoAssign : true,
      loading: false,
    });
  }, [userId, accountId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Counts one auto-schedule run. Call it before applying the run: `limit`
   * means the plan's runs for the month are used up and nothing was counted.
   * `failed` (network, server error) does not block the user.
   */
  const increment = useCallback(async (): Promise<'counted' | 'limit' | 'failed'> => {
    const result = await incrementAutoAssign(userId, accountId);
    if (!result.success) {
      if (result.limitReached) setState((prev) => ({ ...prev, canAutoAssign: false }));
      void load();
      return result.limitReached ? 'limit' : 'failed';
    }
    setState((prev) => ({ ...prev, count: result.count, canAutoAssign: result.canAutoAssign }));
    return 'counted';
  }, [userId, accountId, load]);

  return { ...state, increment, refresh: load };
};
