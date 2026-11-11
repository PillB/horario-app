import { getSessionToken } from '@/services/authToken';

const SECURE_PROXY_URL =
  process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

type UsageLimitResult =
  | { success: true; count: number; canAutoAssign: boolean }
  | { success: false; error: string };

type IncrementResult =
  | { success: true; count: number; canAutoAssign: boolean }
  /** `limitReached`: the server refused because the plan's monthly runs are used up (HTTP 402). */
  | { success: false; error: string; limitReached: boolean };

const proxyPost = async <T>(body: unknown): Promise<T | null> => {
  try {
    const token = await getSessionToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(SECURE_PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

export const getUsageLimit = async (
  userId: string,
  accountId: string
): Promise<UsageLimitResult> => {
  const data = await proxyPost<{ count: number; canAutoAssign: boolean }>({
    action: 'getUsageLimit',
    userId,
    accountId,
  });
  if (!data) return { success: true, count: 0, canAutoAssign: true }; // fail open
  return { success: true, count: data.count, canAutoAssign: data.canAutoAssign };
};

export const incrementAutoAssign = async (
  userId: string,
  accountId: string
): Promise<IncrementResult> => {
  try {
    const token = await getSessionToken();
    const res = await fetch(SECURE_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: 'incrementAutoAssign', userId, accountId }),
    });
    const data = (await res.json().catch(() => null)) as { count?: number; canAutoAssign?: boolean; error?: string } | null;
    if (!res.ok || typeof data?.count !== 'number') {
      return { success: false, error: data?.error ?? 'Unable to record usage', limitReached: res.status === 402 };
    }
    return { success: true, count: data.count, canAutoAssign: data.canAutoAssign !== false };
  } catch {
    return { success: false, error: 'Unable to record usage', limitReached: false };
  }
};
