-- Plans and entitlements (pgTAP, CHG-099). Run with: supabase test db
-- A grant is readable by its own tenant only, written by the service role only,
-- never edited or deleted, revoked once; one trial per account; the monthly
-- auto-schedule quota is consumed atomically and starts again each month.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ── Fixtures (as the table owner) ────────────────────────────────────────────
insert into public.account_entitlements (id, account_id, plan, source, ends_at, granted_by, reason) values
  ('00000000-0000-0000-0000-0000000000e1', 'user_a', 'pro', 'trial', now() + interval '14 days', 'system', 'trial'),
  ('00000000-0000-0000-0000-0000000000e2', 'org_b',  'esencial', 'tester', now() + interval '90 days', 'user_admin', 'pilot');

select throws_ok(
  $$insert into public.account_entitlements (account_id, plan, source, granted_by) values ('user_a', 'pro', 'trial', 'system')$$,
  '23505', null, 'an account gets one trial, ever');
select throws_ok(
  $$insert into public.account_entitlements (account_id, plan, source, granted_by) values ('user_a', 'growth', 'comp', 'x')$$,
  '23514', null, 'old plan names are refused');
select throws_ok(
  $$insert into public.account_entitlements (account_id, plan, source, granted_by) values ('user_a', 'pro', 'gift', 'x')$$,
  '23514', null, 'unknown sources are refused');
select throws_ok(
  $$insert into public.account_entitlements (account_id, plan, source, granted_by, starts_at, ends_at) values ('user_a', 'pro', 'comp', 'x', now(), now() - interval '1 day')$$,
  '23514', null, 'a grant cannot end before it starts');
select throws_ok(
  $$insert into public.subscriptions (account_id, tier, status) values ('user_old', 'starter', 'active')$$,
  '23514', null, 'subscriptions refuse the old tier names');
select lives_ok(
  $$insert into public.subscriptions (account_id, tier, status) values ('user_new', 'esencial', 'active')$$,
  'subscriptions accept the new plan names');

-- ── anon ─────────────────────────────────────────────────────────────────────
set local role anon;
select throws_ok('select * from public.account_entitlements', '42501', null, 'anon cannot read entitlements');
reset role;

-- ── Tenant A ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"user_a","role":"authenticated"}';
select results_eq('select source from public.account_entitlements', $$values ('trial'::text)$$, 'A sees only its own grants');
select throws_ok(
  $$insert into public.account_entitlements (account_id, plan, source, granted_by) values ('user_a', 'pro', 'comp', 'user_a')$$,
  '42501', null, 'a signed-in user cannot grant itself a plan');
select throws_ok($$update public.account_entitlements set ends_at = null$$, '42501', null, 'a signed-in user cannot extend a grant');
select throws_ok($$select public.consume_auto_assign('user_a', 'user_a', null)$$, '42501', null, 'a signed-in user cannot call the quota function');
reset role;

-- ── service role (the proxy) ─────────────────────────────────────────────────
set local role service_role;
select throws_ok($$delete from public.account_entitlements where account_id = 'org_b'$$, '42501', null, 'the service role cannot delete a grant');
select throws_ok(
  $$update public.account_entitlements set plan = 'pro' where id = '00000000-0000-0000-0000-0000000000e2'$$,
  'P0001', null, 'a grant cannot be edited');
select lives_ok(
  $$update public.account_entitlements set revoked_at = now(), revoked_by = 'user_admin' where id = '00000000-0000-0000-0000-0000000000e2'$$,
  'a grant can be revoked');
select throws_ok(
  $$update public.account_entitlements set revoked_at = null, revoked_by = null where id = '00000000-0000-0000-0000-0000000000e2'$$,
  'P0001', null, 'a revoke cannot be undone');

select is(public.consume_auto_assign('user_q', 'acct_q', 3), 1, 'first run of the month counts 1');
select is(public.consume_auto_assign('user_r', 'acct_q', 3), 2, 'another user of the same account shares the count');
select is(public.consume_auto_assign('user_q', 'acct_q', 3), 3, 'third run counts 3');
select is(public.consume_auto_assign('user_q', 'acct_q', 3), -1, 'the fourth run is refused and not counted');
select is(public.consume_auto_assign('user_q', 'acct_q', null), 4, 'no limit: counted');
reset role;

update public.usage_limits set auto_assign_month = '2020-01' where account_id = 'acct_q';
select is(public.auto_assign_month_count('acct_q'), 0, 'a new month starts at zero');

select * from finish();
rollback;
