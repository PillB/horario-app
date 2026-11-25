-- Roster rules for simultaneous requests (pgTAP, CHG-101). Run with: supabase test db
-- A worker is never booked on two overlapping shifts, whatever the template;
-- an auto-schedule run is counted and saved together or not at all.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into public.workers (id, account_id, name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'acct_o', 'Ana', 'Cook'),
  ('00000000-0000-0000-0000-0000000000d2', 'acct_o', 'Ben', 'Cook');
insert into public.shift_templates (id, account_id, name, role, start_time, end_time, coverage) values
  ('00000000-0000-0000-0000-0000000000e1', 'acct_o', 'AM',    'Cook', '08:00', '16:00', 1),
  ('00000000-0000-0000-0000-0000000000e2', 'acct_o', 'Mid',   'Cook', '12:00', '20:00', 1),
  ('00000000-0000-0000-0000-0000000000e3', 'acct_o', 'PM',    'Cook', '16:00', '22:00', 1),
  ('00000000-0000-0000-0000-0000000000e4', 'acct_o', 'Night', 'Cook', '22:00', '06:00', 1),
  ('00000000-0000-0000-0000-0000000000e5', 'acct_o', 'Early', 'Cook', '05:00', '09:00', 1);
insert into public.roster (account_id, date, worker_id, template_id) values
  ('acct_o', '2026-12-01', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1');

-- ── No double booking ────────────────────────────────────────────────────────
select throws_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id) values ('acct_o', '2026-12-01', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2')$$,
  '23P01', 'This person already has a shift on 2026-12-01 from 08:00 to 16:00', 'an overlapping shift with another template is refused, and the message names the clash');
select lives_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id) values ('acct_o', '2026-12-01', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e3')$$,
  'a shift that starts when the other ends is fine');
select lives_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id) values ('acct_o', '2026-12-01', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e2')$$,
  'another worker at the same time is fine');
select lives_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id) values ('acct_o', '2026-12-01', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e4')$$,
  'a night shift after the evening shift is fine');
select throws_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id) values ('acct_o', '2026-12-02', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e5')$$,
  '23P01', null, 'a night shift runs into the next day: an early shift there is refused');
