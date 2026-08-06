# Oat Bar CRM — Build Plan

A complete, phased specification for building a custom CRM for a home bakery supplying oat bars to local businesses and direct consumers.

**Read this whole document before writing code.** Build phase by phase. Each phase ends in a working, demoable app. Do not start a phase until the previous phase's acceptance criteria pass.

---

## 0. Context

**Who uses it:** Two people. The owner (primary user, non-technical) and the developer (me). No other users, ever. No multi-tenancy, no roles, no permissions matrix. Both users see everything.

**What it must do:**

1. Track prospective and existing customers (cafés, gyms, delis, offices, plus a few individual consumers) and log every outreach touch and reply.
2. Hold a product catalogue with per-customer pricing.
3. Record one-off orders and recurring standing orders (e.g. "Café Lila: 40 Almond, 20 Cacao, every Tuesday").
4. Roll upcoming orders into a weekly bake list and an ingredient shopping list.
5. Issue invoices and track payment status.
6. Surface insights the owner would not otherwise notice — customers going quiet, margin by product, revenue trend, overdue money.

**Non-goals for the MVP.** Do not build these. Do not add them "while you're in there":

- Email/Gmail integration or sending mail from the app. Outreach is logged manually.
- Multi-user permissions, teams, or organisations.
- A customer-facing portal or online ordering.
- Inventory/stock levels of finished goods.
- Accounting integrations, tax filing, payment processing.
- Mobile native apps.

**Design bias:** fully responsive, equal weight to phone and laptop. She will be entering orders on her phone in a kitchen and doing invoicing on a laptop at a desk. Neither is a second-class experience.

---

## 1. Stack

All versions verified 2026-08-06. Pin them. Where a version is pinned deliberately against `latest`, the reason is given — do not "helpfully" upgrade it.

### Core

| Package | Version | Notes |
|---|---|---|
| `next` | `16.3.x` | App Router |
| `react` / `react-dom` | `19.2.x` | |
| `typescript` | `^5.9` | Next 16 supports TS 7, but TS 7 is new; 5.9 is the safe choice |
| `@supabase/supabase-js` | `^2.112` | **Not** v3 (`3.0.0-next.*` exists — ignore it) |
| `@supabase/ssr` | `^0.12` | |
| `supabase` (CLI) | `^2.111` | devDependency |
| `tailwindcss` | `^4.3` | CSS-first config |
| `zod` | `^4.4` | v4 API — see gotchas |
| `react-hook-form` | `^7.84` | **Not** v8 (beta) |
| `@hookform/resolvers` | `^5.7` | |
| `@tanstack/react-table` | **`^8.21`** | **Pinned to v8 deliberately.** v9.0.0 shipped 2026-08-04 with a full API break (`useReactTable` → `useTable`, feature registration). shadcn's data-table guide still teaches v8 and will not compile against v9. |
| `recharts` | `^3.10` | React 19 compatible |
| `date-fns` | `^4.4` | |
| `sonner` | `^2.0` | Toasts — see UI base decision below |
| `cmdk` | `^1.1` | Command palette (via shadcn `command`) |
| `next-themes` | `^0.4` | Dark mode |

No PDF library. Invoices are produced as a print-optimised HTML route the browser prints to PDF. See Phase 5.

### UI base — a decision you must not silently change

shadcn/ui now defaults to **Base UI** as its primitive layer (changed July 2026). **This project pins the Radix base.**

```bash
npx shadcn@latest init -b radix
```

Rationale: Radix uses the `asChild` composition prop that virtually all existing examples and documentation assume; Base UI uses a `render` prop instead. Mixing the two produces components that typecheck but render nothing. Radix is not deprecated — every shadcn component still ships for it. Under the Radix base, **`sonner` is the correct toast** (the new first-party `toast` component is Base-UI-only).

If any `shadcn add` command runs without `-b radix`, it pulls Base UI components into a Radix project. **Verify the base is recorded in `components.json` before adding anything.**

### What we are deliberately NOT using

- **No ORM.** No Prisma, no Drizzle. Query layer is `supabase-js` with types generated from the schema. Prisma 7 on Supabase requires a custom `bypassrls` Postgres role (which defeats the RLS we are setting up), two connection strings, and a migration history that competes with the Supabase CLI. Drizzle's docs currently point at a 1.0 release candidate while `latest` is 0.45 — unstable ground. This app is CRUD over ~13 tables.
  - **Escape hatch:** when a query needs real SQL (bake list rollups, margin reports, invoice creation), write a Postgres **view** or **function** in a migration and call it via `.from()` or `.rpc()`. This is the intended path, not a workaround. Several are specified below.
- **No TanStack Query.** Server Components + Server Actions + `revalidatePath` cover the data flow.
- **No state management library.** URL search params for list state, `useState` for local UI, server for everything else.

---

## 2. Critical framework gotchas

Current-version behaviours that differ from what most examples show. Getting these wrong costs hours.

### Next.js 16

1. **`middleware.ts` is now `proxy.ts`.** Root of the project (or `src/`), exports a function named `proxy`, runs on the Node.js runtime. `middleware.ts` still works but is deprecated. Supabase's session refresh lives here.
2. **Async APIs are mandatory, not warned.** `await params`, `await searchParams`, `await cookies()`, `await headers()`. Sync access was removed.
3. **`next lint` was removed.** Run ESLint or Biome directly.
4. **Turbopack is the default bundler** for both `dev` and `build`.
5. **Caching is opt-in.** Leave `cacheComponents` off. Everything is dynamic by default, which is what an internal CRM wants.
6. **After a mutation in a Server Action, call `revalidatePath()`.** That is all this app needs. Do not reach for tag-based caching — with `cacheComponents` off there is nothing to invalidate.
7. **Never perform a write during a Server Component render.** Mutations belong in Server Actions or route handlers. Renders can be prefetched, retried and run concurrently.
8. Node.js 20.9+ required.

### Supabase Auth

