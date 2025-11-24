import { SupabaseClient } from '@supabase/supabase-js';
import { PostgrestFilterBuilder } from '@supabase/postgrest-js';

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

const TABLE_NAME = 'onboarding_progress';

const applyUserFilter = (
  query: PostgrestFilterBuilder<unknown, unknown, unknown[], unknown>,
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
  const client = getSupabaseClient();
  if (!client) return null;

  const payload = {
    account_id: accountId,
    user_id: userId ?? null,
    workers_completed: flags.workers,
    templates_completed: flags.templates,
    forecast_completed: flags.forecast,
  };

  const { error } = await client
    .from(TABLE_NAME)
    .upsert(payload, { onConflict: 'account_id,user_id' })
    .select('workers_completed, templates_completed, forecast_completed')
    .single();

  if (error) {
    console.warn('Unable to persist onboarding progress', error.message);
    return null;
  }

  return flags;
};
