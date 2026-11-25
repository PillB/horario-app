-- CHG-106: roster.published_at is set by the database when a shift is published
-- (20261123000108_roster_published_at.sql). CHG-109 (20261125000111_state_guards.sql):
-- a moved Published shift is posted again; only a Published shift can be notified.
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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

-- Unpublishing clears notified in the same write (the proxy does; CHECK roster_notified_needs_published, CHG-109).
update public.roster set status = 'Draft', notified = false where id = '00000000-0000-0000-0000-0000000002c1';
select is((select published_at from public.roster where id = '00000000-0000-0000-0000-0000000002c1'), null,
  'unpublishing clears it');

select is((select count(*)::int from public.roster where status = 'Published' and published_at is null), 0,
  'no published shift is left without a time');

-- ── CHG-109: a moved Published shift is a new posting ───────────────────────
-- Stand in for "published long ago" (set with the trigger off, which needs the table owner).
reset role;
alter table public.roster disable trigger roster_published_at;
update public.roster set published_at = '2000-01-01' where id = '00000000-0000-0000-0000-0000000002c2';
alter table public.roster enable trigger roster_published_at;
set local role service_role;

update public.roster set location = 'Bar' where id = '00000000-0000-0000-0000-0000000002c2';
select is((select published_at from public.roster where id = '00000000-0000-0000-0000-0000000002c2'), '2000-01-01'::timestamptz,
  'an edit that keeps date, worker and template keeps the publish time');
update public.roster set date = current_date + 11 where id = '00000000-0000-0000-0000-0000000002c2';
select is((select published_at from public.roster where id = '00000000-0000-0000-0000-0000000002c2'), now(),
  'moving it to another date posts it again');

reset role;
alter table public.roster disable trigger roster_published_at;
update public.roster set published_at = '2000-01-01' where id = '00000000-0000-0000-0000-0000000002c2';
alter table public.roster enable trigger roster_published_at;
set local role service_role;
update public.roster set template_id = '00000000-0000-0000-0000-0000000002b1' where id = '00000000-0000-0000-0000-0000000002c2';
select is((select published_at from public.roster where id = '00000000-0000-0000-0000-0000000002c2'), now(),
  'moving it to another template posts it again');

-- ── CHG-109: only a Published shift can be marked as told ───────────────────
select throws_ok(
  $$update public.roster set notified = true where id = '00000000-0000-0000-0000-0000000002c1'$$,
  '23514', null, 'a draft cannot be marked as told');
select throws_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id, status, notified) values
      ('acct_p', current_date + 20, '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-0000000002b1', 'Draft', true)$$,
  '23514', null, 'nor stored as told');
select lives_ok(
  $$update public.roster set notified = true where id = '00000000-0000-0000-0000-0000000002c2'$$,
  'a published shift can be marked as told');
select throws_ok(
  $$update public.roster set status = 'Draft' where id = '00000000-0000-0000-0000-0000000002c2'$$,
  '23514', null, 'unpublishing a told shift must clear the flag in the same write');
select lives_ok(
  $$update public.roster set date = date + 30 where id = '00000000-0000-0000-0000-0000000002c2'$$,
  'a told shift can be moved by any writer');
select is((select notified from public.roster where id = '00000000-0000-0000-0000-0000000002c2'), false,
  'and is no longer marked as told: the person was told about the old shift (CHG-109 review)');

select * from finish();
rollback;
