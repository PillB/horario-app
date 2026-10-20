-- =============================================================================
-- Migration: 20261020000002_worker_labor_attributes.sql
-- CHG-082 — worker attributes the labor-rule engine needs
--
--   birth_date            minors' rules (hours, night windows, school days)
--   night_worker          night-worker averages (EU art. 8, UK, NL)
--   weekly_limit_opt_out  signed opt-out from the average weekly limit
--                         (UK, EU art. 22)
--   no_fixed_hours        no fixed hours in the contract (Ireland s.17 notice)
--
-- The proxy also requires birth_date to be a real past date with the worker at
-- least 13 years old; that rule depends on today's date, so it is not a CHECK
-- constraint (a CHECK must give the same answer on every run).
--
-- RLS is unchanged: workers already has one authenticated SELECT-own-tenant
-- policy and no direct writes (20261018000001_tenant_isolation.sql), and the
-- new columns fall under it.
--
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.workers add column if not exists birth_date date;
alter table public.workers add column if not exists night_worker boolean not null default false;
alter table public.workers add column if not exists weekly_limit_opt_out boolean not null default false;
alter table public.workers add column if not exists no_fixed_hours boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workers_birth_date_range') then
    alter table public.workers
      add constraint workers_birth_date_range check (birth_date is null or birth_date >= date '1900-01-01');
  end if;
end $$;
