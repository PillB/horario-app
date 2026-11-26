-- =============================================================================
-- State guards, second pass (CHG-109, after the QA thread's review)
--
-- 1. apply_auto_assign treats a batch as a replay only when every row is
--    already stored with the same date, worker and template, not only the
--    same id. Ids are fresh per run today, but a batch that reuses ids for
--    other shifts must fail (23505), not be answered "replayed" and dropped.
-- 2. Moving a Published shift to another date, worker or template clears
--    "told" in the trigger, for every writer (the proxy already did): the
--    person was told about the old shift, not the moved one.
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace function public.apply_auto_assign(p_user_id text, p_account_id text, p_limit integer, p_rows jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  used integer;
  inserted jsonb;
  stored jsonb;
begin
  if p_account_id is null or p_account_id = '' then
    raise exception 'apply_auto_assign: account is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
    raise exception 'apply_auto_assign: 1 to 1000 shifts are required' using errcode = '22023';
  end if;
  if p_limit is not null and (
    select count(distinct date_trunc('week', x.date::timestamp))
    from jsonb_to_recordset(p_rows) as x(date date)
  ) > 1 then
    raise exception 'apply_auto_assign: a counted run fills one week, Monday to Sunday' using errcode = '22023';
  end if;

  -- The same lock consume_auto_assign takes: a concurrent first attempt finishes before this reads.
  perform pg_advisory_xact_lock(hashtextextended('auto_assign:' || p_account_id, 0));
  -- A replay is the same shifts, not only the same ids: a batch that reuses stored ids with another
  -- date, worker or template falls through to the insert and fails on the primary key (23505).
  if not exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(id uuid, date date, worker_id uuid, template_id uuid)
    where not exists (
      select 1 from public.roster r
      where r.id = x.id and r.account_id = p_account_id
        and r.date = x.date and r.worker_id = x.worker_id and r.template_id = x.template_id
    )
  ) then
    select jsonb_agg(to_jsonb(r)) into stored
    from public.roster r
    where r.account_id = p_account_id
      and r.id in (select x.id from jsonb_to_recordset(p_rows) as x(id uuid));
    return jsonb_build_object('rows', stored, 'count', public.auto_assign_month_count(p_account_id), 'replayed', true);
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

-- ── 2. A moved shift was not told ────────────────────────────────────────────
create or replace function private.roster_set_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'Published' then
    if tg_op = 'INSERT' or old.status is distinct from 'Published' then
      new.published_at := now();
    elsif (new.date, new.worker_id, new.template_id) is distinct from (old.date, old.worker_id, old.template_id) then
      new.published_at := now();
      new.notified := false;
    else
      new.published_at := old.published_at;
    end if;
  else
    new.published_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.roster_set_published_at() from public;
