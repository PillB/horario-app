-- Removing a person together with their shifts (pgTAP, CHG-109 F-11). Run with: supabase test db
-- A plain delete of a person with shifts is still refused; delete_worker_with_shifts()
-- removes the shifts and the person together, only in the caller's account.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into public.workers (id, account_id, name, role) values
  ('00000000-0000-0000-0000-0000000001d1', 'acct_dw', 'Ana', 'Cook'),
  ('00000000-0000-0000-0000-0000000001d2', 'acct_dw', 'Ben', 'Cook'),
  ('00000000-0000-0000-0000-0000000001d3', 'acct_dw_other', 'Cora', 'Cook');
insert into public.shift_templates (id, account_id, name, role, start_time, end_time, coverage) values
  ('00000000-0000-0000-0000-0000000001e1', 'acct_dw', 'AM', 'Cook', '08:00', '16:00', 1),
  ('00000000-0000-0000-0000-0000000001e2', 'acct_dw_other', 'AM', 'Cook', '08:00', '16:00', 1);
insert into public.roster (id, account_id, date, worker_id, template_id, status) values
  ('00000000-0000-0000-0000-0000000001a1', 'acct_dw', '2026-01-05', '00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001e1', 'Published'),
  ('00000000-0000-0000-0000-0000000001a2', 'acct_dw', '2099-01-05', '00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001e1', 'Draft'),
  ('00000000-0000-0000-0000-0000000001a3', 'acct_dw', '2099-01-05', '00000000-0000-0000-0000-0000000001d2', '00000000-0000-0000-0000-0000000001e1', 'Draft'),
  ('00000000-0000-0000-0000-0000000001a4', 'acct_dw_other', '2099-01-05', '00000000-0000-0000-0000-0000000001d3', '00000000-0000-0000-0000-0000000001e2', 'Draft');
insert into public.worker_availability (account_id, worker_id, day_of_week, from_time, to_time) values
  ('acct_dw', '00000000-0000-0000-0000-0000000001d1', 'Mon', '08:00', '16:00');
insert into public.shift_messages (account_id, roster_id, worker_id, body) values
  ('acct_dw', '00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000001d1', 'Can you swap?');

-- ── A plain delete is still refused ──────────────────────────────────────────
select throws_ok(
  $$delete from public.workers where id = '00000000-0000-0000-0000-0000000001d1'$$,
  '23503', null, 'a person with shifts cannot be removed by a plain delete');

-- ── Another account's person: nothing changes ────────────────────────────────
select throws_ok(
  $$select public.delete_worker_with_shifts('acct_dw', '00000000-0000-0000-0000-0000000001d3')$$,
  'P0002', 'delete_worker_with_shifts: no such worker', 'another account''s person is "no such worker"');
select is(
  (select count(*)::integer from public.roster where worker_id = '00000000-0000-0000-0000-0000000001d3'),
  1, 'and their shift is untouched');
select throws_ok(
  $$select public.delete_worker_with_shifts('', '00000000-0000-0000-0000-0000000001d1')$$,
  '22023', 'delete_worker_with_shifts: account is required', 'an account is required');

-- ── The person and every shift of theirs, together ───────────────────────────
select is(
  public.delete_worker_with_shifts('acct_dw', '00000000-0000-0000-0000-0000000001d1') -> 'removedShifts',
  '2'::jsonb, 'removes the person and reports both of their shifts (past and upcoming)');
select is(
  (select count(*)::integer from public.workers where id = '00000000-0000-0000-0000-0000000001d1'),
  0, 'the person is gone');
select is(
  (select count(*)::integer from public.roster where worker_id = '00000000-0000-0000-0000-0000000001d1'),
  0, 'their shifts are gone');
select is(
  (select count(*)::integer from public.worker_availability where worker_id = '00000000-0000-0000-0000-0000000001d1'),
  0, 'their availability is gone');
select is(
  (select count(*)::integer from public.roster where id = '00000000-0000-0000-0000-0000000001a3'),
  1, 'another person''s shift on the same slot stays');
select throws_ok(
  $$select public.delete_worker_with_shifts('acct_dw', '00000000-0000-0000-0000-0000000001d1')$$,
  'P0002', null, 'a second call finds no such worker');

-- ── A person without shifts works too ────────────────────────────────────────
delete from public.roster where id = '00000000-0000-0000-0000-0000000001a3';
select is(
  public.delete_worker_with_shifts('acct_dw', '00000000-0000-0000-0000-0000000001d2') -> 'removedShifts',
  '0'::jsonb, 'a person without shifts is removed, 0 shifts');

-- ── Who may call it ──────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('authenticated', 'public.delete_worker_with_shifts(text, uuid)', 'execute'),
  'authenticated cannot call it');
select ok(
  not has_function_privilege('anon', 'public.delete_worker_with_shifts(text, uuid)', 'execute'),
  'anon cannot call it');
select ok(
  has_function_privilege('service_role', 'public.delete_worker_with_shifts(text, uuid)', 'execute'),
  'the proxy''s service role can');

select * from finish();
rollback;
