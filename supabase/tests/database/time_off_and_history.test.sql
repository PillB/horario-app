-- CHG-098: worker_time_off (days off) and forecast_shift_history (the view the
-- demand forecast reads). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into public.workers (id, account_id, name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'user_a', 'Ana', 'Barista'),
  ('00000000-0000-0000-0000-0000000000b1', 'org_b',  'Bruno', 'Cook');
insert into public.shift_templates (id, account_id, name, role, start_time, end_time, coverage) values
  ('00000000-0000-0000-0000-0000000000a2', 'user_a', 'Morning', 'Barista', '07:00', '15:30', 1),
  ('00000000-0000-0000-0000-0000000000b2', 'org_b',  'Night',   'Cook',    '22:00', '06:00', 1);
insert into public.worker_time_off (account_id, worker_id, date, reason) values
  ('user_a', '00000000-0000-0000-0000-0000000000a1', '2026-12-24', 'Holiday'),
  ('org_b',  '00000000-0000-0000-0000-0000000000b1', '2026-12-25', '');

-- ── Days off ─────────────────────────────────────────────────────────────────
select throws_ok(
  $$insert into public.worker_time_off (account_id, worker_id, date) values ('user_a', '00000000-0000-0000-0000-0000000000a1', '2026-12-24')$$,
  '23505', null, 'one day off per worker and date');
select throws_ok(
  $$insert into public.worker_time_off (account_id, worker_id, date, reason) values ('user_a', '00000000-0000-0000-0000-0000000000a1', '2026-12-26', repeat('x', 201))$$,
  '23514', null, 'a reason longer than 200 characters is rejected');

set local role anon;
select throws_ok('select * from public.worker_time_off', '42501', null, 'anon cannot read days off');
select throws_ok('select * from public.forecast_shift_history', '42501', null, 'anon cannot read the forecast history');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"user_a","role":"authenticated"}';
select results_eq('select date::text from public.worker_time_off', $$values ('2026-12-24'::text)$$, 'A sees only its days off');
select throws_ok($$insert into public.worker_time_off (account_id, worker_id, date) values ('user_a', '00000000-0000-0000-0000-0000000000a1', '2026-12-27')$$, '42501', null, 'signed-in users cannot add days off directly');
select throws_ok($$delete from public.worker_time_off$$, '42501', null, 'signed-in users cannot delete days off directly');
select throws_ok('select * from public.forecast_shift_history', '42501', null, 'signed-in users cannot read the forecast history directly');
reset role;

delete from public.workers where id = '00000000-0000-0000-0000-0000000000b1';
select is_empty($$select 1 from public.worker_time_off where account_id = 'org_b'$$, 'deleting a worker deletes their days off');

-- ── Forecast history ─────────────────────────────────────────────────────────
insert into public.workers (id, account_id, name, role) values ('00000000-0000-0000-0000-0000000000b1', 'org_b', 'Bruno', 'Cook');
insert into public.roster (account_id, date, worker_id, template_id, status) values
  ('user_a', '2026-10-05', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'Published'),
  ('user_a', '2026-10-06', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'Draft'),
  ('user_a', '2026-10-07', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 'Published'),
  ('org_b',  '2026-10-05', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'Published');
insert into public.shifts (account_id, date, role, worker_id, hours) values ('user_a', '2026-10-07', 'Barista', 'imported', 6);

select results_eq(
  $$select date::text, role, hours::numeric from public.forecast_shift_history where account_id = 'user_a' order by date$$,
  $$values ('2026-10-05'::text, 'Barista'::text, 8.50::numeric), ('2026-10-07', 'Barista', 6.00)$$,
  'a published shift counts with its template role and hours; a day with imported rows is not counted twice');
select is_empty(
  $$select 1 from public.forecast_shift_history where account_id = 'user_a' and date = '2026-10-06'$$,
  'a draft shift is not history');
select results_eq(
  $$select hours::numeric from public.forecast_shift_history where account_id = 'org_b'$$,
  $$values (8.00::numeric)$$,
  'an overnight shift counts its hours across midnight');
select results_eq(
  $$select count(*)::int from (select id from public.forecast_shift_history group by id having count(*) > 1) d$$,
  'values (0)', 'ids are unique across both sources');
select results_eq(
  $$select count(*)::int from public.forecast_shift_history where account_id = 'org_b' and role = 'Barista'$$,
  'values (0)', 'a tenant row never carries another tenant''s template');
select is(
  (select has_table_privilege('service_role', 'public.forecast_shift_history', 'select')), true,
  'the secure proxy can read the forecast history');

select * from finish();
rollback;
