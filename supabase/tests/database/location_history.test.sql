-- Location change history (CHG-089, 20261021000089_location_history.sql).
-- Run with: supabase test db
-- Every insert, update and delete of a location leaves a history row written
-- by the trigger; tenants read only their own rows; nobody writes the table
-- directly, not even the service role.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- ── Fixtures (as the table owner) ────────────────────────────────────────────
insert into public.locations (id, account_id, name, country_code, jurisdiction_code, time_zone, industry, employer_headcount, confirmed_by) values
  ('00000000-0000-0000-0000-00000000ab01', 'hist_a', 'Lima Centro', 'PE', 'PE', 'America/Lima', 'food_service', 12, 'user_ha'),
  ('00000000-0000-0000-0000-00000000ab02', 'hist_b', 'Berkeley', 'US', 'US-CA-BERKELEY', 'America/Los_Angeles', 'retail', null, 'user_hb');

select has_table('public', 'location_history', 'location_history exists');
select results_eq(
  $$select action, changed_by, new_jurisdiction_code, new_time_zone, new_industry, new_employer_headcount, old_jurisdiction_code
      from public.location_history where location_id = '00000000-0000-0000-0000-00000000ab01'$$,
  $$values ('insert'::text, 'user_ha'::text, 'PE'::text, 'America/Lima'::text, 'food_service'::text, 12, null::text)$$,
  'an insert records the new values and who confirmed them');

-- An update by another admin (the proxy sets confirmed_by to the session user).
update public.locations
   set country_code = 'ES', jurisdiction_code = 'ES', time_zone = 'Europe/Madrid', industry = 'retail',
       employer_headcount = 40, overrides = '[{"rule":"rest.minHours","value":13}]'::jsonb, confirmed_by = 'user_ha2'
 where id = '00000000-0000-0000-0000-00000000ab01';

select results_eq(
  $$select changed_by, old_jurisdiction_code, new_jurisdiction_code, old_time_zone, new_time_zone,
           old_industry, new_industry, old_employer_headcount, new_employer_headcount, old_overrides, new_overrides
      from public.location_history where location_id = '00000000-0000-0000-0000-00000000ab01' and action = 'update'$$,
  $$values ('user_ha2'::text, 'PE'::text, 'ES'::text, 'America/Lima'::text, 'Europe/Madrid'::text,
            'food_service'::text, 'retail'::text, 12, 40, '[]'::jsonb, '[{"rule":"rest.minHours","value":13}]'::jsonb)$$,
  'an update records old and new jurisdiction, zone, industry, headcount and overrides');

-- The transaction-local actor wins over confirmed_by.
select set_config('horario.actor', 'user_actor', true);
update public.locations set employer_headcount = 41 where id = '00000000-0000-0000-0000-00000000ab01';
select set_config('horario.actor', '', true);
select is(
  (select changed_by from public.location_history where location_id = '00000000-0000-0000-0000-00000000ab01' and new_employer_headcount = 41),
  'user_actor', 'horario.actor names who changed it');

-- ── anon sees nothing ────────────────────────────────────────────────────────
set local role anon;
select throws_ok('select * from public.location_history', '42501', null, 'anon cannot read location history');
select throws_ok($$select public.delete_location('hist_a', '00000000-0000-0000-0000-00000000ab01', 'x')$$, '42501', null, 'anon cannot call delete_location');
reset role;

-- ── Tenant A ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"hist_a","role":"authenticated"}';
select results_eq('select count(*)::int from public.location_history', 'values (3)', 'A sees its 3 history rows');
select is_empty($$select * from public.location_history where account_id <> 'hist_a'$$, 'A sees no other tenant history');
select throws_ok($$insert into public.location_history (account_id, location_id, location_name, action) values ('hist_a', gen_random_uuid(), 'Fake', 'insert')$$, '42501', null, 'signed-in users cannot insert history');
select throws_ok($$update public.location_history set changed_by = 'someone'$$, '42501', null, 'signed-in users cannot edit history');
select throws_ok($$delete from public.location_history$$, '42501', null, 'signed-in users cannot delete history');
select throws_ok($$select public.delete_location('hist_a', '00000000-0000-0000-0000-00000000ab01', 'hist_a')$$, '42501', null, 'signed-in users cannot call delete_location');
reset role;

