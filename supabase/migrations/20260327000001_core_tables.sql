-- =============================================================================
-- Migration: core scheduling tables
-- Created:   2026-03-27
-- Depends:   20240613120000_onboarding_progress.sql
--
-- Adds four tables that back the live scheduling flows:
--   workers             – worker profiles per account
--   worker_availability – recurring weekly availability windows per worker
--   shift_templates     – reusable shift definitions per account
--   roster              – assigned (draft / published) shifts
--
-- NOTE: CREATE POLICY does not support IF NOT EXISTS in PostgreSQL.
--       Each policy is preceded by DROP POLICY IF EXISTS to make this
--       migration safely re-runnable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- workers
-- ---------------------------------------------------------------------------
create table if not exists public.workers (
  id          uuid        primary key default gen_random_uuid(),
  account_id  text        not null,
  name        text        not null check (char_length(name) between 1 and 100),
  role        text        not null check (char_length(role) between 1 and 100),
  skills      text[]      not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists workers_account_id_idx on public.workers (account_id);

alter table public.workers enable row level security;

drop policy if exists "Anon read workers" on public.workers;
create policy "Anon read workers"
  on public.workers for select
  using (auth.role() = 'anon');

drop policy if exists "Service role manages workers" on public.workers;
create policy "Service role manages workers"
  on public.workers for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- worker_availability
-- ---------------------------------------------------------------------------
create table if not exists public.worker_availability (
  id          uuid primary key default gen_random_uuid(),
  account_id  text not null,
  worker_id   uuid not null references public.workers (id) on delete cascade,
  day_of_week text not null
    check (day_of_week in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun')),
  from_time   text not null
    check (from_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  to_time     text not null
    check (to_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  constraint worker_availability_time_order check (from_time < to_time)
);

create index if not exists worker_availability_worker_id_idx
  on public.worker_availability (worker_id);

create index if not exists worker_availability_account_id_idx
  on public.worker_availability (account_id);

-- Unique availability slot per worker+day+from_time (prevents exact duplicates).
-- onConflict key used by proxy: 'worker_id,day_of_week,from_time'
do $$ begin
  alter table public.worker_availability
    add constraint worker_availability_unique_slot
    unique (worker_id, day_of_week, from_time);
exception when duplicate_object then
  null;
end $$;

alter table public.worker_availability enable row level security;

drop policy if exists "Anon read worker availability" on public.worker_availability;
create policy "Anon read worker availability"
  on public.worker_availability for select
  using (auth.role() = 'anon');

drop policy if exists "Service role manages worker availability" on public.worker_availability;
create policy "Service role manages worker availability"
  on public.worker_availability for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- shift_templates
-- ---------------------------------------------------------------------------
create table if not exists public.shift_templates (
  id          uuid        primary key default gen_random_uuid(),
  account_id  text        not null,
  name        text        not null check (char_length(name) between 1 and 100),
  role        text        not null check (char_length(role) between 1 and 100),
  start_time  text        not null check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time    text        not null check (end_time   ~ '^[0-2][0-9]:[0-5][0-9]$'),
  coverage    integer     not null default 1 check (coverage >= 1),
  created_at  timestamptz not null default now(),
  constraint shift_templates_time_order check (start_time < end_time)
);

create index if not exists shift_templates_account_id_idx
  on public.shift_templates (account_id);

alter table public.shift_templates enable row level security;

drop policy if exists "Anon read shift templates" on public.shift_templates;
create policy "Anon read shift templates"
  on public.shift_templates for select
  using (auth.role() = 'anon');

drop policy if exists "Service role manages shift templates" on public.shift_templates;
create policy "Service role manages shift templates"
  on public.shift_templates for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- roster
-- ---------------------------------------------------------------------------
create table if not exists public.roster (
  id          uuid        primary key default gen_random_uuid(),
  account_id  text        not null,
  date        date        not null,
  worker_id   uuid        not null references public.workers (id) on delete restrict,
  template_id uuid        not null references public.shift_templates (id) on delete restrict,
  location    text        not null default '' check (char_length(location) <= 200),
  status      text        not null default 'Draft'
                check (status in ('Draft', 'Published')),
  notified    boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists roster_account_date_idx
  on public.roster (account_id, date);

create index if not exists roster_worker_id_date_idx
  on public.roster (worker_id, date);

alter table public.roster enable row level security;

drop policy if exists "Anon read roster" on public.roster;
create policy "Anon read roster"
  on public.roster for select
  using (auth.role() = 'anon');

drop policy if exists "Service role manages roster" on public.roster;
create policy "Service role manages roster"
  on public.roster for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- updated_at trigger for roster
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- DROP before CREATE because CREATE TRIGGER has no IF NOT EXISTS in PG < 14.
-- Supabase runs PG 15 but the DROP guard keeps this safe on any version.
drop trigger if exists roster_updated_at on public.roster;
create trigger roster_updated_at
  before update on public.roster
  for each row execute function public.set_updated_at();
