-- Tenant isolation tests (pgTAP). Run with: supabase test db
-- Two tenants: A (personal account, user_a) and B (Clerk organization org_b,
-- member user_b). The anon key is public, so anon must see nothing; signed-in
-- users must see only their own tenant and must not write directly.
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

-- ── Fixtures (as the table owner) ────────────────────────────────────────────
insert into public.workers (id, account_id, name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'user_a', 'Ana', 'Barista'),
  ('00000000-0000-0000-0000-0000000000b1', 'org_b',  'Bruno', 'Cook');
insert into public.shift_templates (id, account_id, name, role, start_time, end_time, coverage) values
  ('00000000-0000-0000-0000-0000000000a2', 'user_a', 'Morning', 'Barista', '07:00', '15:00', 1),
  ('00000000-0000-0000-0000-0000000000b2', 'org_b',  'Night',   'Cook',    '22:00', '06:00', 1);
insert into public.worker_availability (account_id, worker_id, day_of_week, from_time, to_time) values
  ('user_a', '00000000-0000-0000-0000-0000000000a1', 'Mon', '06:00', '16:00'),
  ('org_b',  '00000000-0000-0000-0000-0000000000b1', 'Mon', '21:00', '07:00');
insert into public.roster (account_id, date, worker_id, template_id) values
  ('user_a', '2026-10-19', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2'),
  ('org_b',  '2026-10-19', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
insert into public.demand_targets (account_id, date, role, required, source) values
  ('user_a', '2026-10-19', 'Barista', 2, 'model'),
  ('org_b',  '2026-10-19', 'Barista', 5, 'model');
insert into public.shifts (account_id, date, role, worker_id, hours) values ('user_a', '2026-10-01', 'Barista', 'w1', 8), ('org_b', '2026-10-01', 'Cook', 'w2', 8);
insert into public.external_signals (account_id, date, role, signal_type, weight) values ('org_b', '2026-10-19', 'Cook', 'event', 1);
insert into public.onboarding_progress (account_id, user_id, workers_completed) values ('user_a', 'user_a', true), ('org_b', 'user_b', true);
insert into public.usage_limits (user_id, account_id, auto_assign_count) values ('user_b', 'org_b', 3);
insert into public.pos_sales (account_id, date, revenue) values ('org_b', '2026-10-01', 1000);
insert into public.subscriptions (account_id, tier, status) values ('org_b', 'pro', 'active');
insert into public.referrals (account_id, referrer_user_id, code, expires_at, max_redemptions)
  values ('user_a', 'user_a', 'CODEA1', now() + interval '30 days', 2),
         ('org_b',  'user_b', 'OLDB01', now() - interval '1 day', 5);
insert into public.locations (account_id, name, country_code, jurisdiction_code, time_zone, industry, confirmed_by) values
  ('user_a', 'Lima Centro', 'PE', 'PE', 'America/Lima', 'food_service', 'user_a'),
  ('org_b',  'Berkeley',    'US', 'US-CA-BERKELEY', 'America/Los_Angeles', 'retail', 'user_b');

-- ── Tenant id helper ─────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"user_b","o":{"id":"org_b","rol":"admin"}}';
select is(private.current_account_id(), 'org_b', 'v2 org claim o.id wins over sub');
set local request.jwt.claims = '{"sub":"user_b","org_id":"org_b"}';
select is(private.current_account_id(), 'org_b', 'v1 org_id claim wins over sub');
set local request.jwt.claims = '{"sub":"user_a"}';
select is(private.current_account_id(), 'user_a', 'personal session falls back to sub');
set local request.jwt.claims = '{}';
select is(private.current_account_id(), null, 'no claims, no tenant');

-- ── anon (public key) sees nothing ───────────────────────────────────────────
set local role anon;
select throws_ok('select * from public.workers', '42501', null, 'anon cannot read workers');
select throws_ok('select * from public.roster', '42501', null, 'anon cannot read roster');
select throws_ok('select * from public.shifts', '42501', null, 'anon cannot read shifts');
select throws_ok('select * from public.external_signals', '42501', null, 'anon cannot read external_signals');
select throws_ok('select * from public.demand_targets', '42501', null, 'anon cannot read demand_targets');
select throws_ok('select * from public.onboarding_progress', '42501', null, 'anon cannot read onboarding_progress');
select throws_ok('select * from public.subscriptions', '42501', null, 'anon cannot read subscriptions');
select throws_ok('select * from public.referrals', '42501', null, 'anon cannot read referrals');
select throws_ok('select * from public.pos_sales', '42501', null, 'anon cannot read pos_sales');
select throws_ok('select * from public.usage_limits', '42501', null, 'anon cannot read usage_limits');
select throws_ok($$insert into public.onboarding_progress (account_id, user_id) values ('x','x')$$, '42501', null, 'anon cannot write onboarding_progress');
select throws_ok('select * from public.locations', '42501', null, 'anon cannot read locations');
reset role;

-- ── Tenant A (personal account) ──────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_a","role":"authenticated"}';
select results_eq('select name from public.workers', $$values ('Ana'::text)$$, 'A sees only its workers');
select results_eq('select count(*)::int from public.roster', 'values (1)', 'A sees only its roster');
select results_eq('select required::int from public.demand_targets', 'values (2)', 'A sees only its demand targets');
select results_eq('select count(*)::int from public.shifts', 'values (1)', 'A sees only its historical shifts');
select is_empty('select * from public.external_signals', 'A sees no other tenant signals');
select is_empty('select * from public.subscriptions', 'A cannot see B subscription');
select is_empty('select * from public.pos_sales', 'A cannot see B sales');
select is_empty('select * from public.usage_limits', 'A cannot see B usage');
select results_eq('select code from public.referrals', $$values ('CODEA1'::text)$$, 'A sees only its referrals');
select throws_ok($$update public.workers set name = 'x'$$, '42501', null, 'signed-in users cannot update directly');
select throws_ok($$delete from public.roster$$, '42501', null, 'signed-in users cannot delete directly');
select throws_ok($$insert into public.workers (account_id, name, role) values ('user_a','Eve','Cook')$$, '42501', null, 'signed-in users cannot insert directly');
select throws_ok($$update public.subscriptions set tier = 'pro'$$, '42501', null, 'signed-in users cannot change their tier');
select throws_ok($$select public.increment_auto_assign('user_a','user_a')$$, '42501', null, 'usage counter is server-only');
select throws_ok($$select public.redeem_referral('CODEA1','user_a')$$, '42501', null, 'referral redeem is server-only');
select throws_ok('select * from public.referral_redemptions', '42501', null, 'redemptions are server-only');
select results_eq('select name from public.locations', $$values ('Lima Centro'::text)$$, 'A sees only its locations');
select throws_ok($$insert into public.locations (account_id, name, country_code, jurisdiction_code, time_zone, industry, confirmed_by) values ('user_a','X','PE','PE','America/Lima','retail','user_a')$$, '42501', null, 'signed-in users cannot insert locations directly');
select throws_ok($$update public.locations set jurisdiction_code = 'GENERIC'$$, '42501', null, 'signed-in users cannot update locations directly');
select throws_ok($$delete from public.locations$$, '42501', null, 'signed-in users cannot delete locations directly');
reset role;

-- ── Tenant B (organization) ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_b","o":{"id":"org_b"},"role":"authenticated"}';
select results_eq('select name from public.workers', $$values ('Bruno'::text)$$, 'org member sees org workers');
select results_eq('select tier from public.subscriptions', $$values ('pro'::text)$$, 'org member sees own subscription');
select results_eq('select jurisdiction_code from public.locations', $$values ('US-CA-BERKELEY'::text)$$, 'org member sees only org locations');
reset role;

-- ── Overnight windows ────────────────────────────────────────────────────────
select lives_ok($$insert into public.shift_templates (account_id, name, role, start_time, end_time) values ('user_a','Late','Barista','23:00','07:00')$$, 'overnight template allowed');
select throws_ok($$insert into public.shift_templates (account_id, name, role, start_time, end_time) values ('user_a','Zero','Barista','08:00','08:00')$$, '23514', null, 'zero-length template rejected');
select throws_ok($$insert into public.demand_targets (date, role, required) values ('2026-10-20','Cook',1)$$, '23514', null, 'demand target needs an account');

-- ── Location checks ──────────────────────────────────────────────────────────
select throws_ok($$insert into public.locations (account_id, name, country_code, jurisdiction_code, time_zone, industry, confirmed_by) values ('user_a','Bad','pe','PE','America/Lima','retail','user_a')$$, '23514', null, 'location rejects a lower-case country code');
select throws_ok($$insert into public.locations (account_id, name, country_code, jurisdiction_code, time_zone, industry, confirmed_by) values ('user_a','Bad','PER','PE','America/Lima','retail','user_a')$$, '23514', null, 'location rejects a 3-letter country code');
select throws_ok($$insert into public.locations (account_id, name, country_code, jurisdiction_code, time_zone, industry, confirmed_by) values ('user_a','Bad','PE','PE','America/Lima','casino','user_a')$$, '23514', null, 'location rejects an unknown industry');

-- ── Worker labor attributes (CHG-082) ────────────────────────────────────────
select col_type_is('public', 'workers', 'birth_date', 'date', 'workers.birth_date is a date');
select results_eq(
  $$select night_worker, weekly_limit_opt_out, no_fixed_hours from public.workers where id = '00000000-0000-0000-0000-0000000000a1'$$,
  $$values (false, false, false)$$,
  'worker labor flags default to false');
select throws_ok($$update public.workers set birth_date = '1899-12-31' where id = '00000000-0000-0000-0000-0000000000a1'$$, '23514', null, 'birth date before 1900 rejected');
select lives_ok($$update public.workers set birth_date = '2001-04-17', night_worker = true where id = '00000000-0000-0000-0000-0000000000a1'$$, 'valid labor attributes accepted');

-- ── Scheduling persistence (CHG-088) ─────────────────────────────────────────
select has_index('public', 'roster', 'roster_account_slot_key', 'roster has a unique (tenant, date, worker, template) index');
select throws_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id) values ('user_a', '2026-10-19', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2')$$,
  '23505', null, 'the same worker, date and template cannot be rostered twice');