1. **Use `getClaims()`, not `getUser()`, to protect pages and data.** It verifies the JWT signature locally against a cached JWKS endpoint — no network round-trip. Use `getUser()` only when you need the live user *record*.
2. **Never trust `getSession()` for authorization** in server code. Its user object is read from storage and is not revalidated.
3. **Do not put any code between `createServerClient(...)` and `getClaims()`** in the proxy. Supabase documents this specifically: mistakes here cause random, hard-to-debug logouts.
4. **New API key names.** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`) and, for admin scripts only, the secret key (`sb_secret_...`). The legacy `anon`/`service_role` JWT keys are being deprecated by the end of 2026.
5. **Do not hoist the Supabase client into a module-level global.** Create a new one per request.
6. The `setAll` callback in `@supabase/ssr` 0.12.x takes **two** arguments — `setAll(cookiesToSet, headers)`. Older examples show one. In the proxy you must forward the headers.
7. `@supabase/auth-helpers-nextjs` is fully superseded. Do not install it.

### Postgres / Supabase schema

1. **Views do NOT inherit RLS by default.** Unlike functions (which are `security invoker` by default), a view runs as its owner and bypasses RLS on its base tables. **Every view in this project must be created `with (security_invoker = on)`** and have `anon` access revoked. Getting this wrong publishes your entire revenue dataset unauthenticated.
2. **`from` and `to` are reserved keywords** and cannot be function parameter names. All function params are prefixed `p_`.
3. **`supabase-js` cannot open a multi-statement transaction.** Anything needing atomicity across statements (invoice creation) must be a single plpgsql function called via `.rpc()`.
4. Throughout §3, `check in (...)` is shorthand for `check (column_name in (...))`. Write it out properly in the migration.

### Zod 4

1. Import is plain `import * as z from "zod"`.
2. Format helpers moved to the top level: `z.email()`, `z.uuid()`, `z.url()`. The chained forms are deprecated.
3. **Error customisation was rewritten.** `invalid_type_error`, `required_error` and `errorMap` are **gone**. Use the unified `error` param: `z.string().min(1, { error: "Required" })`.
4. If any field uses `.default(...)`, either omit the `useForm` generic entirely or supply all three: `useForm<z.input<typeof s>, unknown, z.output<typeof s>>()`. This is the most common resulting type error.

### shadcn/ui

1. **`<Form />` no longer exists.** Replaced by the library-agnostic `<Field />` primitive. With React Hook Form you wire `<Controller />` yourself. Convention: `data-invalid` on `<Field>`, `aria-invalid` on the control.
2. shadcn's own RHF docs still say "this example uses zod v3". Translate to Zod 4 as you go.
3. **After `shadcn add calendar`, diff the generated `classNames` map against the installed react-day-picker's keys.** Older generated Calendars use long-removed keys (`table`, `nav_button`, `day_selected`) and the calendar renders unstyled. Current keys are `month_grid`, `button_previous`, `button_next`, `selected`. Check the version you actually installed against its own upgrade guide rather than trusting either the shadcn snippet or this document.

---

## 3. Data model

Postgres, in the `public` schema. All tables get RLS enabled.

### Conventions

- **Primary keys:** `uuid` with `default gen_random_uuid()`.
- **Money:** `numeric(12,3)`. Never float. Three decimal places supports BHD/KWD/OMR as well as two-decimal currencies. Currency code and display precision live in `app_settings`.
- **Timestamps:** `timestamptz`, `default now()`. Every table has `created_at` and `updated_at` maintained by a shared trigger, **except** `invoice_orders` and `product_ingredients` (pure join tables, `created_at` only) and `payments` (immutable, `created_at` only).
- **Dates without time** (delivery date, invoice due date) are `date`.
- **"Today" is never `current_date`.** The database runs in UTC; Bahrain is UTC+3, so `current_date` is wrong for three hours of every day. Use `public.f_today()` (defined below) everywhere instead, in both SQL and defaults.
- **Soft delete:** `archived_at timestamptz` on `customers` and `products`. Never hard-delete a record with order history. Orders and invoices are never deleted, only cancelled/voided.
- **Enums:** `text` columns with `check` constraints, not `create type ... as enum`. Enums are painful to alter; check constraints are a one-line migration.
- **Quantities:** `order_items.quantity` and `recurring_order_items.quantity` are always expressed in `products.unit`. `units_per_box` is display-only and never enters a calculation. `product_ingredients.quantity` is per one `products.unit`. This must be consistent or the bake list is wrong by a factor of `units_per_box`.

### Shared infrastructure (migration `0001`)

```sql
-- updated_at trigger, used by nearly every table
create or replace function public.f_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- timezone-correct "today"
create or replace function public.f_today()
returns date language sql stable as $$
  select (now() at time zone (select timezone from public.app_settings where id = 1))::date;
$$;
```

### Tables

**`app_settings`** — single row, `id` fixed to `1`.
```
id int primary key check (id = 1)
business_name              text not null default 'Bakery'
business_email             text
business_phone             text
address_line1              text
address_line2              text
city                       text
postcode                   text
country                    text
timezone                   text not null default 'Asia/Bahrain'
currency_code              text not null default 'BHD'
currency_symbol            text not null default 'BD'
currency_decimals          int  not null default 3 check (currency_decimals between 0 and 3)
default_payment_terms_days int  not null default 14
invoice_prefix             text not null default 'INV-'
next_invoice_number        int  not null default 1
lapse_threshold_days       int  not null default 45   -- drives the "going quiet" insight
bank_name                  text
bank_account_name          text
bank_account_number        text
bank_iban                  text
bank_swift                 text
created_at / updated_at
```

**`profiles`** — one row per auth user.
```
id          uuid primary key references auth.users(id) on delete cascade
full_name   text
created_at / updated_at
```
Populated by an `on auth.users insert` trigger.

**`signup_allowlist`** — see §4. **This table gets RLS enabled with ZERO policies**, plus `revoke all on public.signup_allowlist from anon, authenticated;`. It is the one deliberate exception to the blanket policy in §3.9. Only the auth hook (running as `supabase_auth_admin`) may read it.
```
email text primary key
```

**`customers`** — the central record. Covers businesses and individuals.
```
id              uuid pk
name            text not null
type            text not null default 'business'  check in ('business','individual')
status          text not null default 'lead'
                check in ('lead','contacted','sampling','active','lapsed','lost')