select throws_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id) values
      ('acct_o', '2026-12-05', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1'),
      ('acct_o', '2026-12-05', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2')$$,
  '23P01', null, 'two overlapping shifts in one statement are refused');
select is((select count(*)::integer from public.roster where account_id = 'acct_o' and date = '2026-12-05'), 0, 'and neither is stored');
select lives_ok(
  $$update public.roster set status = 'Published' where account_id = 'acct_o' and template_id = '00000000-0000-0000-0000-0000000000e1'$$,
  'publishing a stored shift is not re-checked');
select throws_ok(
  $$update public.roster set template_id = '00000000-0000-0000-0000-0000000000e2'
     where account_id = 'acct_o' and worker_id = '00000000-0000-0000-0000-0000000000d1' and template_id = '00000000-0000-0000-0000-0000000000e3'$$,
  '23P01', null, 'moving a shift onto another one is refused');

-- ── An auto-schedule run is counted and saved together ───────────────────────
select is(
  (public.apply_auto_assign('user_o', 'acct_o', 2, '[{"id":"00000000-0000-0000-0000-0000000000f1","date":"2026-12-10","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e1","status":"Draft"},{"id":"00000000-0000-0000-0000-0000000000f2","date":"2026-12-10","worker_id":"00000000-0000-0000-0000-0000000000d2","template_id":"00000000-0000-0000-0000-0000000000e2"}]') -> 'count')::integer,
  1, 'a run is counted');
select is((select count(*)::integer from public.roster where account_id = 'acct_o' and date = '2026-12-10' and status = 'Draft' and not notified), 2, 'and its shifts are stored as drafts');
select throws_ok(
  $$select public.apply_auto_assign('user_o', 'acct_o', 2, '[{"id":"00000000-0000-0000-0000-0000000000f3","date":"2026-12-11","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e1"},{"id":"00000000-0000-0000-0000-0000000000f4","date":"2026-12-10","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e2"}]')$$,
  '23P01', null, 'a run with a shift the roster refuses fails as a whole');
select is(public.auto_assign_month_count('acct_o'), 1, 'and is not counted');
select is((select count(*)::integer from public.roster where account_id = 'acct_o' and date = '2026-12-11'), 0, 'and none of its shifts is stored');
select is(
  (public.apply_auto_assign('user_o', 'acct_o', 2, '[{"id":"00000000-0000-0000-0000-0000000000f5","date":"2026-12-12","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e1"}]') -> 'count')::integer,
  2, 'the second run of the month is counted');
select is(
  public.apply_auto_assign('user_o', 'acct_o', 2, '[{"id":"00000000-0000-0000-0000-0000000000f6","date":"2026-12-13","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e1"}]'),
  '{"limited": true}'::jsonb, 'at the limit nothing is saved');

-- ── A retry after a lost answer is the same run (CHG-109) ────────────────────
select is(
  public.apply_auto_assign('user_o', 'acct_o', 2, '[{"id":"00000000-0000-0000-0000-0000000000f5","date":"2026-12-12","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e1"}]') - 'rows',
  '{"count": 2, "replayed": true}'::jsonb, 'a retry of a saved run is a replay, even with the month used up');
select is(
  public.apply_auto_assign('user_o', 'acct_o', 2, '[{"id":"00000000-0000-0000-0000-0000000000f5","date":"2026-12-12","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e1"}]') -> 'rows' -> 0 ->> 'id',
  '00000000-0000-0000-0000-0000000000f5', 'and answers with the stored shifts');
select is(public.auto_assign_month_count('acct_o'), 2, 'and is not counted again');
select throws_ok(
  $$select public.apply_auto_assign('user_o', 'acct_o', null, '[{"id":"00000000-0000-0000-0000-0000000000f5","date":"2026-12-12","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e1"},{"id":"00000000-0000-0000-0000-0000000000f7","date":"2026-12-12","worker_id":"00000000-0000-0000-0000-0000000000d2","template_id":"00000000-0000-0000-0000-0000000000e1"}]')$$,
  '23505', null, 'a batch where only some shifts are stored still fails');
select is((select count(*)::integer from public.roster where id = '00000000-0000-0000-0000-0000000000f7'), 0, 'and saves none of them');
select throws_ok(
  $$select public.apply_auto_assign('user_w', 'acct_w', null, '[{"id":"00000000-0000-0000-0000-0000000000f5","date":"2026-12-12","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e1"}]')$$,
  '23505', null, 'shifts stored by another account are not a replay for this one');

-- ── A counted run fills one week (CHG-108) ───────────────────────────────────
select throws_ok(
  $$select public.apply_auto_assign('user_w', 'acct_w', 1, '[{"id":"00000000-0000-0000-0000-0000000000a1","date":"2026-12-13","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e1"},{"id":"00000000-0000-0000-0000-0000000000a2","date":"2026-12-14","worker_id":"00000000-0000-0000-0000-0000000000d2","template_id":"00000000-0000-0000-0000-0000000000e1"}]')$$,
  '22023', 'apply_auto_assign: a counted run fills one week, Monday to Sunday',
  'on a limited plan, a run from Sunday into the next Monday is refused');
select is(public.auto_assign_month_count('acct_w'), 0, 'and is not counted');
select is(
  (select count(*)::integer from public.roster r
    where r.id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2')),
  0, 'and saves nothing');
select is(
  (public.apply_auto_assign('user_o', 'acct_o', null, '[{"id":"00000000-0000-0000-0000-0000000000a3","date":"2026-12-27","worker_id":"00000000-0000-0000-0000-0000000000d2","template_id":"00000000-0000-0000-0000-0000000000e1"},{"id":"00000000-0000-0000-0000-0000000000a4","date":"2026-12-28","worker_id":"00000000-0000-0000-0000-0000000000d2","template_id":"00000000-0000-0000-0000-0000000000e1"}]') -> 'count')::integer,
  3, 'without a limit, a batch across two weeks is saved and counted');

-- The proxy writes as service_role, which has no access to schema private.
set local role service_role;
select lives_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id) values ('acct_o', '2026-12-20', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1')$$,
  'the service role can add a shift');
select throws_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id) values ('acct_o', '2026-12-20', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e2')$$,
  '23P01', null, 'and its overlapping shift is refused');
select is(
  public.apply_auto_assign('user_o', 'acct_o', 2, '[{"id":"00000000-0000-0000-0000-0000000000f5","date":"2026-12-12","worker_id":"00000000-0000-0000-0000-0000000000d1","template_id":"00000000-0000-0000-0000-0000000000e1"}]') ->> 'replayed',
  'true', 'the service role gets the replay too');
reset role;

select * from finish();
rollback;
