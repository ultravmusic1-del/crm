-- 0002_customers.sql
-- The CRM core: customers, the people at them, and every touch.

-- ────────────────────────────────────────────────────────────────────────
-- customers
-- ────────────────────────────────────────────────────────────────────────
create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  type           text not null default 'business'
                      check (type in ('business','individual')),
  status         text not null default 'lead'
                      check (status in ('lead','contacted','sampling','active','lapsed','lost')),
  email          text,
  phone          text,
  address_line1  text,
  address_line2  text,
  city           text,
  postcode       text,
  delivery_notes text,
  source         text,   -- free text by design; the UI suggests, never constrains
  price_tier     text not null default 'wholesale'
                      check (price_tier in ('wholesale','retail')),
  notes          text,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_customers_status      on public.customers (status);
create index idx_customers_name_lower  on public.customers (lower(name));
create index idx_customers_archived_at on public.customers (archived_at);

create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- contacts — people at a customer
-- ────────────────────────────────────────────────────────────────────────
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name        text not null,
  role        text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_contacts_customer_id on public.contacts (customer_id);

-- At most one primary per customer.
create unique index idx_contacts_one_primary
  on public.contacts (customer_id) where is_primary;

-- The index above is not deferrable, so "make this one primary" would
-- collide with the existing primary if the app tried to order two
-- statements itself. Demote siblings in a trigger instead — then a Server
-- Action can do one naive UPDATE and always be correct.
create or replace function public.f_demote_other_primary_contacts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.contacts
     set is_primary = false
   where customer_id = new.customer_id
     and id <> new.id
     and is_primary;
  return new;
end;
$$;

revoke execute on function public.f_demote_other_primary_contacts() from public, anon;

-- WHEN (new.is_primary) is what stops this recursing: the demoting UPDATE
-- sets is_primary false, so the trigger does not re-fire for those rows.
create trigger trg_contacts_single_primary
  before insert or update of is_primary, customer_id on public.contacts
  for each row when (new.is_primary)
  execute function public.f_demote_other_primary_contacts();

create trigger trg_contacts_updated_at
  before update on public.contacts
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- interactions — the outreach log
-- ────────────────────────────────────────────────────────────────────────
create table public.interactions (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers(id) on delete cascade,
  contact_id     uuid references public.contacts(id) on delete set null,
  occurred_at    timestamptz not null default now(),
  channel        text not null
                      check (channel in ('email','phone','whatsapp','in_person','sample_drop','other')),
  direction      text not null default 'outbound'
                      check (direction in ('outbound','inbound')),
  subject        text,
  notes          text,
  outcome        text
                      check (outcome in ('no_response','interested','not_interested','ordered','follow_up','other')),
  follow_up_on   date,
  follow_up_done boolean not null default false,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_interactions_customer_occurred
  on public.interactions (customer_id, occurred_at desc);

-- Powers "follow-ups due", which loads on every dashboard render.
-- Excluding nulls keeps the index to only the rows that can ever match.
create index idx_interactions_followup_open
  on public.interactions (follow_up_on)
  where not follow_up_done and follow_up_on is not null;

create trigger trg_interactions_updated_at
  before update on public.interactions
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- Views. security_invoker = on is mandatory: a view without it runs as its
-- owner and bypasses RLS on its base tables, publishing the entire dataset
-- to anyone with the publishable key.
-- ────────────────────────────────────────────────────────────────────────

-- Aggregate in SQL, never in TypeScript. The list needs last contact and
-- next open follow-up per customer; both come from here.
create view public.v_customer_list
with (security_invoker = on) as
select
  c.*,
  agg.last_contacted_at,
  agg.open_follow_up_on
from public.customers c
left join lateral (
  select
    max(i.occurred_at)                                      as last_contacted_at,
    min(i.follow_up_on) filter (where not i.follow_up_done)  as open_follow_up_on
  from public.interactions i
  where i.customer_id = c.id
) agg on true;

revoke all on public.v_customer_list from anon;

create view public.v_follow_ups_due
with (security_invoker = on) as
select
  i.id,
  i.customer_id,
  c.name         as customer_name,
  i.follow_up_on,
  i.subject,
  i.notes,
  i.channel,
  i.outcome,
  (i.follow_up_on < public.f_today()) as is_overdue
from public.interactions i
join public.customers c on c.id = i.customer_id
where not i.follow_up_done
  and i.follow_up_on is not null
  and i.follow_up_on <= public.f_today()
  and c.archived_at is null;

revoke all on public.v_follow_ups_due from anon;

-- ────────────────────────────────────────────────────────────────────────
-- RLS — the blanket policy, verbatim, on all three tables.
-- ────────────────────────────────────────────────────────────────────────
alter table public.customers    enable row level security;
alter table public.contacts     enable row level security;
alter table public.interactions enable row level security;

create policy "app users have full access" on public.customers
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));

create policy "app users have full access" on public.contacts
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));

create policy "app users have full access" on public.interactions
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));
