import { getSessionToken } from '@/services/authToken';

export type OnboardingProgress = {
  workers: boolean;
  templates: boolean;
  forecast: boolean;
};

const proxyUrl = () => process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy';

/**
 * Both reads and writes go through the secure proxy, which scopes them to the
 * signed-in user and tenant. `accountId` is only consulted by the proxy's
 * local insecure dev mode; with auth configured the server ignores it.
 */
const postToProxy = async <T>(body: Record<string, unknown>): Promise<T | null> => {
  const token = await getSessionToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(proxyUrl(), { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Unknown error' }));
    console.warn(`Onboarding ${String(body.action)} failed`, payload?.error ?? response.status);
    return null;
  }
  return (await response.json()) as T;
};

export const fetchOnboardingProgress = async (
  accountId: string,
  // Kept for call-site compatibility; the server uses the signed-in user.
  _userId?: string | null,
): Promise<OnboardingProgress | null> => {
  try {
    const result = await postToProxy<{ progress: OnboardingProgress | null }>({ action: 'getOnboarding', accountId });
    return result?.progress ?? null;
  } catch (error) {
    console.warn('Unable to load onboarding progress', error instanceof Error ? error.message : error);
    return null;
  }
};

export const upsertOnboardingProgress = async (
  accountId: string,
  flags: OnboardingProgress,
  _userId?: string | null,
): Promise<OnboardingProgress | null> => {
  try {
    const result = await postToProxy<{ success: boolean; progress: OnboardingProgress | null }>({
      action: 'upsertOnboarding',
      accountId,
      flags,
    });
    return result?.success ? result.progress : null;
  } catch (error) {
    console.warn('Unable to persist onboarding progress', error instanceof Error ? error.message : error);
    return null;
  }
};
