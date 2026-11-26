-- =============================================================================
-- One auto-schedule run fills one week (CHG-108)
--
-- An auto-assign run now fills the Monday to Sunday week of the chosen date, and
-- the free plan includes one such week a month. apply_auto_assign:
-- 1. takes up to 1000 shifts (a week of a large team; was 200, one day), and
-- 2. on a plan with a monthly limit (p_limit not null), refuses a batch whose
--    shifts fall in more than one ISO week (22023), before anything is counted,
--    so one counted run can never fill a month.
-- Unlimited plans (p_limit null) may save any batch, as before.
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
