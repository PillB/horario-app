-- =============================================================================
-- Migration: 20261111000099_plans_entitlements.sql
-- CHG-099 — plans Gratis / Esencial / Pro, entitlements, monthly auto-schedule quota
--
-- 1. subscriptions.tier: the four old names become the three plans
--    (free → gratis, starter → esencial, growth → pro, pro stays pro).
-- 2. account_entitlements: who has which plan, from when to when and why
--    (trial, tester, comp, paddle). The server reads it on every gated request;
--    the effective plan is the highest row that is active now. Rows are never
--    updated except to revoke them, so the table is its own audit log.
-- 3. usage_limits: the auto-schedule count is per calendar month (UTC) and the
--    quota is checked and consumed atomically by consume_auto_assign().
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. Plan names ────────────────────────────────────────────────────────────

do $$
declare
  c record;
begin
  -- The old check is an unnamed column constraint; drop whichever checks mention tier.
  for c in
    select conname from pg_constraint
    where conrelid = 'public.subscriptions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%tier%'
  loop
    execute format('alter table public.subscriptions drop constraint %I', c.conname);
  end loop;
end $$;

update public.subscriptions set tier = case tier
  when 'free' then 'gratis'
  when 'starter' then 'esencial'
  when 'growth' then 'pro'
  else tier
end
where tier in ('free', 'starter', 'growth');

alter table public.subscriptions alter column tier set default 'gratis';
alter table public.subscriptions
  add constraint subscriptions_tier_plan check (tier in ('gratis', 'esencial', 'pro'));

-- ── 2. Entitlements ──────────────────────────────────────────────────────────

create table if not exists public.account_entitlements (
  id             uuid        primary key default gen_random_uuid(),
  account_id     text        not null check (length(account_id) between 1 and 200),
  plan           text        not null check (plan in ('gratis', 'esencial', 'pro')),
  source         text        not null check (source in ('paddle', 'comp', 'tester', 'trial')),
  starts_at      timestamptz not null default now(),
  -- null = no end date
  ends_at        timestamptz,
  -- Locations this row pays for; null = the plan's default
  location_quota integer     check (location_quota is null or location_quota between 1 and 1000),
  granted_by     text        not null,
  reason         text        check (reason is null or length(reason) <= 500),
  revoked_at     timestamptz,
  revoked_by     text,
  created_at     timestamptz not null default now(),
  constraint account_entitlements_period check (ends_at is null or ends_at > starts_at),
  constraint account_entitlements_revoke check ((revoked_at is null) = (revoked_by is null))
);

create index if not exists account_entitlements_account_idx
  on public.account_entitlements (account_id, starts_at desc);

-- One trial per account, ever (a revoked or expired trial still counts).
create unique index if not exists account_entitlements_one_trial
  on public.account_entitlements (account_id) where source = 'trial';

alter table public.account_entitlements enable row level security;

revoke all on public.account_entitlements from anon;
revoke insert, update, delete, truncate on public.account_entitlements from authenticated;
grant select on public.account_entitlements to authenticated;
-- The proxy grants and revokes; nobody deletes a grant.
grant select, insert, update on public.account_entitlements to service_role;
revoke delete, truncate on public.account_entitlements from service_role;

drop policy if exists "Tenant reads own rows" on public.account_entitlements;
create policy "Tenant reads own rows" on public.account_entitlements
  for select to authenticated
  using (account_id = (select private.current_account_id()));

-- A grant is fixed once written: only the revoke columns may change, and only once.
create or replace function private.account_entitlements_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null then
    raise exception 'entitlement % is already revoked', old.id;
  end if;
  if new.id is distinct from old.id
     or new.account_id is distinct from old.account_id
     or new.plan is distinct from old.plan
     or new.source is distinct from old.source
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.location_quota is distinct from old.location_quota
     or new.granted_by is distinct from old.granted_by
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at then
    raise exception 'an entitlement cannot be edited; revoke it and grant a new one';
  end if;
  return new;
end $$;

drop trigger if exists account_entitlements_guard on public.account_entitlements;
create trigger account_entitlements_guard
  before update on public.account_entitlements
  for each row execute function private.account_entitlements_guard();

-- ── 3. Monthly auto-schedule quota ───────────────────────────────────────────

alter table public.usage_limits
  add column if not exists auto_assign_month text
    check (auto_assign_month is null or auto_assign_month ~ '^\d{4}-\d{2}$'),
  add column if not exists auto_assign_month_count integer not null default 0
    check (auto_assign_month_count >= 0);

-- Auto-schedule runs the account applied this calendar month (UTC).
create or replace function public.auto_assign_month_count(p_account_id text)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(auto_assign_month_count), 0)::integer
  from public.usage_limits
  where account_id = p_account_id
    and auto_assign_month = to_char(now() at time zone 'utc', 'YYYY-MM');
$$;

-- Counts one run when the account is under p_limit this month (null = no limit).
-- Returns the account's count for the month, or -1 when the limit is reached
-- (nothing is counted then). Serialized per account.
create or replace function public.consume_auto_assign(p_user_id text, p_account_id text, p_limit integer)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  this_month text := to_char(now() at time zone 'utc', 'YYYY-MM');
  used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('auto_assign:' || p_account_id, 0));
  used := public.auto_assign_month_count(p_account_id);
  if p_limit is not null and used >= p_limit then
    return -1;
  end if;
  insert into public.usage_limits (user_id, account_id, auto_assign_count, auto_assign_month, auto_assign_month_count)
  values (p_user_id, p_account_id, 1, this_month, 1)
  on conflict (user_id, account_id) do update set
    auto_assign_count = public.usage_limits.auto_assign_count + 1,
    auto_assign_month = this_month,
    auto_assign_month_count = case
      when public.usage_limits.auto_assign_month = this_month then public.usage_limits.auto_assign_month_count + 1
      else 1
    end;
  return used + 1;
end $$;

revoke all on function public.auto_assign_month_count(text) from public, anon, authenticated;
revoke all on function public.consume_auto_assign(text, text, integer) from public, anon, authenticated;
grant execute on function public.auto_assign_month_count(text) to service_role;
grant execute on function public.consume_auto_assign(text, text, integer) to service_role;
