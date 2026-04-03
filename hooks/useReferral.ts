import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/expo';

import { trackEvent } from '@/services/analytics';
import { useIdentity } from '@/contexts/IdentityContext';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReferralStats = {
  sent: number;
  accepted: number;
  pending: number;
};

export type ReferralState = {
  referralCode: string | null;
  stats: ReferralStats | null;
  loading: boolean;
  error: string | null;
};

export type ReferralChannel = 'link' | 'email' | 'sms';

export type UseReferralReturn = ReferralState & {
  createReferral: (channel: ReferralChannel) => Promise<string>;
  redeemReferral: (code: string) => Promise<boolean>;
  refreshStats: () => Promise<void>;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const API_URL = '/api/referrals';

// ─── Internal fetch helper ───────────────────────────────────────────────────

type ApiCreateResponse = { referralCode: string };
type ApiRedeemResponse = { success: boolean; referrerId: string };
type ApiStatsResponse = { sent: number; accepted: number; pending: number };
type ApiErrorResponse = { error: string };

type ApiResponse =
  | ApiCreateResponse
  | ApiRedeemResponse
  | ApiStatsResponse
  | ApiErrorResponse;

function isErrorResponse(r: ApiResponse): r is ApiErrorResponse {
  return 'error' in r;
}

async function postToApi(
  body: Record<string, string>,
  token: string | null,
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as ApiResponse;

  if (!res.ok) {
    const message = isErrorResponse(data) ? data.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return data;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useReferral(): UseReferralReturn {
  const { userId, accountId } = useIdentity();
  const { getToken } = useAuth();

  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Prevent state updates after unmount
  const mountedRef = useRef<boolean>(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Token resolver ──────────────────────────────────────────────────────

  const resolveToken = useCallback(async (): Promise<string | null> => {
    try {
      return await getToken();
    } catch {
      return null;
    }
  }, [getToken]);

  // ── refreshStats ────────────────────────────────────────────────────────

  const refreshStats = useCallback(async (): Promise<void> => {
    if (!userId) return;

    try {
      const token = await resolveToken();
      const response = await postToApi({ action: 'stats' }, token);

      if (isErrorResponse(response)) {
        throw new Error(response.error);
      }

      const statsResponse = response as ApiStatsResponse;

      if (mountedRef.current) {
        setStats({
          sent: statsResponse.sent,
          accepted: statsResponse.accepted,
          pending: statsResponse.pending,
        });
        setError(null);
      }
    } catch (err: unknown) {
      if (mountedRef.current) {
        const message = err instanceof Error ? err.message : 'Failed to fetch stats';
        setError(message);
      }
    }
  }, [userId, resolveToken]);

  // ── Auto-refresh on mount ───────────────────────────────────────────────

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  // ── createReferral ──────────────────────────────────────────────────────

  const createReferral = useCallback(
    async (channel: ReferralChannel): Promise<string> => {
      if (!userId || !accountId) {
        throw new Error('User not authenticated');
      }

      setLoading(true);
      setError(null);

      try {
        const token = await resolveToken();
        const response = await postToApi(
          { action: 'create', account_id: accountId, channel },
          token,
        );

        if (isErrorResponse(response)) {
          throw new Error(response.error);
        }

        const createResponse = response as ApiCreateResponse;
        const code = createResponse.referralCode;

        if (mountedRef.current) {
          setReferralCode(code);
        }

        await trackEvent('invite_sent', { channel });

        // Refresh stats so counts reflect the new referral
        await refreshStats();

        return code;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to create referral';
        if (mountedRef.current) {
          setError(message);
        }
        throw new Error(message);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [userId, accountId, resolveToken, refreshStats],
  );

  // ── redeemReferral ──────────────────────────────────────────────────────

  const redeemReferral = useCallback(
    async (code: string): Promise<boolean> => {
      if (!userId) {
        throw new Error('User not authenticated');
      }

      if (!code || code.trim().length === 0) {
        throw new Error('Referral code is required');
      }

      setLoading(true);
      setError(null);

      try {
        const token = await resolveToken();
        const response = await postToApi(
          { action: 'redeem', code: code.trim().toUpperCase() },
          token,
        );

        if (isErrorResponse(response)) {
          throw new Error(response.error);
        }

        const redeemResponse = response as ApiRedeemResponse;

        if (redeemResponse.success) {
          await trackEvent('invite_accepted', { channel: 'direct' });
          await refreshStats();
        }

        return redeemResponse.success;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to redeem referral';
        if (mountedRef.current) {
          setError(message);
        }
        throw new Error(message);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [userId, resolveToken, refreshStats],
  );

  // ── Return ──────────────────────────────────────────────────────────────

  return {
    referralCode,
    stats,
    loading,
    error,
    createReferral,
    redeemReferral,
    refreshStats,
  };
}