email           text
phone           text
address_line1   text
address_line2   text
city            text
postcode        text
delivery_notes  text          -- "back door, ask for Sam, before 9am"
source          text          -- free text by design; suggest values in the UI, don't constrain
price_tier      text not null default 'wholesale' check in ('wholesale','retail')
notes           text
archived_at     timestamptz
created_at / updated_at
```
Indexes: `status`, `lower(name)`, `archived_at`.

**`contacts`** — people at a customer.
```
id           uuid pk
customer_id  uuid not null references customers(id) on delete cascade
name         text not null
role         text
email        text
phone        text
is_primary   boolean not null default false
notes        text
created_at / updated_at
```
Index on `customer_id`. At most one primary per customer:
`create unique index on contacts (customer_id) where is_primary;`

Because the index is not deferrable, a naive "set this one primary" update will collide with the existing primary. Enforce it with a `before insert or update` trigger that demotes siblings first, rather than relying on the Server Action to order two statements correctly.

**`interactions`** — the outreach log. The heart of the CRM half of the app.
```
id             uuid pk
customer_id    uuid not null references customers(id) on delete cascade
contact_id     uuid references contacts(id) on delete set null
occurred_at    timestamptz not null default now()
channel        text not null check in ('email','phone','whatsapp','in_person','sample_drop','other')
direction      text not null default 'outbound' check in ('outbound','inbound')
subject        text
notes          text
outcome        text check in ('no_response','interested','not_interested','ordered','follow_up','other')
follow_up_on   date
follow_up_done boolean not null default false
created_by     uuid references profiles(id)
created_at / updated_at
```
Indexes: `(customer_id, occurred_at desc)`, and a partial index on `follow_up_on where not follow_up_done` — this powers the "due today" list and must be fast.

**`products`**
```
id                uuid pk
name              text not null
sku               text unique
description       text
unit              text not null default 'bar' check in ('bar','box','tray')
units_per_box     int not null default 1
wholesale_price   numeric(12,3) not null default 0 check (wholesale_price >= 0)
retail_price      numeric(12,3) not null default 0 check (retail_price >= 0)
unit_cost         numeric(12,3) not null default 0 check (unit_cost >= 0)
archived_at       timestamptz
created_at / updated_at
```
There is **no `active` boolean.** Availability is `archived_at is null`, consistently with `customers`. Do not add a second soft-delete flag.

**`customer_prices`** — per-customer override. No row means fall back to the tier price.
```
id           uuid pk
customer_id  uuid not null references customers(id) on delete cascade
product_id   uuid not null references products(id) on delete cascade
unit_price   numeric(12,3) not null check (unit_price >= 0)
unique (customer_id, product_id)
created_at / updated_at
```

**`ingredients`**
```
id          uuid pk
name        text not null unique
unit        text not null                                   -- 'g','ml','each'
pack_size   numeric(12,3) not null default 1 check (pack_size > 0)
pack_cost   numeric(12,3) not null default 0 check (pack_cost >= 0)
created_at / updated_at
```
`pack_size` is `not null` with a positive check because the shopping list divides by it. A null would silently null out a row; a zero would raise `division_by_zero` and take down the whole page.

**`product_ingredients`** — quantity per one unit of product.
```
id             uuid pk
product_id     uuid not null references products(id) on delete cascade
ingredient_id  uuid not null references ingredients(id) on delete restrict
quantity       numeric(12,3) not null check (quantity > 0)
unique (product_id, ingredient_id)
created_at
```

**`recurring_orders`** — standing orders.
```
id             uuid pk
customer_id    uuid not null references customers(id) on delete cascade
frequency      text not null check in ('weekly','fortnightly','monthly')
day_of_week    int check (day_of_week between 0 and 6)   -- 0 = SUNDAY, matching extract(dow)
day_of_month   int check (day_of_month between 1 and 28)
starts_on      date not null
ends_on        date
active         boolean not null default true
notes          text
created_at / updated_at
```
Constraint: `check ((frequency in ('weekly','fortnightly') and day_of_week is not null) or (frequency = 'monthly' and day_of_month is not null))`.

- `day_of_week` **0 = Sunday**, matching Postgres `extract(dow from date)`. Note that `date-fns` also uses 0 = Sunday, but ISO numbering uses 1 = Monday — do not mix them.
- **Fortnightly parity is anchored on `starts_on`:** a date is due when `floor((delivery_date - starts_on) / 7) % 2 = 0`.
- `day_of_month` capped at 28, which removes the "31st of February" problem entirely.
- There is deliberately **no `paused_until` column.** Pausing for a holiday is done by toggling `active`. Do not add one.

**`recurring_order_items`**
```
id                  uuid pk
recurring_order_id  uuid not null references recurring_orders(id) on delete cascade
product_id          uuid not null references products(id) on delete restrict
quantity            int not null check (quantity > 0)
unique (recurring_order_id, product_id)
created_at
```

**`orders`**
```
id                   uuid pk
customer_id          uuid not null references customers(id) on delete restrict
order_number         int not null unique generated by default as identity
status               text not null default 'confirmed'
                     check in ('draft','confirmed','in_production','delivered','cancelled')
ordered_on           date not null default public.f_today()
delivery_date        date not null
recurring_order_id   uuid references recurring_orders(id) on delete set null
delivery_address     text          -- snapshot at creation, copied from customer
delivery_notes_snapshot text       -- snapshot at creation
notes                text
created_at / updated_at

unique (id, customer_id)   -- supports the composite FK from invoice_orders
```
Indexes: `(delivery_date)`, `(customer_id, delivery_date desc)`, `(status)`.
Duplicate-generation guard:
`create unique index on orders (recurring_order_id, delivery_date) where recurring_order_id is not null;`

Address and delivery notes are snapshotted so a customer moving does not rewrite historical delivery sheets.

**`order_items`** — prices **and names** are snapshotted. Changing or renaming a product must never alter a past order or reprint a historical invoice differently.
```
id            uuid pk
order_id      uuid not null references orders(id) on delete cascade
product_id    uuid not null references products(id) on delete restrict
product_name  text not null                       -- snapshot
quantity      int not null check (quantity > 0)
unit_price    numeric(12,3) not null check (unit_price >= 0)   -- snapshot
unit_cost     numeric(12,3) not null default 0                 -- snapshot, for historical margin
line_total    numeric(12,3) generated always as (quantity * unit_price) stored
unique (order_id, product_id)
created_at
```

**`invoices`**
```
id               uuid pk
customer_id      uuid not null references customers(id) on delete restrict
invoice_number   text not null unique
status           text not null default 'draft' check in ('draft','sent','paid','void')
issued_on        date not null default public.f_today()
due_on           date not null
discount_amount  numeric(12,3) not null default 0 check (discount_amount >= 0)
delivery_charge  numeric(12,3) not null default 0 check (delivery_charge >= 0)
notes            text
created_at / updated_at

unique (id, customer_id)   -- supports the composite FK from invoice_orders
```
**`overdue` is not a stored status.** It is derived (`status = 'sent' and due_on < f_today()`). Storing it would require a cron job to keep it true.

`discount_amount` and `delivery_charge` exist because retrofitting them later touches the totals view, the PDF template and payment reconciliation. They default to zero and the UI can hide them until used.

**`invoice_orders`** — join table. One invoice can cover several orders (a month of weekly deliveries).
```
invoice_id   uuid not null references invoices(id) on delete cascade
order_id     uuid not null references orders(id) on delete restrict
customer_id  uuid not null
primary key (invoice_id, order_id)
unique (order_id)

foreign key (order_id, customer_id)   references orders(id, customer_id)
foreign key (invoice_id, customer_id) references invoices(id, customer_id)
created_at
```
The composite foreign keys make it structurally impossible to put Café A's order on Café B's invoice — a bug that is otherwise silent and embarrassing.

**Voiding deletes the `invoice_orders` rows.** `unique (order_id)` cannot be made conditional on the invoice's status, because a partial index predicate may only reference columns of its own table. So voiding an invoice (a) sets `status = 'void'` and (b) deletes its `invoice_orders` rows, which releases those orders to be invoiced again. The void invoice is retained for the record with its number and totals frozen — snapshot `voided_total numeric(12,3)` on `invoices` at void time so the historical figure survives the join rows being removed. Do this in a single function, `f_void_invoice(p_invoice_id uuid)`.

**`payments`**
```
id          uuid pk
invoice_id  uuid not null references invoices(id) on delete cascade
paid_on     date not null default public.f_today()
amount      numeric(12,3) not null check (amount > 0)
method      text check in ('cash','bank_transfer','card','other')
reference   text
created_at
```
Index on `invoice_id` — `v_invoice_totals` aggregates it for every row.
Partial payments are supported by design: an invoice is paid when its payments sum to its total.

### Views and functions

**Every view is created `with (security_invoker = on)`**, followed by `revoke all on <view> from anon;`. Every function is `security invoker` (the default) — do **not** mark any of these `security definer`.

**Status filtering is explicit and must not be omitted:**
- Revenue, margin and customer-summary figures count orders with `status in ('confirmed','in_production','delivered')`. `draft` and `cancelled` are excluded.
- The bake list counts `status in ('confirmed','in_production','delivered')`. Including `delivered` is deliberate: reprinting Wednesday's weekly bake list must not silently drop Monday and Tuesday. Only `draft` and `cancelled` are excluded.

**`v_order_totals`** — order id, customer id, status, delivery date, subtotal, total cost, gross margin.

**`v_invoice_totals`** — invoice id, subtotal (sum of covered order totals), discount, delivery charge, total, amount_paid, balance, and a derived `computed_status` of `draft | sent | overdue | paid | void`.

**`v_customer_summary`** — per customer: lifetime revenue, order count, first order date, last order date, days since last order, average days between orders, and `risk_flag`.

`risk_flag` requires care, or it fires on every new customer:
```
risk_flag = (
      order_count >= 3
  and archived_at is null
  and status not in ('lead','lost')
  and days_since_last_order > greatest(avg_gap_days * 1.5, s.lapse_threshold_days)
)
```
The threshold comes from `app_settings` via `cross join (select lapse_threshold_days from app_settings where id = 1) s`. The `order_count >= 3` guard matters: with one order, `avg_gap_days` is null, `greatest` ignores nulls, and the threshold silently collapses to 45 days — flagging every customer who ordered once two months ago.

**`f_product_performance(p_from date, p_to date)`** — per product: units sold, revenue, cost, margin, margin %.

**`f_bake_list(p_from date, p_to date)`** — product, total quantity, and the contributing customers/orders.

**`f_shopping_list(p_from date, p_to date)`** — joins the bake list through `product_ingredients` to total each ingredient, then `ceil(total / pack_size)` for packs to buy and the estimated cost.

**`f_create_invoice(p_customer_id uuid, p_order_ids uuid[], p_issued_on date, p_due_on date)`** — allocates the invoice number and inserts the invoice plus its `invoice_orders` rows in one statement-safe function. Number allocation must be a single atomic statement:
```sql
update public.app_settings
   set next_invoice_number = next_invoice_number + 1
 where id = 1
