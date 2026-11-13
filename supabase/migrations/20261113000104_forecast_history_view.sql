-- =============================================================================
-- Migration: 20261113000104_forecast_history_view.sql
-- CHG-098 — the published roster feeds the demand forecast
--
-- The forecast learned only from `shifts`, a table nothing in the app writes,
-- so an account that scheduled with Horario for months still had "no history"
-- (CLAUDE.md, debt #12). This view is what the forecast now reads:
--
--   * every row of `shifts` (imported history), unchanged, and
--   * every Published roster shift, as one row with its template's role and
--     clock length (an end at or before the start is an overnight shift),
--     on dates for which the account has no `shifts` row. An account that
--     imports its worked shifts for a day is not counted twice for that day.
--
-- Draft shifts are plans, not history, and are left out. The proxy asks for a
-- date window that ends today, so future published shifts are not read.
--
-- `id` is text and unique across both sources, for a stable page order.
-- security_invoker: the view applies the caller's RLS; only service_role (the
-- secure proxy) may select from it.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace view public.forecast_shift_history
with (security_invoker = true)
as
select
  's-' || s.id::text as id,
  s.account_id,
  s.date,
  s.role,
  s.worker_id,
  s.hours
from public.shifts s
union all
select
  'r-' || r.id::text as id,
  r.account_id,
  r.date,
  t.role,
  r.worker_id::text as worker_id,
  round((
    (
      (split_part(t.end_time, ':', 1)::int * 60 + split_part(t.end_time, ':', 2)::int)
      - (split_part(t.start_time, ':', 1)::int * 60 + split_part(t.start_time, ':', 2)::int)
      + 1440
    ) % 1440
  )::numeric / 60, 2) as hours
from public.roster r
join public.shift_templates t
  on t.id = r.template_id and t.account_id = r.account_id
where r.status = 'Published'
  and not exists (
    select 1 from public.shifts s
    where s.account_id = r.account_id and s.date = r.date
  );

revoke all on public.forecast_shift_history from public, anon, authenticated;
grant select on public.forecast_shift_history to service_role;

comment on view public.forecast_shift_history is
  'Forecast training data: imported shifts plus Published roster shifts on dates without imported rows.';
