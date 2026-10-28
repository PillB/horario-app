-- =============================================================================
-- Migration: 20261021000091_audit_and_slot_guards.sql
-- CHG-091 — location history cannot be erased; the roster slot index is required
--
-- 1. location_history (QA step 3c G5). 20261021000089 left service_role with
--    DELETE "for retention", so anyone holding the proxy key could erase audit
--    rows without a trace (PostgREST DELETE returned 200). DELETE is revoked.
--    The only way to remove rows is public.purge_location_history(p_older_than),
--    SECURITY DEFINER, callable by service_role only, which deletes rows older
--    than the given age and refuses an age under 2 years.
--
-- 2. roster_account_slot_key (QA step 3c G6). 20261021000001 skips the unique
--    index with only a WARNING when duplicates exist, so `supabase db push`
--    passed and the database had no 409 protection. This migration creates the
--    index when it is missing and there are no duplicates, and otherwise
--    RAISES, so the push fails and names the duplicate groups to clean up.
--    The check lives in private.ensure_roster_slot_key() so the pgTAP suite can
--    exercise it.
--
-- Idempotent: safe to re-run. On a fresh database (supabase db reset) the
-- index already exists from 20261021000001 and step 2 is a no-op.
-- =============================================================================

-- ── 1. location_history: no direct deletes ───────────────────────────────────

revoke delete on public.location_history from service_role;
revoke delete on public.location_history from anon, authenticated;

create or replace function public.purge_location_history(p_older_than interval)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged integer;
begin
  -- Compared as dates from now, so '730 days' and '2 years' mean what they say.
  if p_older_than is null or now() - p_older_than > now() - interval '2 years' then
    raise exception 'location history is kept at least 2 years; got %', coalesce(p_older_than::text, 'null')
      using errcode = '22023';
  end if;
  delete from public.location_history where changed_at < now() - p_older_than;
  get diagnostics purged = row_count;
  return purged;
end;
$$;

comment on function public.purge_location_history(interval) is
  'Deletes location_history rows older than p_older_than (at least 2 years). service_role only; the table itself grants no DELETE.';

revoke all on function public.purge_location_history(interval) from public, anon, authenticated;
grant execute on function public.purge_location_history(interval) to service_role;

-- ── 2. roster_account_slot_key must exist ────────────────────────────────────

create or replace function private.ensure_roster_slot_key()
returns void
language plpgsql
set search_path = ''
as $$
declare
  duplicate_slots integer;
begin
  if exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'roster_account_slot_key'
      and i.indrelid = 'public.roster'::regclass
      and i.indisunique
  ) then
    return;
  end if;
  if to_regclass('public.roster_account_slot_key') is not null then
    raise exception 'public.roster_account_slot_key exists but is not a unique index on public.roster'
      using hint = 'Drop it, then run the migrations again.';
  end if;

  select count(*) into duplicate_slots
  from (
    select 1
    from public.roster
    group by account_id, date, worker_id, template_id
    having count(*) > 1
  ) d;

  if duplicate_slots > 0 then
    raise exception 'roster_account_slot_key is missing and % (account_id, date, worker_id, template_id) groups have duplicate rows', duplicate_slots
      using errcode = '23505',
            hint = 'Remove the extra roster rows (keep one per group), then run the migrations again.';
  end if;

  create unique index if not exists roster_account_slot_key
    on public.roster (account_id, date, worker_id, template_id);
  comment on index public.roster_account_slot_key is
    'One roster row per (tenant, date, worker, shift template); the proxy maps a clash to 409.';
end;
$$;

revoke all on function private.ensure_roster_slot_key() from public;

select private.ensure_roster_slot_key();
