-- =============================================================================
-- When a shift was published (CHG-103)
--
-- roster.published_at is the moment the shift's status last became Published,
-- set by the database (never by a client), and cleared when it goes back to
-- Draft. Editing a Published shift keeps it: a late change is a change after
-- posting, not a new posting. The Home "posted ahead" habit and, later, the
-- labor engine's advance-notice rules read it.
--
-- Rows already Published get their updated_at: the last change, which is at or
-- after the real publish time, so old weeks can only look later than they were,
-- never earlier.
-- Idempotent: safe to re-run.
-- =============================================================================

alter table public.roster add column if not exists published_at timestamptz;

-- Backfill without touching updated_at (an open edit form still matches).
alter table public.roster disable trigger roster_updated_at;
update public.roster
   set published_at = updated_at
 where status = 'Published' and published_at is null;
alter table public.roster enable trigger roster_updated_at;

create or replace function private.roster_set_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'Published' then
    if tg_op = 'INSERT' or old.status is distinct from 'Published' then
      new.published_at := now();
    else
      new.published_at := old.published_at;
    end if;
  else
    new.published_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.roster_set_published_at() from public;

drop trigger if exists roster_published_at on public.roster;
create trigger roster_published_at
  before insert or update on public.roster
  for each row execute function private.roster_set_published_at();

create index if not exists roster_account_published_at_idx
  on public.roster (account_id, date) where status = 'Published';
