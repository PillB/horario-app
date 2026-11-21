-- CHG-102: editing a template's times cannot double-book a person, and template
-- times are clock times (20261121000106_template_time_guards.sql).
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.workers (id, account_id, name, role) values
  ('00000000-0000-0000-0000-0000000001a1', 'acct_t', 'Ana', 'Cook'),
  ('00000000-0000-0000-0000-0000000001a2', 'acct_t', 'Ben', 'Cook');
insert into public.shift_templates (id, account_id, name, role, start_time, end_time, coverage) values
  ('00000000-0000-0000-0000-0000000001b1', 'acct_t', 'Early', 'Cook', '06:00', '14:00', 1),
  ('00000000-0000-0000-0000-0000000001b2', 'acct_t', 'Late',  'Cook', '14:00', '22:00', 1);
-- Ana works both shifts in three days and the early shift the morning after.
insert into public.roster (account_id, date, worker_id, template_id) values
  ('acct_t', current_date + 3,  '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000001b1'),
  ('acct_t', current_date + 3,  '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000001b2'),
  ('acct_t', current_date + 4,  '00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000001b1'),
  ('acct_t', current_date + 4,  '00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000001b1');

-- The proxy writes as service_role.
set local role service_role;
select throws_like(
  $$update public.shift_templates set start_time = '12:00' where id = '00000000-0000-0000-0000-0000000001b2'$$,
  'With these times Ana would be on two shifts at once on %',
  'starting the late shift earlier is refused while someone works both');
select throws_ok(
  $$update public.shift_templates set end_time = '15:00' where id = '00000000-0000-0000-0000-0000000001b1'$$,
  '23P01', null, 'ending the early shift later is refused too');
select lives_ok(
  $$update public.shift_templates set end_time = '23:00' where id = '00000000-0000-0000-0000-0000000001b2'$$,
  'a change that overlaps nobody is saved');
select lives_ok(
  $$update public.shift_templates set name = 'Evening', coverage = 2 where id = '00000000-0000-0000-0000-0000000001b2'$$,
  'a rename is not checked');
select lives_ok(
  $$update public.shift_templates set end_time = '05:00' where id = '00000000-0000-0000-0000-0000000001b2'$$,
  'an overnight end is fine when the next morning is free');
select throws_ok(
  $$update public.shift_templates set end_time = '07:00' where id = '00000000-0000-0000-0000-0000000001b2'$$,
  '23P01', null, 'an overnight end that runs into her early shift the next morning is refused');
select throws_ok(
  $$update public.shift_templates set start_time = '25:00' where id = '00000000-0000-0000-0000-0000000001b2'$$,
  '23514', null, 'a time past 23:59 is refused');
select throws_ok(
  $$insert into public.shift_templates (account_id, name, role, start_time, end_time) values ('acct_t', 'Bad', 'Cook', '08:00', '24:00')$$,
  '23514', null, '24:00 is refused on a new template');
reset role;

-- An overlap that is already in the past does not block an edit.
alter table public.roster disable trigger roster_no_overlap;
insert into public.shift_templates (id, account_id, name, role, start_time, end_time, coverage) values
  ('00000000-0000-0000-0000-0000000001b3', 'acct_t', 'Mid', 'Cook', '10:00', '18:00', 1);
insert into public.roster (account_id, date, worker_id, template_id) values
  ('acct_t', current_date - 30, '00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000001b1'),
  ('acct_t', current_date - 30, '00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000001b3');
alter table public.roster enable trigger roster_no_overlap;
select lives_ok(
  $$update public.shift_templates set start_time = '11:00' where id = '00000000-0000-0000-0000-0000000001b3'$$,
  'an old overlap does not block an edit');

select * from finish();
rollback;
