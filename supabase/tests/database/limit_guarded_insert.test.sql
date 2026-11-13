-- insert_within_limit (pgTAP, CHG-100). Run with: supabase test db
-- The count and the insert are one step: at the limit nothing is inserted,
-- column defaults are kept, the account always comes from the argument, and
-- only the service role may call it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select is(
  public.insert_within_limit('workers', 'acct_lim', 2, '{"name":"Ana","role":"Cook","skills":["grill"]}') -> 'rows' -> 0 ->> 'name',
  'Ana', 'under the limit: inserted and returned');
select is(
  (select night_worker from public.workers where account_id = 'acct_lim' and name = 'Ana'),
  false, 'columns left out keep their defaults');
select is(
  public.insert_within_limit('workers', 'acct_lim', 2, '{"name":"Bea","role":"Cook","account_id":"acct_other"}') -> 'rows' -> 0 ->> 'account_id',
  'acct_lim', 'the account comes from the argument, never from the row');
select is(
  public.insert_within_limit('workers', 'acct_lim', 2, '{"name":"Cy","role":"Cook"}'),
  '{"limited": true, "count": 2}'::jsonb, 'at the limit: refused with the count');
select is((select count(*)::integer from public.workers where account_id = 'acct_lim'), 2, 'nothing was inserted at the limit');
select is(
  public.insert_within_limit('workers', 'acct_lim', null, '{"name":"Cy","role":"Cook"}') -> 'rows' -> 0 ->> 'name',
  'Cy', 'no limit: inserted');
select is(
  public.insert_within_limit('workers', 'acct_free', 1, '{"name":"Di","role":"Cook"}') -> 'rows' -> 0 ->> 'name',
  'Di', 'another account has its own count');

select is(
  public.insert_within_limit('workers', 'acct_batch', 3, '[{"name":"A","role":"Cook"},{"name":"B","role":"Cook"},{"name":"C","role":"Cook"},{"name":"D","role":"Cook"}]'),
  '{"limited": true, "count": 0}'::jsonb, 'a batch that does not fit is refused whole');
select is((select count(*)::integer from public.workers where account_id = 'acct_batch'), 0, 'none of its rows were inserted');
select is(
  jsonb_array_length(public.insert_within_limit('workers', 'acct_batch', 3, '[{"name":"A","role":"Cook"},{"name":"B","role":"Cook"},{"name":"C","role":"Cook"}]') -> 'rows'),
  3, 'a batch that fits is inserted whole');
select throws_ok(
  $$select public.insert_within_limit('workers', 'acct_batch', 9, '[{"name":"A","role":"Cook"},{"name":"B"}]')$$,
  '22023', null, 'rows of a batch need the same columns');

select throws_ok(
  $$select public.insert_within_limit('roster', 'acct_lim', 2, '{}')$$,
  '22023', null, 'only people and locations are limited');
select throws_ok(
  $$select public.insert_within_limit('workers', 'acct_lim', 5, '{"name":"X","role":"Cook","nope":1}')$$,
  '22023', null, 'an unknown column is refused');

set local role authenticated;
select throws_ok(
  $$select public.insert_within_limit('workers', 'acct_lim', 5, '{"name":"X","role":"Cook"}')$$,
  '42501', null, 'a signed-in user cannot call it');
reset role;
set local role service_role;
select lives_ok(
  $$select public.insert_within_limit('workers', 'acct_lim', 5, '{"name":"X","role":"Cook"}')$$,
  'the service role can');
reset role;

select * from finish();
rollback;