returning next_invoice_number - 1 into v_num;
```
A read-then-increment from a Server Action is a lost-update race. This is exactly why the function exists.

**`f_void_invoice(p_invoice_id uuid)`** — snapshots the total, sets status to `void`, deletes the `invoice_orders` rows.

**`f_generate_scheduled_orders(p_until date)`** — materialises orders from active schedules through a horizon. See Phase 3 for the rules.

**Reserved words:** parameters are prefixed `p_` because `from` and `to` are reserved keywords in Postgres and cannot be parameter names. This also determines the RPC payload shape: `.rpc('f_bake_list', { p_from, p_to })`.

### RLS policy

Both users see everything, so policies are trivial. Apply to **every** table in `public` **except `signup_allowlist`**:

```sql
alter table public.customers enable row level security;

create policy "app users have full access"
on public.customers
for all
to authenticated
using ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));
```

The outer `(select ...)` wrapper makes this an `initPlan` — evaluated once per query, not once per row. Referencing `profiles` rather than writing `using (true)` makes the third auth layer in §4 real: a user with no `profiles` row genuinely has no data access.

**Do not skip RLS on the grounds that "it's only two users."** The Supabase Data API (PostgREST) is publicly reachable and the publishable key ships in the browser bundle by design. A table without RLS is an open read/write endpoint on the internet. The `TO authenticated` clause excludes the `anon` role and short-circuits before the policy body runs.

Run the Supabase **Security Advisor** and **Performance Advisor** before considering the app done.

---

## 4. Auth setup

**Method:** email + password. Two accounts, created by hand, once.

**Lock it down in three layers:**

1. **Disable signups.** Dashboard → Authentication → Sign In / Providers → turn off "Allow new users to sign up". Create both users manually under Authentication → Users → Add user.
2. **`before-user-created` auth hook** against an explicit allowlist. Register under Authentication → Hooks.
3. **`profiles` + RLS** — the policy in §3 requires a `profiles` row, so an unexpected `auth.users` row grants nothing.

```sql
create table public.signup_allowlist (email text primary key);
alter table public.signup_allowlist enable row level security;   -- no policies: nobody but the hook
revoke all on public.signup_allowlist from anon, authenticated;

create or replace function public.hook_restrict_signup(event jsonb)
returns jsonb language plpgsql as $$
declare v_email text;
begin
  v_email := lower(event->'user'->>'email');
  if exists (select 1 from public.signup_allowlist where lower(email) = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'message', 'This application is invite-only.', 'http_code', 403));
end; $$;

grant execute on function public.hook_restrict_signup to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup from authenticated, anon, public;
```

**Build no signup page.** The only auth routes are `/login`, `/auth/callback`, and password reset. A signup form is a liability with no user.

**Session length:** set the JWT expiry generously (Dashboard → Auth → Sessions). She should not be logged out mid-week.

---

## 5. Application structure

```
src/
  app/
    (auth)/
      login/page.tsx
      auth/callback/route.ts
    (app)/
      layout.tsx                # sidebar + topbar + command palette + toaster
      page.tsx                  # dashboard
      customers/
        page.tsx · new/page.tsx · [id]/page.tsx · [id]/edit/page.tsx
      orders/
        page.tsx · new/page.tsx · [id]/page.tsx
      schedules/
        page.tsx · new/page.tsx · [id]/page.tsx
      production/page.tsx
      invoices/
        page.tsx · new/page.tsx · [id]/page.tsx · [id]/print/page.tsx
      products/
        page.tsx · [id]/page.tsx
      ingredients/page.tsx
      insights/page.tsx
      settings/page.tsx
    layout.tsx · globals.css
  components/
    ui/                         # shadcn — do not hand-edit beyond theme tokens
    app/
      customer-form.tsx · interaction-form.tsx · order-form.tsx
      data-table/               # column-header, pagination, view-options, toolbar
      money.tsx                 # single currency formatter — use everywhere
      date-display.tsx · status-badge.tsx · empty-state.tsx
      command-palette.tsx · quick-add-sheet.tsx
  lib/
    supabase/{client,server,proxy}.ts
    actions/                    # one file per domain, all 'use server'
    schemas/                    # Zod schemas, shared between form and action
    queries/                    # typed read helpers used by Server Components
    format.ts                   # money, date, phone formatting
    database.types.ts           # generated — never hand-edit
proxy.ts                        # root; exports `proxy`
supabase/
  migrations/ · seed.sql · verify.sql
