-- Rules of the row that crossing requests cannot undo (pgTAP, CHG-100).
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.demand_targets (account_id, date, role, required, source) values
  ('acct_keep', '2026-12-01', 'Cook', 4, 'override'),
  ('acct_keep', '2026-12-02', 'Cook', 2, 'model');

-- What the forecast does: upsert model rows on (account_id, date, role).
insert into public.demand_targets (account_id, date, role, required, source) values
  ('acct_keep', '2026-12-01', 'Cook', 9, 'model'),
  ('acct_keep', '2026-12-02', 'Cook', 9, 'model')
on conflict (account_id, date, role) do update set required = excluded.required, source = excluded.source;

select is(
  (select required::integer || ' ' || source from public.demand_targets where account_id = 'acct_keep' and date = '2026-12-01'),
  '4 override', 'a model row does not replace an override');
select is(
  (select required::integer from public.demand_targets where account_id = 'acct_keep' and date = '2026-12-02'),
  9, 'a model row replaces a model row');
update public.demand_targets set required = 6 where account_id = 'acct_keep' and date = '2026-12-01';
select is(
  (select required::integer from public.demand_targets where account_id = 'acct_keep' and date = '2026-12-01'),
  6, 'an override is changed by an override');
delete from public.demand_targets where account_id = 'acct_keep' and date = '2026-12-01';
select is(
  (select count(*)::integer from public.demand_targets where account_id = 'acct_keep' and date = '2026-12-01'),
  0, 'an override can be deleted');

insert into public.onboarding_progress (account_id, user_id, workers_completed, templates_completed, forecast_completed)
  values ('acct_keep', 'user_keep', true, false, true);
insert into public.onboarding_progress (account_id, user_id, workers_completed, templates_completed, forecast_completed)
  values ('acct_keep', 'user_keep', false, true, false)
on conflict (account_id, user_id) do update set
  workers_completed = excluded.workers_completed,
  templates_completed = excluded.templates_completed,
  forecast_completed = excluded.forecast_completed;
select is(
  (select workers_completed::text || templates_completed::text || forecast_completed::text
     from public.onboarding_progress where account_id = 'acct_keep' and user_id = 'user_keep'),
  'truetruetrue', 'a finished step stays finished and a new one is added');
select is(
  (select count(*)::integer from public.onboarding_progress where account_id = 'acct_keep'),
  1, 'still one row per account and user');

select * from finish();
rollback;
