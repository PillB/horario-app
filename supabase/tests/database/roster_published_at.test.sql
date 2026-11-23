-- CHG-105: roster.published_at is set by the database when a shift is published
-- (20261123000108_roster_published_at.sql).
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.workers (id, account_id, name, role) values
  ('00000000-0000-0000-0000-0000000002a1', 'acct_p', 'Ana', 'Cook');
insert into public.shift_templates (id, account_id, name, role, start_time, end_time, coverage) values
  ('00000000-0000-0000-0000-0000000002b1', 'acct_p', 'Early', 'Cook', '06:00', '14:00', 1),
  ('00000000-0000-0000-0000-0000000002b2', 'acct_p', 'Late',  'Cook', '15:00', '22:00', 1);

set local role service_role;
-- A client value is ignored on insert.
insert into public.roster (id, account_id, date, worker_id, template_id, status, published_at) values
  ('00000000-0000-0000-0000-0000000002c1', 'acct_p', current_date + 10, '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-0000000002b1', 'Draft', '2000-01-01'),
  ('00000000-0000-0000-0000-0000000002c2', 'acct_p', current_date + 10, '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-0000000002b2', 'Published', '2000-01-01');

select is((select published_at from public.roster where id = '00000000-0000-0000-0000-0000000002c1'), null,
  'a draft has no publish time, whatever the client sent');
select is((select published_at from public.roster where id = '00000000-0000-0000-0000-0000000002c2'), now(),
  'a shift inserted as Published gets the transaction time, not the client value');

update public.roster set status = 'Published' where id = '00000000-0000-0000-0000-0000000002c1';
select is((select published_at from public.roster where id = '00000000-0000-0000-0000-0000000002c1'), now(),
  'publishing a draft sets the time');

update public.roster set published_at = '2000-01-01', notified = true where id = '00000000-0000-0000-0000-0000000002c1';
select is((select published_at from public.roster where id = '00000000-0000-0000-0000-0000000002c1'), now(),
  'a client cannot move the publish time of a published shift');

update public.roster set status = 'Draft' where id = '00000000-0000-0000-0000-0000000002c1';
select is((select published_at from public.roster where id = '00000000-0000-0000-0000-0000000002c1'), null,
  'unpublishing clears it');

select is((select count(*)::int from public.roster where status = 'Published' and published_at is null), 0,
  'no published shift is left without a time');

select * from finish();
rollback;
