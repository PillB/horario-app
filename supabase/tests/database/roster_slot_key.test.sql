-- The roster's unique slot index is required (CHG-091, QA step 3c G6;
-- 20261021000091_audit_and_slot_guards.sql). Run with: supabase test db
-- private.ensure_roster_slot_key() runs in the migration: it creates the index
-- when it is missing and the roster has no duplicates, and raises otherwise,
-- so `supabase db push` fails instead of passing with a WARNING.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into public.workers (id, account_id, name, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'slot_a', 'Carla', 'Cook');
insert into public.shift_templates (id, account_id, name, role, start_time, end_time, coverage) values
  ('00000000-0000-0000-0000-0000000000c2', 'slot_a', 'Early', 'Cook', '06:00', '14:00', 1);

select index_is_unique('public', 'roster', 'roster_account_slot_key', 'the slot index exists and is unique after the migrations');
select lives_ok('select private.ensure_roster_slot_key()', 'the check passes when the index exists');

-- Simulate a database where 20261021000001 skipped the index because of duplicates.
drop index public.roster_account_slot_key;
insert into public.roster (account_id, date, worker_id, template_id) values
  ('slot_a', '2026-11-02', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2'),
  ('slot_a', '2026-11-02', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2');
select throws_ok('select private.ensure_roster_slot_key()', '23505', null, 'a missing index with duplicates fails the migration');
select hasnt_index('public', 'roster', 'roster_account_slot_key', 'nothing was created while duplicates exist');

-- After the cleanup the same check creates the index.
delete from public.roster
 where account_id = 'slot_a'
   and id <> (select min(id::text)::uuid from public.roster where account_id = 'slot_a');
select lives_ok('select private.ensure_roster_slot_key()', 'the check creates the index once duplicates are gone');
select index_is_unique('public', 'roster', 'roster_account_slot_key', 'the recreated index is unique');

-- An index of that name that is not unique is refused too.
drop index public.roster_account_slot_key;
create index roster_account_slot_key on public.roster (account_id, date, worker_id, template_id);
select throws_ok('select private.ensure_roster_slot_key()', 'P0001', null, 'a non-unique index of that name fails the migration');

set local role authenticated;
select throws_ok('select private.ensure_roster_slot_key()', '42501', null, 'signed-in users cannot run the check');
reset role;

select * from finish();
rollback;
