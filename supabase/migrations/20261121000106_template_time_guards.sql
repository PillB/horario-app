-- =============================================================================
-- Template times and the no-double-booking rule (CHG-102)
--
-- 1. roster_no_overlap (20261118000105) checks a shift when it is added or
--    moved. Editing a template's times moves every shift that uses it, and was
--    not checked: 06:00-14:00 next to 14:00-22:00 became an overlap when the
--    second template was changed to start at 12:00. A trigger on
--    shift_templates now refuses such an edit, behind the same per-account lock.
--    Only shifts from yesterday on are checked: old overlaps (stored before the
--    rule existed) must not block an edit.
-- 2. The time columns accepted 24:00 to 29:59, which the overlap check cannot
--    read as a time. New and changed rows must be 00:00 to 23:59 (NOT VALID:
--    rows already stored are not re-checked).
-- Idempotent: safe to re-run.
-- =============================================================================

create or replace function private.template_times_no_overlap()
returns trigger
language plpgsql
-- Runs as its owner: the roles that write templates have no access to schema private.
security definer
set search_path = ''
as $$
declare
  clock constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  new_start time;
  new_end   time;
  clash record;
begin
  if new.start_time = old.start_time and new.end_time = old.end_time then
    return new;
  end if;
  if new.start_time !~ clock or new.end_time !~ clock then
    return new; -- not a clock time: the check constraint refuses the row
  end if;
  new_start := new.start_time::time;
  new_end := new.end_time::time;

  -- The same lock as roster_no_overlap: a shift being added waits for this edit, or this edit for it.
  perform pg_advisory_xact_lock(hashtextextended('roster:' || new.account_id, 0));

  select mine.date, w.name, count(*) over () as people into clash
  from public.roster mine
  join public.workers w on w.id = mine.worker_id
  join public.roster r
    on r.account_id = mine.account_id
   and r.worker_id = mine.worker_id
   and r.id <> mine.id
   and r.template_id <> new.id
   and r.date between mine.date - 1 and mine.date + 1
  cross join lateral private.roster_shift_span(r.date, r.template_id) other
  where mine.account_id = new.account_id
    and mine.template_id = new.id
    and mine.date >= current_date - 1
    and other.starts < mine.date + new_end + case when new_end <= new_start then interval '1 day' else interval '0' end
    and mine.date + new_start < other.ends
  order by mine.date
  limit 1;

  if found then
    raise exception 'With these times % would be on two shifts at once on %. Move or remove that shift first', clash.name, clash.date
      using errcode = '23P01';
  end if;
  return new;
end $$;

revoke all on function private.template_times_no_overlap() from public, anon, authenticated;

drop trigger if exists template_times_no_overlap on public.shift_templates;
create trigger template_times_no_overlap
  before update of start_time, end_time on public.shift_templates
  for each row execute function private.template_times_no_overlap();

alter table public.shift_templates drop constraint if exists shift_templates_times_are_clock_times;
alter table public.shift_templates add constraint shift_templates_times_are_clock_times
  check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') not valid;