```

### Data flow rules

1. **Reads happen in Server Components** via `lib/queries/*`. No `useEffect` fetching.
2. **Writes happen in Server Actions** in `lib/actions/*`. Every action: `'use server'`, re-validate input with the same Zod schema the form used, mutate, `revalidatePath()`, return a typed `{ ok: true } | { ok: false, error: string, fieldErrors?: ... }`.
3. **Never trust client-supplied prices.** When creating an order, the client sends `product_id` and `quantity`. The **server** resolves the unit price and writes the snapshot. A price arriving from the browser is ignored.
4. **List state lives in the URL** (`?q=&status=&sort=&page=`). Copying the address bar reproduces the view; back button works; a filtered list is shareable.
5. **All money formatting goes through `<Money />`.** No ad-hoc `toFixed()` anywhere. Currency and decimals come from `app_settings`.
6. **Never write during a render.** See §2.

---

## 6. UX specification

This section is not decoration. The difference between a CRM she uses and one she abandons is almost entirely here. Each rule carries its reasoning so you can extend it consistently rather than pattern-match. Where a claim comes from published usability research, the source is named so you can check it — the reasoning should stand on its own either way.

### 6.1 Editing model — side panel, not modal

**Rule:** a right-hand **non-modal sheet** for editing a record while its list stays visible. Full pages only for multi-section creation (a new order with line items). Modals **only** for destructive confirmation.

**Why:** Nielsen Norman Group's data-tables research reports that in usability testing, users routinely refer to other records while editing one — checking what a plausible value looks like. A modal covers exactly the rows they need.

Inline editing is reserved for **single-field, low-risk, high-frequency** changes: customer status, order status, follow-up done. The row must look visibly different in edit mode so an accidental edit is obvious.

### 6.2 Forms

- **Single column.** Multi-column layouts break vertical momentum. Only exception: short logically-grouped fields (City / Postcode).
- **Labels above fields**, always. Never placeholder-as-label.
- **Cut every field you can.** A new customer needs a name. That is genuinely it. Required-field bloat is the single biggest driver of both skipped data entry and junk data — people type "TBD" to escape a required field. NN/g reports a controlled study (Seckler et al., CHI 2014) in which forms following basic usability guidelines produced markedly higher error-free first-submission rates than forms violating them.
- **Validate on blur, not on change.** `useForm({ mode: 'onTouched' })` — validate on first blur, then live. Don't show an error until the user has finished with the field.
- **Errors sit next to the field**, in red *plus* an icon *plus* text. Never colour alone, never a tooltip, never only a summary at the top.
- **Match field width to expected input.** A quantity field is not full-width.
- **Accept any phone number format** and normalise server-side. Baymard's testing found most users enter numeric input in varied formats even when shown an example, and format-rejection causes real abandonment.
- **No Reset or Clear buttons.** Accidental-deletion risk outweighs the need.
- **Preserve input on error.** Never clear a form because validation failed.

### 6.3 Lists and tables

- **First column is a human-readable name**, never a UUID or bare order ID.
- **Client-side sorting, filtering and pagination.** This dataset will not exceed a few thousand rows for years, well inside what TanStack Table handles comfortably in the browser. Server-side pagination would add latency and complexity for nothing. **Do not mix** — if any list ever moves to server pagination, its sorting and filtering must move with it, or you sort only the current page.
- **Pagination, not infinite scroll.** Business data requires finding a record and returning to it.
- **Sticky header row** with a subtle shadow once scrolled.
- **Row hover highlight** and clear row separation — they help users hold their place across a wide row.
- **Filters must be visibly active.** A chip row showing "Status: Lead ×" with one-click clear.
- **Two distinct empty states.** "No customers yet" (onboarding, illustrated, primary CTA) is a completely different screen from "No customers match these filters" (show the active filters, offer one-click clear). Most internal tools conflate these; don't.
- **Right-align numeric columns** with tabular figures (`font-variant-numeric: tabular-nums`) so decimal points stack.
- **Bulk actions** via a checkbox column and an action bar that appears on selection. Needed for: marking follow-ups done, marking orders delivered, adding orders to an invoice.

### 6.4 Feedback and safety

- **Optimistic UI only for idempotent, reversible, single-object mutations**: toggling order status, marking a follow-up done, archiving. **Never** for order creation, invoice issuing, or payment recording — anything with server-generated identity or a money consequence.
- **On optimistic failure:** roll back with a visible transition, show a **persistent** (non-auto-dismissing) message anchored near the affected row, offer Retry.
- **Undo, not confirm, for reversible destructive actions.** Archiving a customer → toast with Undo. Reserve modal confirmation for genuinely irreversible things (voiding an invoice).
- **Explicit Save on forms** with a visible dirty state. Do not autosave forms. Autosave is acceptable only for the free-text notes field on a customer detail page, with a visible "Saved" indicator.
- **Never autosave into an irreversible side effect.**

### 6.5 Keyboard and speed

- **Cmd/Ctrl+K command palette** on every screen, closing on the same shortcut and restoring focus. It is the *teaching mechanism* for shortcuts — display the shortcut next to every entry.
- Entries: navigate to each section, "New customer", "New order", "New interaction", "Today's follow-ups", plus fuzzy search over customers and products.
- **Forgiving matching** with aliases ("client" finds "customer"; "cafe" matches "café").
- **`G` then a key** for navigation (`G C` customers, `G O` orders, `G P` production), `N` for new-in-context, `/` to focus search, `Esc` to close panels.
- The palette is an *accelerator* — an alternate path experts use and novices can ignore. It never replaces a visible button.

### 6.6 Mobile

- **Touch targets minimum 44×44px**, larger for anything used while standing in a kitchen or holding a delivery box.
- **Correct keyboard per field:** `inputMode="numeric"` for quantities, `inputMode="decimal"` for money, `type="tel"`, `type="email"`, and correct `autoComplete` tokens.
- **Steppers (− / +) for quantities.** One tap versus focus → type → dismiss keyboard. The single biggest mobile win in this app, since order entry is mostly quantities.
- **Tables collapse to cards below `md`**, showing only the columns that satisfy the majority need. Not a horizontally scrolling table.
- **Bottom-anchored primary action** on mobile forms, within thumb reach.
- A **"Quick order"** flow two taps from the dashboard: pick customer → their usual items pre-filled from the last order → adjust with steppers → save.

### 6.7 Visual design

- shadcn/ui default theme with **one** accent colour from the bakery's branding. Do not introduce a second design language.
- Dark mode via `next-themes`, respecting system preference.
- Density: comfortable by default. Header and body rows the same height.
- Status communicated by **badge shape and label**, colour as reinforcement only.
- Skeleton loaders in `loading.tsx`, not spinners, on list and detail pages.

---

## 7. Build phases

Each phase is independently shippable. Do not begin the next until acceptance criteria pass.

---

### Phase 0 — Foundation

**Goal:** a deployed, authenticated shell with settings and a dashboard skeleton.

**Steps**

1. `npx create-next-app@latest` — TypeScript, App Router, Tailwind, `src/`, alias `@/*`.
2. `npx shadcn@latest init -b radix`. Verify `components.json` records the radix base.
3. Install the pinned dependencies from §1.
4. `npx supabase init`, `npx supabase start`.
5. Build `lib/supabase/{client,server,proxy}.ts` and root `proxy.ts` per §2. Use `getClaims()`.
6. **Migration `0001_foundation.sql`:** `f_set_updated_at()`, `app_settings` (+ seeded row), `f_today()`, `profiles` + the `on auth.users insert` trigger, `signup_allowlist` (RLS enabled, zero policies, revoked), `hook_restrict_signup` with grants. RLS on `profiles` and `app_settings`.
   Order matters: `app_settings` must exist before `f_today()` compiles.
7. `/login` — email + password, Zod-validated. **No signup page.**
8. App shell: collapsible sidebar (drawer on mobile), topbar with search trigger and user menu, `<Toaster />`, theme provider.
9. **`error.tsx`, `not-found.tsx` and `loading.tsx` at the app-group root.** Every later route inherits sane boundaries from day one instead of a Phase 7 retrofit.
10. **Dashboard shell** (`/`) — the page exists with section placeholders. Phases 1, 3 and 6 fill in their own sections. This avoids Phase 1 depending on a page that does not exist.
11. **Settings page** (`/settings`) — business details, currency, terms, invoice prefix, bank details, lapse threshold. Needed now because `<Money />` reads currency from it.
12. `npm run db:types` → `src/lib/database.types.ts`. Wire the `Database` generic into both clients.
13. `lib/format.ts` — `formatMoney`, `formatDate`, `formatDateRange`, reading from settings.
14. Push to GitHub. Deploy to Vercel. Confirm login works in production.

**Acceptance**
- Any `/(app)` route while logged out redirects to `/login`.
- Login lands on the dashboard; refresh does not log you out.
- Signing up through the API is rejected.
- `database.types.ts` is generated, not hand-written.
- Currency set in Settings changes how `<Money />` renders everywhere.
- The deployed Vercel URL is functional.

---

### Phase 1 — Customers, contacts, outreach

**Goal:** the CRM core. Add a prospect, log every touch, never lose a follow-up.

**Migration `0002_customers.sql`:** `customers`, `contacts` (+ the primary-demotion trigger), `interactions`, indexes, RLS, `updated_at` triggers.

**Build**

- **Customer list** (`/customers`): TanStack Table v8. Search across name/email/phone, status filter chips, sortable columns, client pagination, URL-persisted state. Columns: Name, Status, Type, City, Last contact, Actions. Cards below `md`. Both empty states.
- **New customer form:** only **Name** required. Server Action, toast, redirect to detail.
- **Customer detail** (`/customers/[id]`): header with name, inline-editable status badge, key actions. Tabs: **Overview** (details, contacts, autosaving notes) and **Activity** (interaction timeline). **Do not render Orders or Pricing tabs yet** — they arrive in Phases 3 and 2. Omit the triggers entirely rather than stubbing disabled tabs.
- **Edit** in a right-hand sheet.
- **Contacts:** add/edit/remove inline within Overview. The trigger handles primary demotion.
- **Interaction logging** — optimise this hard; it is the most-repeated action in the app:
  - "Log interaction" opens a sheet pre-filled with today's date and the primary contact.
  - Channel as a row of icon toggle buttons, not a dropdown.
  - Notes autofocused.
  - Outcome as segmented buttons.
  - "Follow up on" with quick-pick chips: *Tomorrow · In 3 days · Next week · In 2 weeks · Custom*. Typing a date must also work — use a segmented date field, not calendar-click-only.
  - Save and close, or **Save and log another**.
- **Activity timeline:** reverse chronological, grouped by month, channel icon, outcome badge, follow-up marker.
- **Follow-ups due** — fills the "Today" section of the Phase 0 dashboard shell, plus a `/customers?followup=due` filter. Overdue visually distinct. One-click "Mark done", optimistic, with Undo.
- **Status transitions:** moving to `active` or `lost` prompts (non-blocking) to log an interaction explaining why.

**Acceptance**
- Add a customer with only a name in under 10 seconds.
- Log an interaction with a follow-up in under 20 seconds on a phone.
- Follow-ups due today appear on the dashboard and clear in one tap.
- Filters persist across refresh and are shareable by URL.
- Fully usable at 375px width.

---

### Phase 2 — Products, pricing, ingredients

**Migration `0003_products.sql`:** `products`, `customer_prices`, `ingredients`, `product_ingredients`, RLS, triggers.

**Build**

- **Products list and detail.** Margin % computed live from `wholesale_price` and `unit_cost` as she types, so mispricing is visible immediately.
- **Recipe editor** on product detail: ingredients with per-unit quantities. Show computed ingredient cost and flag divergence from `unit_cost` ("Recipe cost is 0.310 but unit cost is set to 0.250 — update?").
- **Ingredients page:** CRUD with pack size and pack cost.
- **Pricing tab** now added to customer detail: all non-archived products with effective price and its source (*Wholesale* / *Retail* / *Custom*). Inline-edit to override; clear to revert.
- **`resolvePrice(customerId, productId)`** — customer override → tier price. **Throws if the resolved price is 0**, since a zero price is far more likely a missing setup than a genuine freebie. Every order path uses this; it is the single source of truth for price.

**Acceptance**
- A custom price for one customer does not affect any other.
- Changing a product's list price does not alter any existing order's line total.
- Recipe cost matches a hand calculation on a seeded product.
- Creating an order for a product with no price set fails loudly rather than writing a zero.

---

### Phase 3 — Orders and recurring schedules

**Migration `0004_orders.sql`:** `orders` (identity `order_number`, composite unique, snapshot columns), `order_items`, `recurring_orders`, `recurring_order_items`, all constraints and indexes from §3, `v_order_totals`, `f_generate_scheduled_orders`.

**Build**

- **Order list** (`/orders`): default filter **upcoming** (`delivery_date >= f_today()`). Toggles: Upcoming / This week / Past / All. Columns: Order #, Customer, Delivery date, Items, Total, Status. Grouped by delivery date under Upcoming.
- **Order form** — the second-most-used screen:
  - Customer combobox with type-ahead. On selection, offer **"Repeat last order"** one-click prefill.
  - Line items: product combobox + quantity stepper. Unit price read-only, resolved server-side, source labelled.
  - Running total live.
  - Delivery date defaults to the next likely delivery day; chips for *Tomorrow · This Friday · Next Tuesday*.
  - Adding a row must not require a mouse: product field autofocuses, Enter adds another row.
  - On save, the server snapshots `product_name`, `unit_price`, `unit_cost`, `delivery_address`, `delivery_notes_snapshot`.
- **Order detail:** line items, totals, status control, delivery notes, link to its invoice if any.
- **Status flow:** `draft → confirmed → in_production → delivered`, `cancelled` from any state. Inline and optimistic.
- **Orders tab** now added to customer detail.
- **Recurring schedules** (`/schedules`): customer, frequency, day, items, start, optional end. Detail page previews the next 8 generated dates.
- **Generation** — `f_generate_scheduled_orders(p_until date)`, called from a visible **"Generate upcoming orders"** button on `/schedules`, reporting what it created. Horizon defaults to 21 days.
  - **Idempotent via `on conflict (recurring_order_id, delivery_date) do nothing`.** The unique index alone would raise an error, not skip.
  - **Skip products whose `archived_at` is set**, and surface a warning on `/schedules` naming the schedule and product. Otherwise a discontinued bar is generated forever.
  - **Skip inactive schedules and those past `ends_on`.**
  - **If the user manually changes a generated order's `delivery_date`, clear its `recurring_order_id`.** Otherwise the next run recreates an order on the original date. This is a Server Action rule, not a database one.
  - **Do not call generation from the dashboard render.** Writes during a render are forbidden in Next 16 and will race under prefetch. A button she understands beats a background job she cannot see. If automation is ever wanted, use `pg_cron`, not a render.

**Acceptance**
- Repeat order for an existing customer in under 30 seconds.
- Running generation five times produces no duplicates and no errors.
- Editing a generated order does not alter its schedule; changing its delivery date detaches it.
- Deactivating a schedule stops future generation but leaves generated orders intact.
- A schedule containing an archived product generates the remaining lines and warns.
- Order totals match hand calculation on seeded data.

---

### Phase 4 — Production

**Migration `0005_production.sql`:** `f_bake_list(p_from, p_to)`, `f_shopping_list(p_from, p_to)`.

**Build**

- **`/production`** with a week picker (default current week, Mon–Sun) and quick jumps.
- **Bake list:** product, total quantity, expandable breakdown by customer/order. Sorted by quantity descending.
- **Shopping list:** ingredient, total needed, packs to buy (`ceil(total / pack_size)`), estimated cost, total at the bottom.
- **Delivery schedule:** same window grouped by day, with the snapshotted address and delivery notes.
- **Print stylesheet.** She will print the bake list and take it into the kitchen. `@media print`: hide navigation, black on white, legible at arm's length. Not optional polish — it is how the feature gets used.
- **"Mark day's orders as in production"** bulk action.

**Acceptance**
- Bake list totals equal the sum of order items across the range, verified by hand against seed data.
- `draft` and `cancelled` are excluded; `delivered` is included, so reprinting mid-week gives the same totals.
- Printed output is legible and fits one page for a typical week.

---

### Phase 5 — Invoices and payments

**Migration `0006_invoices.sql`:** `invoices` (with `voided_total`), `invoice_orders` (composite FKs), `payments` (+ index), `v_invoice_totals`, `f_create_invoice`, `f_void_invoice`.

**Build**

- **Invoice list:** Invoice #, Customer, Issued, Due, Total, Paid, Balance, Status — status from the view's derived `computed_status`. Default filter unpaid. Overdue visually distinct.
- **Create invoice:** pick customer → see their uninvoiced non-cancelled delivered orders → select → set issue date and due date (defaulting to `issued_on + default_payment_terms_days`) → create via `f_create_invoice`. Optional discount and delivery charge, hidden behind an "Add adjustment" affordance.
- **Invoice detail:** header, covered orders with line items, totals, payment history, actions (Mark sent, Record payment, Void, Print).
- **Record payment:** amount defaulting to the outstanding balance, date, method, reference. Partial payments supported.
- **PDF via print route.** `/invoices/[id]/print` renders a clean, print-styled invoice — business details and bank details from `app_settings`, customer address, line items, totals, terms. She uses the browser's Print → Save as PDF. **No PDF dependency**, no headless Chrome on Vercel, consistent with the Phase 4 print stylesheet. Keep the template in one file; it will be re-themed.
- **Void, never delete.** `f_void_invoice` snapshots the total, sets status `void`, and deletes the `invoice_orders` rows, releasing those orders.

**Acceptance**
- An invoice covering three orders totals the sum of those orders, plus delivery charge, minus discount.
- An order cannot appear on two active invoices.
- An order can never be attached to an invoice belonging to a different customer (verify by attempting it directly in SQL — the composite FK must reject it).
- A partial payment leaves the invoice `sent`, not `paid`; the balance is correct.
- Voiding releases its orders to be invoiced again, and the voided invoice retains its number and total.
- Invoice numbers are unique and monotonically increasing. Gaps from voided invoices are expected and correct.
- The print route produces a clean single-page invoice.

---

### Phase 6 — Dashboard and insights

**Migration `0007_insights.sql`:** `v_customer_summary`, `f_product_performance(p_from, p_to)`.

**Fill in the Phase 0 dashboard shell**, ordered as the answer to "what do I need to do today?":

1. **Today** — deliveries due, follow-ups due, overdue follow-ups. One tap each.
2. **This week** — order count and value, bake-list summary, unbilled delivered orders.
3. **Money** — revenue this month vs last with delta, outstanding balance, overdue amount and count.
4. **Needs attention** — the at-risk customers from `v_customer_summary.risk_flag`, each with one-click "Log outreach". **This is the insight that justifies the whole application** — it turns passive records into a prompt to act.
5. **Charts** (shadcn `chart`, Recharts 3): revenue by month (12-month bar), product mix by units (last 90 days), new customers by month.

**`/insights`** for deeper reporting:
- Revenue by customer, sortable, with period comparison.
- Product performance: units, revenue, cost, margin, margin %. Highlight thin or negative margins.
- Order cadence per customer: average gap, last order, trend.
- Outreach effectiveness: interactions by channel, and conversion from `contacted` to first order — this tells her whether sample drops or emails actually work.
- Period picker (This month / Last month / Last 90 days / This year / Custom), persisted in the URL.

**Chart rules:** always set `min-h-[300px]` or `aspect-video` on `ChartContainer` and keep charts in `"use client"` — unmeasured containers are the top cause of blank charts and layout shift. Use `var(--chart-1)`, not `hsl(var(--chart-1))`, with Recharts 3.

**Acceptance**
- Every dashboard number is reproducible by hand from seed data.
- The at-risk list flags a seeded customer whose last order is well past their usual gap, and does **not** flag a customer with fewer than three orders, an archived customer, or a lead.
- Charts render on first paint with no layout shift.
- Genuinely useful at 375px — this is the screen she checks most often.

---

### Phase 7a — Speed

- **Command palette** per §6.5: navigation, create actions, fuzzy search over customers and products, aliases, shortcuts displayed.
- **Keyboard shortcuts** with a `?` help overlay.
- **Global search** in the topbar covering customers, orders (by number) and products.
- **Quick order flow** for mobile, per §6.6.

### Phase 7b — Robustness

- **`error.tsx` / `not-found.tsx` / `loading.tsx` per route segment**, refining the Phase 0 defaults. No unhandled server error should ever show a raw stack trace.
- **Empty states everywhere**, with the no-data vs no-results distinction enforced.
- **CSV export** for customers, orders and invoices.
- **Accessibility pass:** keyboard-navigate every flow with no mouse; focus visible and correctly trapped in sheets and dialogs; contrast checked; every icon-only button has an accessible name.
- **Mobile pass:** walk every screen at 375px. Fix anything requiring horizontal scrolling or with a target under 44px.

---

### Phase 8 — Verification

Do not declare done before all of this passes.

1. **Seed data** (`supabase/seed.sql`): 15 customers across every status, 6 products with recipes, 12 ingredients, 3 recurring schedules, ~60 orders over 6 months, 15 invoices in mixed states, ~40 interactions. Include deliberate edge cases: a customer with a custom price, a single-line order, a partially paid invoice, a lapsed customer, a voided invoice, a cancelled order, a customer with exactly two orders (must not be flagged at risk), and an archived product that a schedule still references.
   After seeding, reset the `orders.order_number` identity sequence.
2. **`supabase/verify.sql`** — SQL assertions run against the seeded database, each raising an exception on failure. At minimum: total revenue, current-month revenue, one customer's lifetime value, one week's bake list quantity, one invoice's balance, cancelled orders excluded from revenue, and the risk-flag guard cases. `psql -f verify.sql` must exit clean. This is the automated test suite; it needs no new dependencies and it guards the arithmetic, which is where the real risk is.
3. **Reconcile by hand once.** Compute the same figures in a spreadsheet and compare. **Any mismatch is a bug in the SQL, not a rounding quirk — find it.**
4. **Money precision audit.** Grep for `toFixed`, `parseFloat`, `Number(` on any monetary value outside `lib/format.ts`. There should be none. Confirm every money column is `numeric`, never `float8` or `real`.
5. **Idempotency test.** Run schedule generation five times. Order count unchanged.
6. **RLS test — tables, views AND functions.** With the app not running, hit `https://<project>.supabase.co/rest/v1/customers`, then `/rest/v1/v_customer_summary`, then `/rest/v1/rpc/f_bake_list`, with only the publishable key and no session. All must return no data. **Views are the likely failure here** — they bypass RLS unless created `with (security_invoker = on)`.
7. **Advisors.** Run Security Advisor and Performance Advisor. Resolve every finding or record why it is acceptable.
8. **Type check and build.** `tsc --noEmit` and `next build` clean; no `@ts-ignore`, no `any` in `lib/`.
9. **Cold-start walkthrough.** Reset to an empty database and complete the full journey without touching SQL: add customer → log interaction → add product → create order → generate bake list → mark delivered → invoice → record payment. Every step discoverable from the UI.
10. **The real test.** Sit the owner in front of it with no instructions and ask her to add a customer and log a call. Watch. Do not help. Every hesitation is a bug — write it down and fix it.

---

## 8. Working agreements for the coding agent

- **Ask before assuming** on business logic. If it is unclear whether a cancelled order should appear somewhere, ask — do not pick one and move on.
- **One phase per branch**, one PR per phase, descriptive commits.
- **Every schema change is a migration file.** Never change the schema through the remote Supabase dashboard — it bypasses migration history and permanently breaks `db push`. The local Studio is fine; capture with `supabase db diff -f <name>`.
- **Regenerate types after every migration.** `npm run db:types`. Stale types cause most of the confusing errors in this stack.
- **Every view is `with (security_invoker = on)` and revoked from `anon`.** No exceptions.
- **No `any`. No `@ts-ignore`.** If a type is hard, the model is probably wrong.
- **Do not add dependencies** not listed in §1 without saying why first.
- **Do not upgrade the pinned versions**, especially TanStack Table.
- **Prefer a SQL view or function over JavaScript aggregation.** If you find yourself summing an array of orders in TypeScript, stop and write a view.
- **Every Server Action re-validates its input.** Client-side Zod is a UX affordance, not a security boundary.
- **Every list needs both empty states** before the phase is complete.
- Run `tsc --noEmit` and `verify.sql` before declaring any phase done.

---

## Appendix A — `CLAUDE.md`

Place this at the repository root so the constraints survive context compaction.

```markdown
# Oat Bar CRM

Internal CRM for a home bakery. Two users, both see everything.
Full spec: ./docs/crm-build-plan.md — read it before non-trivial work.

## Stack (pinned — do not upgrade without asking)
Next.js 16.3 App Router · React 19 · TypeScript 5.9
Supabase (Postgres + Auth) via supabase-js — NO ORM
Tailwind 4 · shadcn/ui (RADIX base, `-b radix`) · sonner
TanStack Table v8.21 (NOT v9 — v9 breaks shadcn's guide)
React Hook Form 7 + Zod 4 · Recharts 3 · date-fns 4
No PDF library — invoices print from an HTML route.

## Framework non-negotiables
- `proxy.ts` (root), NOT `middleware.ts`. Next 16 renamed it.
- `await cookies()`, `await params`, `await searchParams` — all async.
- NEVER write during a Server Component render. Mutations = Server Actions.
- Supabase auth: `getClaims()` to protect routes. Never `getSession()`.
  No code between `createServerClient()` and `getClaims()`.
- Zod 4: `z.email()` not `z.string().email()`. Use `{ error: "..." }`,
  NOT `required_error`/`invalid_type_error` (removed).
- shadcn has no `<Form />` — use `<Field />` + `<Controller />`.

## Database non-negotiables
- EVERY view: `with (security_invoker = on)` + `revoke all from anon`.
  Views do NOT inherit RLS. This is the #1 way to leak the whole dataset.
- RLS on every table except signup_allowlist (which gets RLS + zero policies).
  Policy: `for all to authenticated using ((select exists (select 1 from
  profiles where id = (select auth.uid()))))`.
- Function params are `p_`-prefixed. `from`/`to` are reserved words.
- Money is `numeric(12,3)`. Never float. Format only via lib/format.ts.
- Never `current_date` — use `f_today()` (DB is UTC, business is UTC+3).
- order_items snapshots product_name, unit_price AND unit_cost.
  Never recompute a historical order.
- Prices resolve SERVER-SIDE via resolvePrice(). Ignore client-sent prices.
  resolvePrice throws on 0.
- Quantities are always in products.unit. units_per_box is display-only.
- day_of_week: 0 = Sunday (matches extract(dow)). Fortnightly parity
  anchors on starts_on.
- Invoice creation and voiding go through f_create_invoice / f_void_invoice.
  supabase-js cannot do multi-statement transactions.
- Voiding an invoice DELETES its invoice_orders rows (that's what releases
  the orders) and snapshots voided_total.
- Revenue/margin counts status in ('confirmed','in_production','delivered').
  Bake list counts the same three — `delivered` included deliberately.
- Schema changes are migration files only. Never edit the remote dashboard.
- Regenerate types after every migration: `npm run db:types`.
- Aggregate in SQL, not TypeScript.

## UX rules
- Side sheets for editing, not modals (users reference adjacent rows).
- Modals only for irreversible confirmation. Undo toast for reversible.
- Forms: single column, labels above, mode: 'onTouched', minimal required fields.
- Lists: URL-persisted state, client-side sort/filter/page, pagination not
  infinite scroll, two distinct empty states (no data vs no results).
- Mobile: 44px targets, inputMode per field, steppers for quantities,
  cards below md. Every screen must work at 375px.
- Optimistic UI only for reversible single-object mutations. Never for
  order creation, invoicing, or payments.

## Commands
npm run dev · npm run db:types · npm run db:reset · npm run db:new <name>
tsc --noEmit and psql -f supabase/verify.sql before declaring anything done.
```

---

## Appendix B — `package.json` scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:new": "supabase migration new",
    "db:reset": "supabase db reset",
    "db:diff": "supabase db diff -f",
    "db:push": "supabase db push",
    "db:types": "supabase gen types typescript --local > src/lib/database.types.ts",
    "db:verify": "psql \"$LOCAL_DB_URL\" -v ON_ERROR_STOP=1 -f supabase/verify.sql"
  }
}
```

## Appendix C — environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...        # server-only, admin scripts. NEVER NEXT_PUBLIC_.
```

Local values come from `supabase status`. Production values from the Supabase dashboard, set in Vercel project settings. `SUPABASE_SECRET_KEY` must never be imported into a client component — one bad import puts it in the browser bundle.

---

## Appendix D — a first prompt for Claude Code

> I'm building the CRM specified in `docs/crm-build-plan.md`. Read that file
> and `CLAUDE.md` in full before doing anything.
>
> Start with **Phase 0 only**. Do not begin Phase 1.
>
> Before you write code, tell me: the exact dependency versions you'll install,
> the SQL for migration 0001, and any point in the plan you think is wrong or
> underspecified. I'd rather resolve disagreements now than review them later.
>
> I have the GitHub and Supabase MCP connectors enabled — use them to create
> the repo and apply migrations rather than asking me to run commands, but
> show me each migration's SQL before applying it.
>
> Pay particular attention to the database non-negotiables in CLAUDE.md,
> especially `security_invoker = on` on every view.
