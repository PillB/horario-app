const SECURE_PROXY_URL =
  process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? 'http://localhost:8081/api/secure-proxy';

type UsageLimitResult =
  | { success: true; count: number; canAutoAssign: boolean }
  | { success: false; error: string };

type IncrementResult =
  | { success: true; count: number }
  | { success: false; error: string };

const proxyPost = async <T>(body: unknown): Promise<T | null> => {
  try {
    const res = await fetch(SECURE_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  const data = await proxyPost<{ count: number }>({
    action: 'incrementAutoAssign',
    userId,
    accountId,
  });
  if (!data) return { success: false, error: 'Unable to record usage' };
  return { success: true, count: data.count };
};
