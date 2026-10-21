-- =============================================================================
-- Migration: 20261021000001_roster_unique_slot.sql
-- CHG-088 — one roster row per worker, date and shift template
--
-- The roster is now loaded from and saved to the database on every device
-- (before CHG-088 a failed save still showed as saved). Two devices adding
-- the same assignment at once both inserted a row, and nothing in the
-- database stopped it; the client only checked its own copy. A unique index
-- makes the second insert fail (23505), which the secure proxy reports as
-- 409 "Conflicting record".
--
-- Non-destructive: when a database already holds duplicates, the index is
-- not created and a WARNING names the count, so an operator can decide which
-- rows to keep (they may differ in status, notified or messages). Re-running
-- after the cleanup creates it.
--
-- RLS is unchanged: roster keeps its one authenticated SELECT-own-tenant
-- policy and no direct writes (20261018000001_tenant_isolation.sql).
--
-- Idempotent: safe to re-run.
-- =============================================================================

do $$
declare
  duplicate_slots integer;
begin
  if to_regclass('public.roster_account_slot_key') is not null then
    return;
  end if;

  select count(*) into duplicate_slots
  from (
    select 1
    from public.roster
    group by account_id, date, worker_id, template_id
    having count(*) > 1
  ) d;

  if duplicate_slots > 0 then
    raise warning 'roster_account_slot_key not created: % (account_id, date, worker_id, template_id) groups have duplicate rows; remove the extra rows and re-run this migration', duplicate_slots;
    return;
  end if;

  create unique index roster_account_slot_key
    on public.roster (account_id, date, worker_id, template_id);
  comment on index public.roster_account_slot_key is
    'One roster row per (tenant, date, worker, shift template); the proxy maps a clash to 409.';
end $$;
