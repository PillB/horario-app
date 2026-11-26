-- =============================================================================
-- Remove a person together with their shifts (CHG-109, F-11)
--
-- roster.worker_id references workers with ON DELETE RESTRICT, so a person with
-- shifts could not be removed ("Record is still referenced"). On Gratis over the
-- people limit every write except deletes is refused, so an owner whose extra
-- people all had shifts had no way back under the limit except removing every
-- shift one by one.
--
-- delete_worker_with_shifts() removes the person's roster rows and the person in
-- one transaction: both happen or neither does. It takes the account's roster
-- lock (the one roster_no_overlap takes) before it reads, so a shift another
-- request adds for this person at the same time either is removed here or waits
-- for this transaction and then fails on the foreign key (23503, 409 in the
-- proxy). Availability and days off go with the person (ON DELETE CASCADE);
-- messages go with their shift (ON DELETE CASCADE).
--
-- The restrict foreign key stays: a plain delete of a person with shifts is
-- still refused, so shifts are only removed when the manager confirmed it in
-- the app (the proxy calls this only for deleteWorker with withShifts: true).
-- Past shifts are removed too: they are the record of who worked and part of
-- the forecast history (forecast_shift_history). The app says so before the
-- manager confirms. Keeping them would need a "former staff" state for people
-- (not built).
--
-- Service role only. Idempotent: safe to re-run.
-- =============================================================================

create or replace function public.delete_worker_with_shifts(p_account_id text, p_worker_id uuid)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  removed integer;
begin
  if p_account_id is null or p_account_id = '' then
    raise exception 'delete_worker_with_shifts: account is required' using errcode = '22023';
  end if;
  if p_worker_id is null then
    raise exception 'delete_worker_with_shifts: worker is required' using errcode = '22023';
  end if;

  -- The roster lock of roster_no_overlap: no shift for this account is added while this runs.
  perform pg_advisory_xact_lock(hashtextextended('roster:' || p_account_id, 0));

  with gone as (
    delete from public.roster r
    where r.account_id = p_account_id and r.worker_id = p_worker_id
    returning 1
  )
  select count(*) into removed from gone;

  delete from public.workers w where w.id = p_worker_id and w.account_id = p_account_id;
  if not found then
    -- Another account's person, or already removed: nothing is kept from the roster delete above.
    raise exception 'delete_worker_with_shifts: no such worker' using errcode = 'P0002';
  end if;

  return jsonb_build_object('removedShifts', removed);
end $$;

revoke all on function public.delete_worker_with_shifts(text, uuid) from public, anon, authenticated;
grant execute on function public.delete_worker_with_shifts(text, uuid) to service_role;
