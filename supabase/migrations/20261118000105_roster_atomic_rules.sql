-- =============================================================================
-- Roster rules that hold when two requests arrive together (CHG-101)
--
-- 1. No double booking. The app refused a shift that overlaps another shift of
--    the same worker, but only against the roster on that manager's screen: two
--    managers (or two tabs) could each add an overlapping shift with a different
--    template, and the unique slot (date, worker, template) did not see it.
--    A trigger now checks the overlap in the database, behind a lock per
--    account, in the same transaction as the write.
-- 2. An auto-schedule is counted and saved in one transaction
--    (apply_auto_assign): a run whose shifts are refused is not counted, and a
--    run over the monthly limit saves nothing.
--
-- Times are the template's wall-clock times on the shift's date (an end at or
-- before the start is the next day). Rows already stored are not re-checked:
-- only a new shift, or a shift whose date, worker or template changes.
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace function private.roster_shift_span(p_date date, p_template_id uuid, out starts timestamp, out ends timestamp)
language sql
stable
set search_path = ''
as $$
  select
    p_date + t.start_time::time,
    p_date + t.end_time::time + case when t.end_time::time <= t.start_time::time then interval '1 day' else interval '0' end
  from public.shift_templates t
  where t.id = p_template_id
$$;

create or replace function private.roster_no_overlap()
returns trigger
language plpgsql
-- Runs as its owner: the roles that write the roster have no access to schema private.
security definer
set search_path = ''
as $$
declare
  span record;
  clash record;
begin
  if tg_op = 'UPDATE'
     and new.date = old.date and new.worker_id = old.worker_id and new.template_id = old.template_id then
    return new;
  end if;

  -- One roster write per account at a time, so the check below sees every
  -- shift a request that held the lock committed.
  perform pg_advisory_xact_lock(hashtextextended('roster:' || new.account_id, 0));

  select * into span from private.roster_shift_span(new.date, new.template_id);
  if span.starts is null then
    return new; -- no such template: the foreign key refuses the row
  end if;

  select r.date, t.start_time, t.end_time into clash
  from public.roster r
  join public.shift_templates t on t.id = r.template_id
  cross join lateral private.roster_shift_span(r.date, r.template_id) other
  where r.account_id = new.account_id
    and r.worker_id = new.worker_id
    and r.id <> new.id
    -- The same slot is the unique index's to refuse (23505), with its own message.
    and not (r.date = new.date and r.template_id = new.template_id)
    and r.date between new.date - 1 and new.date + 1
    and other.starts < span.ends
    and span.starts < other.ends
  limit 1;

  if found then
    raise exception 'This person already has a shift on % from % to %', clash.date, clash.start_time, clash.end_time
      using errcode = '23P01';
  end if;
  return new;
end $$;

revoke all on function private.roster_no_overlap() from public, anon, authenticated;

drop trigger if exists roster_no_overlap on public.roster;
create trigger roster_no_overlap
  before insert or update of date, worker_id, template_id on public.roster
  for each row execute function private.roster_no_overlap();

-- Counts one auto-schedule run and saves its shifts, or does neither.
-- p_rows: an array of {id, date, worker_id, template_id, location, status}.
-- Returns {"limited": true} when the month's runs are used up (nothing saved),
-- else {"rows": [...], "count": n}. A shift the roster refuses (already there,
-- overlapping, pointing at a deleted worker) raises, which undoes the count.
create or replace function public.apply_auto_assign(p_user_id text, p_account_id text, p_limit integer, p_rows jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  used integer;
  inserted jsonb;
begin
  if p_account_id is null or p_account_id = '' then
    raise exception 'apply_auto_assign: account is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'apply_auto_assign: 1 to 200 shifts are required' using errcode = '22023';
  end if;

  used := public.consume_auto_assign(p_user_id, p_account_id, p_limit);
  if used < 0 then
    return jsonb_build_object('limited', true);
  end if;

  with added as (
    insert into public.roster as r (id, account_id, date, worker_id, template_id, location, status, notified)
    select x.id, p_account_id, x.date, x.worker_id, x.template_id, coalesce(x.location, ''), coalesce(x.status, 'Draft'), false
    from jsonb_to_recordset(p_rows) as x(id uuid, date date, worker_id uuid, template_id uuid, location text, status text)
    returning to_jsonb(r) as j
  )
  select jsonb_agg(j) into inserted from added;

  return jsonb_build_object('rows', inserted, 'count', used);
end $$;

revoke all on function public.apply_auto_assign(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.apply_auto_assign(text, text, integer, jsonb) to service_role;
