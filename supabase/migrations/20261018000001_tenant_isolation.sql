-- =============================================================================
-- Migration: 20261018000001_tenant_isolation.sql
-- CHG-069 — tenant isolation for every table
--
-- Problems fixed (QA red-team baseline 2026-10-18, findings S4 and S6):
--   * Several tables kept policies granting the public `anon` role read (and,
--     for onboarding_progress, write) access with no tenant predicate. The anon
--     key ships in the client bundle, so anyone could dump those tables.
--   * shifts / external_signals / demand_targets had no account_id at all, and
--     demand_targets was unique on (date, role) globally, so tenants overwrote
--     each other's forecasts.
--   * private.jwt_account_id() read an `account_id` claim that Clerk session
--     tokens never carry.
--
-- Model after this migration:
--   * Tenant = Clerk organization id when the session has an active org
--     (session token v2 claim `o.id`, v1 claim `org_id`), otherwise the Clerk
--     user id (`sub`). Supabase receives Clerk session tokens through its
--     native third-party auth integration, which maps them to the
--     `authenticated` role.
--   * `anon` has no access to any application table.
--   * `authenticated` may only SELECT rows of its own tenant. All writes go
--     through the server proxy (service role), which scopes every statement
--     by the verified tenant.
--
-- Also: shift templates and availability may now cross midnight
-- (end < start means the window ends the next day); only start = end is
-- rejected. An atomic counter function replaces the read-then-write usage
-- increment.
--
-- Idempotent: safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Tenant id helper
-- -----------------------------------------------------------------------------

create schema if not exists private;

create or replace function private.current_account_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(coalesce(
    (current_setting('request.jwt.claims', true)::jsonb -> 'o' ->> 'id'),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'),
    (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
  ), '');
$$;

comment on function private.current_account_id() is
  'Tenant id for the current request: Clerk org id (o.id / org_id) when the '
  'session has an active organization, otherwise the Clerk user id (sub). '
  'NULL outside an authenticated request.';

-- Policies are evaluated as the querying role, which needs USAGE on the schema
-- and EXECUTE on the helper. Nothing else in `private` is exposed.
grant usage on schema private to authenticated;
revoke all on function private.current_account_id() from public;
grant execute on function private.current_account_id() to authenticated;

-- The old helper read a claim Clerk never sends; keep it callable for any
-- out-of-tree caller but delegate to the new logic.
create or replace function private.jwt_account_id()
returns text
language sql
stable
set search_path = ''
as $$
  select private.current_account_id();
$$;


-- -----------------------------------------------------------------------------
-- 2. account_id on the forecasting tables
-- -----------------------------------------------------------------------------

alter table public.shifts           add column if not exists account_id text;
alter table public.external_signals add column if not exists account_id text;
alter table public.demand_targets   add column if not exists account_id text;

-- Pre-existing rows cannot be attributed to a tenant, so they stay unreachable
-- (every query filters by account_id). New rows must carry one. NOT VALID keeps
-- the migration non-destructive on databases that already hold legacy rows.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shifts_account_id_required') then
    alter table public.shifts
      add constraint shifts_account_id_required check (account_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_signals_account_id_required') then
    alter table public.external_signals
      add constraint external_signals_account_id_required check (account_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'demand_targets_account_id_required') then
    alter table public.demand_targets
      add constraint demand_targets_account_id_required check (account_id is not null) not valid;
  end if;
end $$;

alter table public.demand_targets drop constraint if exists demand_targets_date_role_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'demand_targets_account_date_role_key') then
    alter table public.demand_targets
      add constraint demand_targets_account_date_role_key unique (account_id, date, role);
  end if;
end $$;

create index if not exists shifts_account_date_idx           on public.shifts (account_id, date);
create index if not exists external_signals_account_date_idx on public.external_signals (account_id, date);


-- -----------------------------------------------------------------------------
-- 3. Replace every policy with tenant-scoped, read-only policies
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  p record;
  tenant_tables text[] := array[
    'shifts', 'external_signals', 'demand_targets', 'onboarding_progress',
    'workers', 'worker_availability', 'shift_templates', 'roster',
    'usage_limits', 'pos_sales', 'shift_messages', 'referrals', 'subscriptions'
  ];
begin
  foreach t in array tenant_tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);

    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);

    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using (account_id = (select private.current_account_id()))',
      'Tenant reads own rows', t
    );
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 4. Allow overnight windows (end < start = ends next day)
-- -----------------------------------------------------------------------------

alter table public.shift_templates drop constraint if exists shift_templates_time_order;
alter table public.worker_availability drop constraint if exists worker_availability_time_order;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shift_templates_nonzero_length') then
    alter table public.shift_templates
      add constraint shift_templates_nonzero_length check (start_time <> end_time);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'worker_availability_nonzero_length') then
    alter table public.worker_availability
      add constraint worker_availability_nonzero_length check (from_time <> to_time);
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 5. Atomic auto-assign usage counter
-- -----------------------------------------------------------------------------

create or replace function public.increment_auto_assign(p_user_id text, p_account_id text)
returns integer
language sql
volatile
set search_path = ''
as $$
  insert into public.usage_limits (user_id, account_id, auto_assign_count)
  values (p_user_id, p_account_id, 1)
  on conflict (user_id, account_id)
  do update set auto_assign_count = public.usage_limits.auto_assign_count + 1
  returning auto_assign_count;
$$;

revoke all on function public.increment_auto_assign(text, text) from public, anon, authenticated;
grant execute on function public.increment_auto_assign(text, text) to service_role;
