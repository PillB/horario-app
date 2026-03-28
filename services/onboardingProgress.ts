import { getSupabaseClient } from './supabaseClient';

export type OnboardingProgress = {
  workers: boolean;
  templates: boolean;
  forecast: boolean;
};

type OnboardingRow = {
  workers_completed?: boolean | null;
  templates_completed?: boolean | null;
  forecast_completed?: boolean | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;

const TABLE_NAME = 'onboarding_progress';

const applyUserFilter = (
  query: AnyQuery,
  userId?: string | null
) => {
  if (userId) {
    return query.eq('user_id', userId);
  }

  return query.is('user_id', null);
};

export const fetchOnboardingProgress = async (
  accountId: string,
  userId?: string | null
): Promise<OnboardingProgress | null> => {
  const client = getSupabaseClient();
  if (!client) return null;

  const baseQuery = client
    .from(TABLE_NAME)
    .select('workers_completed, templates_completed, forecast_completed')
    .eq('account_id', accountId)
    .limit(1);

  const query = applyUserFilter(baseQuery, userId);
  const { data, error } = await query.maybeSingle();

  if (error) {
    console.warn('Unable to load onboarding progress', error.message);
    return null;
  }

  if (!data) return null;

  const normalize = (row: OnboardingRow): OnboardingProgress => ({
    workers: Boolean(row.workers_completed),
    templates: Boolean(row.templates_completed),
    forecast: Boolean(row.forecast_completed),
  });

  return normalize(data as OnboardingRow);
};

export const upsertOnboardingProgress = async (
  accountId: string,
  flags: OnboardingProgress,
  userId?: string | null
) => {
  try {
    const response = await fetch(process.env.EXPO_PUBLIC_SECURE_PROXY_URL ?? '/api/secure-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsertOnboarding', accountId, flags, userId }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Unknown error' }));
      const message = payload?.error ?? `Secure proxy responded with status ${response.status}`;
      console.warn('Unable to persist onboarding progress', message);
      return null;
    }

    const { success, progress, error } = (await response.json()) as {
      success: boolean;
      progress: OnboardingProgress | null;
      error?: string;
    };

    if (!success || !progress) {
      const message = error ?? 'Unable to persist onboarding progress';
      console.warn(message);
      return null;
    }

    return progress;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to persist onboarding progress';
    console.warn(message);
    return null;
  }
};
