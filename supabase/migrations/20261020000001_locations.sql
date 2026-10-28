-- =============================================================================
-- Migration: 20261020000001_locations.sql
-- CHG-076 — business locations with a confirmed labor jurisdiction
--
-- Labor law follows the work location, so the jurisdiction and IANA time zone
-- are stored per business location, never per user or device. The app only
-- pre-fills a suggestion (IP / device region); the user confirms, and the
-- server records who confirmed and when.
--
-- jurisdiction_code is a code from services/labor/jurisdictions.ts (e.g. "PE",
-- "US-CA-BERKELEY", "EU", "GENERIC"). The proxy checks it is the code that
-- country / region / city resolve to, so the database only checks its shape.
--
-- Same RLS model as 20261018000001_tenant_isolation.sql: anon gets nothing,
-- authenticated may only SELECT its own tenant's rows, all writes go through
-- the service-role proxy.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.locations (
  id                 uuid        primary key default gen_random_uuid(),
  account_id         text        not null,
  name               text        not null,
  country_code       text        not null,
  region_code        text,
  city_code          text,
  jurisdiction_code  text        not null,
  time_zone          text        not null,
  industry           text        not null,
  employer_headcount integer,
  locations_count    integer,
  detected_hint      jsonb,
  overrides          jsonb       not null default '[]'::jsonb,
  confirmed_by       text        not null,
  confirmed_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_name_length') then
    alter table public.locations
      add constraint locations_name_length check (char_length(btrim(name)) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_country_code_iso2') then
    alter table public.locations
      add constraint locations_country_code_iso2 check (country_code ~ '^[A-Z]{2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_region_code_format') then
    alter table public.locations
      add constraint locations_region_code_format check (region_code is null or region_code ~ '^[A-Z0-9]{1,3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_city_code_format') then
    alter table public.locations
      add constraint locations_city_code_format check (city_code is null or city_code ~ '^[A-Z0-9_]{1,40}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_jurisdiction_code_format') then
    alter table public.locations
      add constraint locations_jurisdiction_code_format check (jurisdiction_code ~ '^[A-Z0-9-]{2,40}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_time_zone_length') then
    alter table public.locations
      add constraint locations_time_zone_length check (char_length(time_zone) between 1 and 64);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_industry_known') then
    alter table public.locations
      add constraint locations_industry_known check (industry in (
        'retail', 'food_service', 'fast_food', 'full_service_restaurant', 'hospitality',
        'hotel', 'warehouse', 'manufacturing', 'healthcare', 'building_services', 'other'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_employer_headcount_nonnegative') then
    alter table public.locations
      add constraint locations_employer_headcount_nonnegative check (employer_headcount is null or employer_headcount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_locations_count_positive') then
    alter table public.locations
      add constraint locations_locations_count_positive check (locations_count is null or locations_count >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_overrides_array') then
    alter table public.locations
      add constraint locations_overrides_array check (jsonb_typeof(overrides) = 'array');
  end if;
end $$;

create index if not exists locations_account_id_idx on public.locations (account_id);

-- updated_at trigger (set_updated_at() is defined in core_tables).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists locations_updated_at on public.locations;
create trigger locations_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

-- ── Row-level security: tenant reads own rows; writes only via the proxy ─────

alter table public.locations enable row level security;

revoke all on public.locations from anon;
revoke insert, update, delete, truncate on public.locations from authenticated;
grant select on public.locations to authenticated;

drop policy if exists "Tenant reads own rows" on public.locations;
create policy "Tenant reads own rows" on public.locations
  for select to authenticated
  using (account_id = (select private.current_account_id()));
