-- =============================================================================
-- Migration: subscriptions
-- Created:   2026-04-05
-- Depends:   20260327000001_core_tables.sql
--
-- Tracks per-account subscription tier and billing metadata.
-- account_id links to Clerk user/org ID (same key used across all tables).
-- Payment providers: Stripe (global cards) + Culqi (Peru: Yape, cards).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                      uuid        primary key default gen_random_uuid(),
  account_id              text        not null unique,

  -- Tier: free | starter | growth | pro
  tier                    text        not null default 'free'
    check (tier in ('free', 'starter', 'growth', 'pro')),

  -- Billing status
  status                  text        not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'cancelled', 'unpaid')),

  -- Stripe (global cards + annual billing)
  stripe_customer_id      text,
  stripe_subscription_id  text,
  stripe_price_id         text,

  -- Culqi (Peru: Yape, local cards)
  culqi_customer_id       text,
  culqi_charge_id         text,

  -- Billing period
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean     not null default false,
  trial_ends_at           timestamptz,

  -- Payment provider: 'stripe' | 'culqi' | null (free)
  payment_provider        text
    check (payment_provider in ('stripe', 'culqi')),

  -- Billing interval: 'month' | 'year'
  billing_interval        text        default 'month'
    check (billing_interval in ('month', 'year')),

  -- Country code for localized pricing (ISO 3166-1 alpha-2)
  country_code            text        default 'PE',

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists subscriptions_account_id_idx
  on public.subscriptions (account_id);

create index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists subscriptions_culqi_customer_idx
  on public.subscriptions (culqi_customer_id)
  where culqi_customer_id is not null;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.subscriptions enable row level security;

-- Anon clients can read their own account subscription (for tier checks)
drop policy if exists "Anon read own subscription" on public.subscriptions;
create policy "Anon read own subscription"
  on public.subscriptions for select
  using (auth.role() = 'anon');

-- Only service role can write (billing webhooks go through secure proxy)
drop policy if exists "Service role manages subscriptions" on public.subscriptions;
create policy "Service role manages subscriptions"
  on public.subscriptions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Seed free-tier row for all existing accounts that have usage_limits rows
-- (ensures every existing account has a subscription record)
-- ---------------------------------------------------------------------------
insert into public.subscriptions (account_id, tier, status)
select distinct account_id, 'free', 'active'
from public.usage_limits
on conflict (account_id) do nothing;
