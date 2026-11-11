-- =============================================================================
-- Plan limits that hold under simultaneous requests (CHG-100)
--
-- The proxy counted an account's people (or locations) and then inserted, in
-- two requests. Two managers adding a person at the same moment both saw
-- "one under the limit" and both inserted. insert_within_limit() does the
-- count and the insert in one transaction, behind a lock per account and
-- table, so the second request counts the first one's row.
--
-- The limit is passed in: the plan is decided in server/plans.ts and is not
-- repeated in SQL. Idempotent: safe to re-run.
-- =============================================================================

-- p_rows is one row (a JSON object) or several (an array of objects with the
-- same keys). Returns {"rows": [<the inserted rows>]}, or
-- {"limited": true, "count": n} when the account's n rows plus the new ones
-- would pass p_limit: then nothing is inserted, so a batch is all or nothing.
-- Columns the rows leave out get their defaults. account_id always comes from
-- p_account_id.
drop function if exists public.insert_within_limit(text, text, integer, jsonb);
create function public.insert_within_limit(p_table text, p_account_id text, p_limit integer, p_rows jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  existing integer;
  cols text;
  unknown_key text;
  inserted jsonb;
  batch jsonb;
  keys text[];
begin
  if p_table not in ('workers', 'locations') then
    raise exception 'insert_within_limit: table % is not limited', p_table using errcode = '22023';
  end if;
  if p_account_id is null or p_account_id = '' then
    raise exception 'insert_within_limit: account is required' using errcode = '22023';
  end if;
  batch := case jsonb_typeof(p_rows) when 'array' then p_rows when 'object' then jsonb_build_array(p_rows) end;
  if batch is null or jsonb_array_length(batch) = 0 or jsonb_array_length(batch) > 500 then
    raise exception 'insert_within_limit: 1 to 500 rows are required' using errcode = '22023';
  end if;

  select jsonb_agg(r || jsonb_build_object('account_id', p_account_id)) into batch
  from jsonb_array_elements(batch) as r
  where jsonb_typeof(r) = 'object';
  select array_agg(k order by k) into keys from jsonb_object_keys(batch -> 0) as k;
  if exists (
    select 1 from jsonb_array_elements(batch) as r
    where (select array_agg(k order by k) from jsonb_object_keys(r) as k) is distinct from keys
  ) then
    raise exception 'insert_within_limit: every row needs the same columns' using errcode = '22023';
  end if;

  select k into unknown_key
  from unnest(keys) as k
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = p_table and c.column_name = k
  )
  limit 1;
  if unknown_key is not null then
    raise exception 'insert_within_limit: % has no column %', p_table, unknown_key using errcode = '22023';
  end if;

  -- Held until this transaction ends. The count below runs after the lock is
  -- granted, so it sees every row a request that held the lock committed.
  perform pg_advisory_xact_lock(hashtextextended('plan_limit:' || p_table || ':' || p_account_id, 0));

  execute format('select count(*)::integer from public.%I where account_id = $1', p_table)
    into existing using p_account_id;
  if p_limit is not null and existing + jsonb_array_length(batch) > p_limit then
    return jsonb_build_object('limited', true, 'count', existing);
  end if;

  select string_agg(quote_ident(k), ', ') into cols from unnest(keys) as k;
  execute format(
    'with added as (insert into public.%1$I as t (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) returning to_jsonb(t) as j) select jsonb_agg(j) from added',
    p_table, cols
  ) into inserted using batch;

  return jsonb_build_object('rows', inserted);
end $$;

revoke all on function public.insert_within_limit(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.insert_within_limit(text, text, integer, jsonb) to service_role;