-- ── Tenant B (organization) ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_hb","o":{"id":"hist_b"},"role":"authenticated"}';
select results_eq('select location_name from public.location_history', $$values ('Berkeley'::text)$$, 'org member sees only org history');
reset role;

-- ── Service role (the proxy) cannot forge or edit history ────────────────────
set local role service_role;
select throws_ok($$insert into public.location_history (account_id, location_id, location_name, action) values ('hist_a', gen_random_uuid(), 'Fake', 'insert')$$, '42501', null, 'the service role cannot insert history');
select throws_ok($$update public.location_history set changed_by = 'someone'$$, '42501', null, 'the service role cannot edit history');

-- Delete through the proxy's function: records the actor.
select is(public.delete_location('hist_b', '00000000-0000-0000-0000-00000000ab01', 'user_hb'), false, 'delete_location never deletes another tenant''s row');
select is(public.delete_location('hist_a', '00000000-0000-0000-0000-00000000ab01', 'user_ha'), true, 'delete_location deletes the caller tenant''s row');
reset role;

select results_eq(
  $$select account_id, changed_by, location_name, old_jurisdiction_code, old_time_zone, old_employer_headcount, new_jurisdiction_code
      from public.location_history where location_id = '00000000-0000-0000-0000-00000000ab01' and action = 'delete'$$,
  $$values ('hist_a'::text, 'user_ha'::text, 'Lima Centro'::text, 'ES'::text, 'Europe/Madrid'::text, 41, null::text)$$,
  'a delete records the old values and who deleted it');
select is(current_setting('horario.actor', true), '', 'delete_location clears the actor afterwards');
select throws_ok($$insert into public.location_history (account_id, location_id, location_name, action) values ('hist_a', gen_random_uuid(), 'X', 'rename')$$, '23514', null, 'unknown action rejected');

-- ── Nobody erases history; purging takes an age of at least 2 years (CHG-091) ─
insert into public.location_history (account_id, location_id, location_name, action, changed_at) values
  ('hist_old', '00000000-0000-0000-0000-00000000ab09', 'Three years ago', 'insert', now() - interval '3 years'),
  ('hist_old', '00000000-0000-0000-0000-00000000ab09', 'One year ago', 'update', now() - interval '1 year');

set local role service_role;
select throws_ok($$delete from public.location_history where account_id = 'hist_a'$$, '42501', null, 'the service role cannot delete history rows');
select throws_ok($$select public.purge_location_history(interval '1 year')$$, '22023', null, 'a purge younger than 2 years is refused');
select throws_ok($$select public.purge_location_history(interval '729 days')$$, '22023', null, 'a purge of 729 days is refused');
select throws_ok($$select public.purge_location_history(null)$$, '22023', null, 'a purge without an age is refused');
select ok(public.purge_location_history(interval '2 years') >= 1, 'the service role purges rows older than 2 years');
reset role;
select is_empty($$select 1 from public.location_history where location_name = 'Three years ago'$$, 'the 3-year-old row was purged');
select results_eq($$select location_name from public.location_history where account_id = 'hist_old'$$, $$values ('One year ago'::text)$$, 'the 1-year-old row is kept');

set local role authenticated;
set local request.jwt.claims = '{"sub":"hist_a","role":"authenticated"}';
select throws_ok($$select public.purge_location_history(interval '5 years')$$, '42501', null, 'signed-in users cannot purge history');
reset role;
set local role anon;
select throws_ok($$select public.purge_location_history(interval '5 years')$$, '42501', null, 'anon cannot purge history');
reset role;

select * from finish();
rollback;
