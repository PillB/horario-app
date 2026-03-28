import { useCallback, useEffect, useRef, useState } from 'react';

import { getUsageLimit, incrementAutoAssign } from '@/services/usageService';

export const FREE_AUTO_ASSIGN_LIMIT = 1;

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

  const increment = useCallback(async () => {
    const result = await incrementAutoAssign(userId, accountId);
    if (result.success) {
      setState((prev) => ({
        ...prev,
        count: result.count,
        canAutoAssign: result.count < FREE_AUTO_ASSIGN_LIMIT,
      }));
    }
  }, [userId, accountId]);

  return { ...state, increment, refresh: load };
};
