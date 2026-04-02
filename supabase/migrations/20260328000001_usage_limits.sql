-- =============================================================================
-- Migration: usage_limits
-- Created:   2026-03-28
-- Depends:   20240613120000_onboarding_progress.sql
--
-- Tracks per-user freemium usage (e.g. auto-assign calls).
-- user_id is the Clerk user ID (or EXPO_PUBLIC_USER_ID in dev bypass mode).
-- =============================================================================

create table if not exists public.usage_limits (
  id                uuid         not null default gen_random_uuid() primary key,
  user_id           text         not null,
  account_id        text         not null,
  auto_assign_count integer      not null default 0 check (auto_assign_count >= 0),
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),
  constraint usage_limits_user_account_unique unique (user_id, account_id)
);

create index if not exists usage_limits_user_id_idx
  on public.usage_limits (user_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- set_updated_at() is defined in core_tables; CREATE OR REPLACE is safe to
-- re-run here in case this file is applied before core_tables.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists usage_limits_updated_at on public.usage_limits;
create trigger usage_limits_updated_at
  before update on public.usage_limits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.usage_limits enable row level security;

drop policy if exists "Anon read usage limits" on public.usage_limits;
create policy "Anon read usage limits"
  on public.usage_limits for select
  using (auth.role() = 'anon');

drop policy if exists "Service role manages usage limits" on public.usage_limits;
create policy "Service role manages usage limits"
  on public.usage_limits for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
