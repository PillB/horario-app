-- =============================================================================
-- Two writes that could undo newer data when requests cross (CHG-100)
--
-- 1. demand_targets: the forecast reads the stored targets, asks the external
--    forecast service (slow), then upserts its rows. An override a manager saved
--    in between was replaced by the model row. A model row now never replaces
--    an override; an override is changed by another override or deleted.
-- 2. onboarding_progress: the client sends all three flags from what it has
--    loaded. A tab that had not loaded the demand targets yet sent
--    forecast = false over a stored true. A finished step now stays finished.
--
-- Both are rules of the row itself, so they are triggers: every writer gets
-- them, in the same statement as the write. Idempotent: safe to re-run.
-- =============================================================================

create or replace function private.demand_targets_keep_override()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source = 'override' and new.source is distinct from 'override' then
    return null; -- leave the stored override as it is
  end if;
  return new;
end $$;

drop trigger if exists demand_targets_keep_override on public.demand_targets;
create trigger demand_targets_keep_override
  before update on public.demand_targets
  for each row execute function private.demand_targets_keep_override();

create or replace function private.onboarding_progress_keep_done()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.workers_completed := old.workers_completed or new.workers_completed;
  new.templates_completed := old.templates_completed or new.templates_completed;
  new.forecast_completed := old.forecast_completed or new.forecast_completed;
  return new;
end $$;

drop trigger if exists onboarding_progress_keep_done on public.onboarding_progress;
create trigger onboarding_progress_keep_done
  before update on public.onboarding_progress
  for each row execute function private.onboarding_progress_keep_done();
