-- CHG-104: Paddle events are applied once, in occurred_at order, to the right
-- account, and a second live subscription is held for review
-- (20261122000107_paddle_billing.sql).
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

set local role service_role;

-- Fields as server/paddle.ts subscriptionFieldsFromEvent builds them.
create temporary table f (name text primary key, fields jsonb) on commit drop;
insert into f values
  ('active', '{"paddle_subscription_id":"sub_01aaaaaaaaaaaaaaaaaaaaaaaa","paddle_customer_id":"ctm_01aaaaaaaaaaaaaaaaaaaaaaaa","paddle_price_id":"pri_01aaaaaaaaaaaaaaaaaaaaaaaa","tier":"pro","status":"active","quantity":2,"billing_interval":"month","current_period_start":"2026-11-21T10:00:00Z","current_period_end":"2026-12-21T10:00:00Z","cancel_at_period_end":false}'),
  ('past_due', '{"paddle_subscription_id":"sub_01aaaaaaaaaaaaaaaaaaaaaaaa","paddle_customer_id":null,"paddle_price_id":"pri_01aaaaaaaaaaaaaaaaaaaaaaaa","tier":"pro","status":"past_due","quantity":2,"billing_interval":"month","current_period_start":"2026-12-21T10:00:00Z","current_period_end":"2027-01-21T10:00:00Z","cancel_at_period_end":false}'),
  ('canceled', '{"paddle_subscription_id":"sub_01aaaaaaaaaaaaaaaaaaaaaaaa","paddle_customer_id":"ctm_01aaaaaaaaaaaaaaaaaaaaaaaa","paddle_price_id":"pri_01aaaaaaaaaaaaaaaaaaaaaaaa","tier":"pro","status":"cancelled","quantity":2,"billing_interval":"month","current_period_start":null,"current_period_end":null,"cancel_at_period_end":false}'),
  ('second', '{"paddle_subscription_id":"sub_01bbbbbbbbbbbbbbbbbbbbbbbb","paddle_customer_id":"ctm_01aaaaaaaaaaaaaaaaaaaaaaaa","paddle_price_id":"pri_01bbbbbbbbbbbbbbbbbbbbbbbb","tier":"esencial","status":"active","quantity":1,"billing_interval":"month","current_period_start":"2026-11-22T10:00:00Z","current_period_end":"2026-12-22T10:00:00Z","cancel_at_period_end":false}');

create function pg_temp.apply(p_event text, p_at text, p_account text, p_name text) returns text language sql as $$
  select (public.apply_paddle_subscription(p_event, 'subscription.updated', p_at::timestamptz, '{}'::jsonb, p_account,
    (select fields from f where name = p_name))) ->> 'outcome'
$$;

-- An existing Gratis row (getSubscription provisions one) becomes the paid plan.
insert into public.subscriptions (account_id, tier, status) values ('acct_pay', 'gratis', 'active');
select is(pg_temp.apply('evt_01aaaaaaaaaaaaaaaaaaaaaa01', '2026-11-21T10:00:01Z', 'acct_pay', 'active'), 'applied', 'the first event applies');
select is(
  (select tier || ' ' || status || ' ' || quantity || ' ' || payment_provider from public.subscriptions where account_id = 'acct_pay'),
  'pro active 2 paddle', 'the row is the paid plan for two locations');

select is(pg_temp.apply('evt_01aaaaaaaaaaaaaaaaaaaaaa01', '2026-11-21T10:00:01Z', 'acct_pay', 'canceled'), 'duplicate',
  'a retried event id is not applied again, whatever it carries');
select is((select status from public.subscriptions where account_id = 'acct_pay'), 'active', 'so the plan is unchanged');

-- Out of order: the renewal failure (later) arrives, then an older event.
select is(pg_temp.apply('evt_01aaaaaaaaaaaaaaaaaaaaaa03', '2026-12-21T10:00:05Z', null, 'past_due'), 'applied',
  'an event without an account reference finds the account by its subscription id');
select is((select past_due_since from public.subscriptions where account_id = 'acct_pay'), '2026-12-21T10:00:05Z'::timestamptz,
  'past_due_since is when it became past due');
select is((select paddle_customer_id from public.subscriptions where account_id = 'acct_pay'), 'ctm_01aaaaaaaaaaaaaaaaaaaaaaaa',
  'a missing customer id keeps the stored one');
select is(pg_temp.apply('evt_01aaaaaaaaaaaaaaaaaaaaaa02', '2026-11-25T10:00:00Z', null, 'active'), 'stale',
  'an older event arriving late is ignored');
select is((select status from public.subscriptions where account_id = 'acct_pay'), 'past_due', 'and does not undo the newer state');
select is(pg_temp.apply('evt_01aaaaaaaaaaaaaaaaaaaaaa04', '2026-12-22T10:00:00Z', null, 'past_due'), 'applied', 'a second past_due applies');
select is((select past_due_since from public.subscriptions where account_id = 'acct_pay'), '2026-12-21T10:00:05Z'::timestamptz,
  'and the grace period still counts from the first one');

-- A second checkout while the first subscription is live is held, not applied.
select is(pg_temp.apply('evt_01aaaaaaaaaaaaaaaaaaaaaa05', '2026-12-22T11:00:00Z', 'acct_pay', 'second'), 'second_subscription',
  'a second live subscription for the same business is held for review');
select is((select paddle_subscription_id from public.subscriptions where account_id = 'acct_pay'), 'sub_01aaaaaaaaaaaaaaaaaaaaaaaa',
  'the first subscription stays the one in force');

select is(pg_temp.apply('evt_01aaaaaaaaaaaaaaaaaaaaaa06', '2026-11-21T10:00:00Z', null, 'second'),
  'unmatched', 'an event with no account and an unknown subscription is recorded as unmatched');
select is((select count(*)::int from public.paddle_events where outcome = 'unmatched'), 1, 'and kept for review');

-- The subscription's own copy of the reference is missing, but its transaction carried it.
select is(public.record_paddle_event('evt_01aaaaaaaaaaaaaaaaaaaaaa07', 'transaction.completed', '2026-11-30T10:00:00Z',
  '{"data":{"id":"txn_01","subscription_id":"sub_01cccccccccccccccccccccccc"}}'::jsonb, 'acct_txn'), true, 'a transaction event is recorded with its account');
update f set fields = jsonb_set(fields, '{paddle_subscription_id}', '"sub_01cccccccccccccccccccccccc"') where name = 'second';
select is(pg_temp.apply('evt_01aaaaaaaaaaaaaaaaaaaaaa08', '2026-11-30T10:00:01Z', null, 'second'), 'applied',
  'a subscription event without a reference finds the account through its transaction');

reset role;
set local role authenticated;
select throws_ok($$select * from public.paddle_events$$, '42501', null, 'signed-in clients cannot read Paddle events');

select * from finish();
rollback;
