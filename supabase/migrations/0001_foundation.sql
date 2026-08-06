-- 0001_foundation.sql
-- Shared infrastructure, settings, profiles, and the invite-only signup gate.
-- Order matters: app_settings must exist before f_today() will compile.

create extension if not exists pgcrypto with schema extensions;

-- ────────────────────────────────────────────────────────────────────────
-- Shared updated_at trigger. Used by nearly every table.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.f_set_updated_at() from public, anon;

-- ────────────────────────────────────────────────────────────────────────
-- app_settings — exactly one row, id fixed to 1.
-- ────────────────────────────────────────────────────────────────────────
create table public.app_settings (
  id                          int  primary key check (id = 1),
  business_name               text not null default 'Bakery',
  business_email              text,
  business_phone              text,
  address_line1               text,
  address_line2               text,
  city                        text,
  postcode                    text,
  country                     text,
  timezone                    text not null default 'Asia/Bahrain',
  currency_code               text not null default 'BHD',
  currency_symbol             text not null default 'BD',
  currency_decimals           int  not null default 3
                                   check (currency_decimals between 0 and 3),
  default_payment_terms_days  int  not null default 14
                                   check (default_payment_terms_days >= 0),
  invoice_prefix              text not null default 'INV-',
  next_invoice_number         int  not null default 1
                                   check (next_invoice_number >= 1),
  lapse_threshold_days        int  not null default 45
                                   check (lapse_threshold_days > 0),
  bank_name                   text,
  bank_account_name           text,
  bank_account_number         text,
  bank_iban                   text,
  bank_swift                  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

insert into public.app_settings (id) values (1);

create trigger trg_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- f_today() — the ONLY correct "today" in this database.
-- The server runs in UTC; the bakery is UTC+3. current_date is wrong for
-- three hours of every day, which silently drops or duplicates a day's
-- orders on the bake list. Never use current_date anywhere.
--
-- Failure mode, documented on purpose: if app_settings is unreadable this
-- returns null, and every not-null column defaulting to it raises. That is
-- loud, which is what we want — a silently wrong date is far worse.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_today()
returns date
language sql
stable
as $$
  select (now() at time zone (select timezone from public.app_settings where id = 1))::date;
$$;

revoke execute on function public.f_today() from public, anon;
grant  execute on function public.f_today() to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- profiles — one row per auth user. Existence of a row IS authorisation
-- (see the RLS policy below and on every later table).
-- ────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.f_set_updated_at();

-- CORRECTION C4 to spec §3 ("do not mark any of these security definer").
-- That rule is right for the reporting functions it was written about and
-- wrong here. This trigger fires inside GoTrue's transaction under a role
-- with no write access to public.profiles; as invoker it fails and user
-- creation rolls back. This is the ONLY security definer object in the
-- codebase. It takes no user-controlled input and writes exactly one row.
create or replace function public.f_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.f_handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.f_handle_new_user();

-- ────────────────────────────────────────────────────────────────────────
-- signup_allowlist — the second of the three auth layers in spec §4.
--
-- CORRECTION C1 to spec §3/§4 ("RLS enabled with ZERO policies").
-- supabase_auth_admin does NOT have BYPASSRLS. With RLS on and no policy,
-- the hook below reads nothing, returns its 403, and EVERY login fails.
-- The grant + role-scoped policy below are what Supabase's own auth-hook
-- documentation requires. anon and authenticated still get nothing, which
-- is the property the spec actually wanted.
-- ────────────────────────────────────────────────────────────────────────
create table public.signup_allowlist (
  email text primary key
);

alter table public.signup_allowlist enable row level security;

revoke all on table public.signup_allowlist from anon, authenticated, public;
grant select on table public.signup_allowlist to supabase_auth_admin;

create policy "auth admin may read the allowlist"
  on public.signup_allowlist
  for select
  to supabase_auth_admin
  using (true);

create or replace function public.hook_restrict_signup(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_email text;
begin
  v_email := lower(event -> 'user' ->> 'email');

  if exists (
    select 1 from public.signup_allowlist where lower(email) = v_email
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message',   'This application is invite-only.',
      'http_code', 403
    )
  );
end;
$$;

grant  execute on function public.hook_restrict_signup(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup(jsonb) from authenticated, anon, public;

-- ────────────────────────────────────────────────────────────────────────
-- RLS: profiles
--
-- CORRECTION C2 to spec §3.9 ("apply to every table").
-- The blanket policy's body reads public.profiles. Applied TO profiles it
-- raises 42P17 infinite recursion, and because every other table's policy
-- reads profiles, the entire app then errors on every query. profiles gets
-- self-referential policies instead. Every OTHER table uses the blanket
-- policy verbatim, and reading profiles from inside it works because the
-- row a user needs is their own.
-- ────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "a user sees their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "a user may update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ────────────────────────────────────────────────────────────────────────
-- RLS: app_settings — the blanket policy from spec §3.9.
-- The outer (select ...) wrappers make these initPlans, evaluated once per
-- query rather than once per row.
-- ────────────────────────────────────────────────────────────────────────
alter table public.app_settings enable row level security;

create policy "app users have full access"
  on public.app_settings
  for all
  to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));
