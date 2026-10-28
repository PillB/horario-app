-- =============================================================================
-- Migration: 20261021000089_location_history.sql
-- CHG-089 — change history (audit log) for business locations
--
-- A location's jurisdiction, time zone, industry, headcount and overrides
-- decide which labor rules apply, so every change is recorded: who, when, and
-- the old and new values.
--
-- Design: an AFTER trigger on public.locations writes the history row in the
-- same transaction as the change. That is more robust than writing it from
-- the proxy: no code path (proxy action, migration, SQL console) can change a
-- location without leaving a row, and a failed history insert rolls the
-- change back.
--
-- Who: the proxy uses the service-role key, so the database cannot see the
-- Clerk user. The trigger takes the actor from the transaction-local setting
-- `horario.actor` when set, else from `confirmed_by` (the proxy sets it to the
-- session user on every upsert). Deletes go through public.delete_location(),
-- which sets `horario.actor` in its own transaction. A delete made outside the
-- proxy records changed_by = null.
--
-- Writes: nobody writes the table directly. anon and authenticated get no
-- write grants; service_role keeps only SELECT and DELETE (retention / account
-- removal), so even the proxy cannot insert or edit a history row. The trigger
-- function is SECURITY DEFINER and is the only writer.
--
-- Reads: same tenant RLS as every other table (authenticated SELECT own
-- account_id only, anon nothing).
--
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.location_history (
  id                     bigint      generated always as identity primary key,
  account_id             text        not null,
  -- No foreign key: the history outlives a deleted location.
  location_id            uuid        not null,
  location_name          text        not null,
  action                 text        not null,
  changed_by             text,
  changed_at             timestamptz not null default now(),
  old_jurisdiction_code  text,
  new_jurisdiction_code  text,
  old_time_zone          text,
  new_time_zone          text,
  old_industry           text,
  new_industry           text,
  old_employer_headcount integer,
  new_employer_headcount integer,
  old_overrides          jsonb,
  new_overrides          jsonb
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'location_history_action_known') then
    alter table public.location_history
      add constraint location_history_action_known check (action in ('insert', 'update', 'delete'));
  end if;
end $$;

create index if not exists location_history_account_changed_idx
  on public.location_history (account_id, changed_at desc, id desc);
create index if not exists location_history_location_idx
  on public.location_history (location_id);

-- ── Trigger: one history row per insert, update and delete ──────────────────

create or replace function private.record_location_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := nullif(current_setting('horario.actor', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.location_history (
      account_id, location_id, location_name, action, changed_by,
      new_jurisdiction_code, new_time_zone, new_industry, new_employer_headcount, new_overrides
    ) values (
      new.account_id, new.id, new.name, 'insert', coalesce(actor, new.confirmed_by),
      new.jurisdiction_code, new.time_zone, new.industry, new.employer_headcount, new.overrides
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.location_history (
      account_id, location_id, location_name, action, changed_by,
      old_jurisdiction_code, new_jurisdiction_code, old_time_zone, new_time_zone,
      old_industry, new_industry, old_employer_headcount, new_employer_headcount,
      old_overrides, new_overrides
    ) values (
      new.account_id, new.id, new.name, 'update', coalesce(actor, new.confirmed_by),
      old.jurisdiction_code, new.jurisdiction_code, old.time_zone, new.time_zone,
      old.industry, new.industry, old.employer_headcount, new.employer_headcount,
      old.overrides, new.overrides
    );
    return new;
  else
    insert into public.location_history (
      account_id, location_id, location_name, action, changed_by,
      old_jurisdiction_code, old_time_zone, old_industry, old_employer_headcount, old_overrides
    ) values (
      old.account_id, old.id, old.name, 'delete', actor,
      old.jurisdiction_code, old.time_zone, old.industry, old.employer_headcount, old.overrides
    );
    return old;
  end if;
end;
$$;

revoke all on function private.record_location_history() from public;

drop trigger if exists locations_history on public.locations;
create trigger locations_history
  after insert or update or delete on public.locations
  for each row execute function private.record_location_history();

-- ── Delete with an actor (called by the proxy with the service-role key) ─────

create or replace function public.delete_location(p_account_id text, p_location_id uuid, p_actor text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  deleted integer;
begin
  perform set_config('horario.actor', coalesce(p_actor, ''), true);
  delete from public.locations where id = p_location_id and account_id = p_account_id;
  get diagnostics deleted = row_count;
  perform set_config('horario.actor', '', true);
  return deleted > 0;
end;
$$;

revoke all on function public.delete_location(text, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_location(text, uuid, text) to service_role;

-- ── Row-level security: tenant reads own rows; only the trigger writes ───────

alter table public.location_history enable row level security;

revoke all on public.location_history from anon;
revoke all on public.location_history from authenticated;
grant select on public.location_history to authenticated;
revoke insert, update, truncate, references, trigger on public.location_history from service_role;
grant select, delete on public.location_history to service_role;

drop policy if exists "Tenant reads own rows" on public.location_history;
create policy "Tenant reads own rows" on public.location_history
  for select to authenticated
  using (account_id = (select private.current_account_id()));