select lives_ok(
  $$insert into public.roster (account_id, date, worker_id, template_id) values ('user_a', '2026-10-20', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2')$$,
  'the same worker and template on another date is allowed');
insert into public.demand_targets (account_id, date, role, required, source) values ('user_a', '2026-10-21', 'Barista', 4, 'override');
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_a","role":"authenticated"}';
select throws_ok($$delete from public.demand_targets where source = 'override'$$, '42501', null, 'signed-in users cannot delete overrides directly');
select throws_ok($$update public.roster set status = 'Published', notified = true$$, '42501', null, 'signed-in users cannot publish or notify directly');
select throws_ok($$delete from public.worker_availability$$, '42501', null, 'signed-in users cannot delete availability directly');
reset role;

-- ── Server-only functions ────────────────────────────────────────────────────
select is(public.increment_auto_assign('user_b','org_b'), 4, 'counter increments an existing row');
select is(public.increment_auto_assign('user_c','org_c'), 1, 'counter creates a row at 1');
select is(public.redeem_referral('codea1','user_x'), 'user_a', 'redeem is case-insensitive and returns referrer');
select is(public.redeem_referral('CODEA1','user_x'), null, 'same user cannot redeem a code twice');
select is((select redemption_count from public.referrals where code = 'CODEA1'), 1, 'repeat redeem does not move the count');
select is(public.redeem_referral('CODEA1','user_a'), null, 'referrer cannot redeem own code');
select is(public.redeem_referral('CODEA1','user_y'), 'user_a', 'second redemption reaches the limit');
select is(public.redeem_referral('CODEA1','user_z'), null, 'exhausted code cannot be redeemed');

select * from finish();
rollback;
