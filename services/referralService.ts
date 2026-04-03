import { getSupabaseClient } from './supabaseClient';
import { getSessionToken } from '@/services/authToken';

export type ReferralStatus = 'sent' | 'opened' | 'installed' | 'activated' | 'rewarded';

export type Referral = {
  id: string;
  referralCode: string;
  referrerUserId: string;
  referredUserId: string | null;
  status: ReferralStatus;
  createdAt: string;
  accountId: string;
};

type ReferralRow = {
  id: string;
  referral_code: string;
  referrer_user_id: string;
  referred_user_id: string | null;
  status: ReferralStatus;
  created_at: string;
  account_id: string;
};

const TABLE_NAME = 'referrals';

const normalizeReferral = (row: ReferralRow): Referral => ({
  id: row.id,
  referralCode: row.referral_code,
  referrerUserId: row.referrer_user_id,
  referredUserId: row.referred_user_id,
  status: row.status,
  createdAt: row.created_at,
  accountId: row.account_id,
});

const buildAuthorizedHeaders = async (): Promise<Record<string, string>> => {
  const token = await getSessionToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

const getSecureProxyUrl = (): string =>
  process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

export const createReferral = async (
  referrerUserId: string,
  accountId: string
): Promise<Referral | null> => {
  try {
    const headers = await buildAuthorizedHeaders();

    const response = await fetch(getSecureProxyUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'createReferral', referrerUserId, accountId }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Unknown error' }));
      const message =
        (payload as { error?: string })?.error ??
        `Secure proxy responded with status ${response.status}`;
      console.warn('Unable to create referral', message);
      return null;
    }

    const { success, referral, error } = (await response.json()) as {
      success: boolean;
      referral: Referral | null;
      error?: string;
    };

    if (!success || !referral) {
      console.warn('Unable to create referral', error ?? 'No referral returned');
      return null;
    }

    return referral;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to create referral';
    console.warn(message);
    return null;
  }
};

export const redeemReferral = async (
  referralCode: string,
  referredUserId: string,
  accountId: string
): Promise<Referral | null> => {
  try {
    const headers = await buildAuthorizedHeaders();

    const response = await fetch(getSecureProxyUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'redeemReferral',
        referralCode,
        referredUserId,
        accountId,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Unknown error' }));
      const message =
        (payload as { error?: string })?.error ??
        `Secure proxy responded with status ${response.status}`;
      console.warn('Unable to redeem referral', message);
      return null;
    }

    const { success, referral, error } = (await response.json()) as {
      success: boolean;
      referral: Referral | null;
      error?: string;
    };

    if (!success || !referral) {
      console.warn('Unable to redeem referral', error ?? 'No referral returned');
      return null;
    }

    return referral;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to redeem referral';
    console.warn(message);
    return null;
  }
};

export const getReferralByCode = async (referralCode: string): Promise<Referral | null> => {
  try {
    const client = getSupabaseClient();
    if (!client) return null;

    const { data, error } = await client
      .from(TABLE_NAME)
      .select(
        'id, referral_code, referrer_user_id, referred_user_id, status, created_at, account_id'
      )
      .eq('referral_code', referralCode)
      .maybeSingle();

    if (error) {
      console.warn('Unable to fetch referral by code', error.message);
      return null;
    }

    if (!data) return null;

    return normalizeReferral(data as ReferralRow);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to fetch referral by code';
    console.warn(message);
    return null;
  }
};

export const markReferralOpened = async (referralCode: string): Promise<void> => {
  try {
    const headers = await buildAuthorizedHeaders();

    const response = await fetch(getSecureProxyUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'markReferralOpened', referralCode }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Unknown error' }));
      const message =
        (payload as { error?: string })?.error ??
        `Secure proxy responded with status ${response.status}`;
      console.warn('Unable to mark referral opened', message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to mark referral opened';
    console.warn(message);
  }
};

export const getUserReferrals = async (referrerUserId: string): Promise<Referral[]> => {
  try {
    const client = getSupabaseClient();
    if (!client) return [];

    const { data, error } = await client
      .from(TABLE_NAME)
      .select(
        'id, referral_code, referrer_user_id, referred_user_id, status, created_at, account_id'
      )
      .eq('referrer_user_id', referrerUserId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Unable to fetch user referrals', error.message);
      return [];
    }

    if (!data) return [];

    return (data as ReferralRow[]).map(normalizeReferral);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to fetch user referrals';
    console.warn(message);
    return [];
  }
};