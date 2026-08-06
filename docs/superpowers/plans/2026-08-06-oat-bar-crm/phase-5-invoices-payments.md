# Phase 5 — Invoices and Payments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn delivered orders into numbered invoices, track partial payments, and print a clean invoice — with structural guarantees that an order can never be billed twice or billed to the wrong customer.

**Architecture:** Invoice creation and voiding are single `plpgsql` functions, because `supabase-js` cannot open a multi-statement transaction and the invoice number allocation is a lost-update race otherwise. Composite foreign keys make cross-customer invoicing impossible at the schema level. `overdue` and `paid` are **derived**, never stored. No PDF library — the invoice is a print-styled HTML route.

**Tech Stack:** Same as Phase 4. No new dependencies.

---

**Branch:** `git checkout main && git pull && git checkout -b phase-5-invoices`

**Depends on:** Phase 4 complete. Migration number is **`0007_invoices.sql`** (the spec says 0006; 0006 was taken by production).

---

## Task 5.1: Migration 0007 — invoices, payments, totals

**Files:**
- Create: `supabase/migrations/0007_invoices.sql`

- [ ] **Step 1: Write the tables and the totals view**

Create `supabase/migrations/0007_invoices.sql`:

```sql
-- 0007_invoices.sql
-- Invoices, the orders they cover, payments, and derived totals.

-- ────────────────────────────────────────────────────────────────────────
-- invoices
--
-- `overdue` is NOT a stored status. It is derived from
-- (status = 'sent' and due_on < f_today()). Storing it would need a cron
-- job to keep it true, and a stale flag on money is worse than no flag.
--
-- `paid` is in the check constraint for compatibility but is NEVER
-- written by this application — it is derived in v_invoice_totals from
-- the payments sum. The stored status only ever moves
-- draft -> sent -> void by explicit user action.
--
-- discount_amount and delivery_charge exist from day one because
-- retrofitting them later touches the totals view, the print template and
-- payment reconciliation all at once. They default to zero and the UI
-- hides them behind an "Add adjustment" affordance until used.
-- ────────────────────────────────────────────────────────────────────────
create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete restrict,
  invoice_number  text not null unique,
  status          text not null default 'draft'
                       check (status in ('draft','sent','paid','void')),
  issued_on       date not null default public.f_today(),
  due_on          date not null,
  discount_amount numeric(12,3) not null default 0 check (discount_amount >= 0),
  delivery_charge numeric(12,3) not null default 0 check (delivery_charge >= 0),
  -- Snapshotted at void time. Voiding deletes the invoice_orders rows, so
  -- without this the historical figure would vanish with them.
  voided_total    numeric(12,3),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Supports the composite FK from invoice_orders.
  unique (id, customer_id)
);

create index idx_invoices_customer on public.invoices (customer_id);
create index idx_invoices_status   on public.invoices (status);
create index idx_invoices_due_on   on public.invoices (due_on);

create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- invoice_orders
--
-- The composite foreign keys make it STRUCTURALLY IMPOSSIBLE to put café
-- A's order on café B's invoice — a bug that is otherwise silent and
-- extremely embarrassing. Phase 5's acceptance criteria require proving
-- this by attempting it directly in SQL.
--
-- unique (order_id) means one order can be on at most one invoice. It
-- cannot be made conditional on the invoice's status, because a partial
-- index predicate may only reference columns of its own table. So voiding
-- an invoice DELETES its invoice_orders rows — that deletion is what
-- releases the orders to be invoiced again.
-- ────────────────────────────────────────────────────────────────────────
create table public.invoice_orders (
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  order_id    uuid not null references public.orders(id)   on delete restrict,
  customer_id uuid not null,
  created_at  timestamptz not null default now(),

  primary key (invoice_id, order_id),
  unique (order_id),

  foreign key (order_id,   customer_id) references public.orders(id, customer_id),
  foreign key (invoice_id, customer_id) references public.invoices(id, customer_id)
);

create index idx_invoice_orders_invoice on public.invoice_orders (invoice_id);

-- ────────────────────────────────────────────────────────────────────────
-- payments — immutable, created_at only. Partial payments by design:
-- an invoice is paid when its payments SUM to its total.
-- ────────────────────────────────────────────────────────────────────────
create table public.payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  paid_on    date not null default public.f_today(),
  amount     numeric(12,3) not null check (amount > 0),
  method     text check (method in ('cash','bank_transfer','card','other')),
  reference  text,
  created_at timestamptz not null default now()
);

-- v_invoice_totals aggregates this for every row.
create index idx_payments_invoice on public.payments (invoice_id);

-- ────────────────────────────────────────────────────────────────────────
-- v_invoice_totals
--
-- Two levels because computed_status needs `total`, and a select list
-- cannot reference its own aliases.
--
-- The subtotal counts ('confirmed','in_production','delivered') only,
-- spelled out. A cancelled order sitting on an invoice must not be billed.
-- ────────────────────────────────────────────────────────────────────────
create view public.v_invoice_totals
with (security_invoker = on) as
select
  b.*,
  (b.total - b.amount_paid)::numeric(12,3) as balance,
  case
    when b.stored_status = 'void'  then 'void'
    when b.stored_status = 'draft' then 'draft'
    when b.total > 0 and b.amount_paid >= b.total then 'paid'
    when b.due_on < public.f_today() then 'overdue'
    else 'sent'
  end as computed_status
from (
  select
    i.id                                as invoice_id,
    i.customer_id,
    i.invoice_number,
    i.status                            as stored_status,
    i.issued_on,
    i.due_on,
    i.discount_amount,
    i.delivery_charge,
    i.voided_total,
    i.notes,
    coalesce(agg.subtotal, 0)::numeric(12,3)   as subtotal,
    coalesce(agg.order_count, 0)               as order_count,
    case
      when i.status = 'void' then coalesce(i.voided_total, 0)
      else greatest(
        coalesce(agg.subtotal, 0) + i.delivery_charge - i.discount_amount,
        0
      )
    end::numeric(12,3)                         as total,
    coalesce(pay.amount_paid, 0)::numeric(12,3) as amount_paid
  from public.invoices i
  left join lateral (
    select
      sum(t.subtotal) as subtotal,
      count(*)        as order_count
    from public.invoice_orders io
    join public.v_order_totals t on t.order_id = io.order_id
    where io.invoice_id = i.id
      and t.status in ('confirmed','in_production','delivered')
  ) agg on true
  left join lateral (
    select sum(p.amount) as amount_paid
    from public.payments p
    where p.invoice_id = i.id
  ) pay on true
) b;

revoke all on public.v_invoice_totals from anon;

create view public.v_invoice_list
with (security_invoker = on) as
select t.*, c.name as customer_name
from public.v_invoice_totals t
join public.customers c on c.id = t.customer_id;

revoke all on public.v_invoice_list from anon;

-- Orders that can still be invoiced: delivered, not cancelled, not
-- already on an invoice.
create view public.v_uninvoiced_orders
with (security_invoker = on) as
select t.*, c.name as customer_name
from public.v_order_totals t
join public.customers c on c.id = t.customer_id
where t.status in ('confirmed','in_production','delivered')
  and not exists (
    select 1 from public.invoice_orders io where io.order_id = t.order_id
  );

revoke all on public.v_uninvoiced_orders from anon;

-- ────────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────────
alter table public.invoices       enable row level security;
alter table public.invoice_orders enable row level security;
alter table public.payments       enable row level security;

create policy "app users have full access" on public.invoices
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));

create policy "app users have full access" on public.invoice_orders
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));

create policy "app users have full access" on public.payments
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));
```

- [ ] **Step 2: Add the two functions to the same migration**

Append to `supabase/migrations/0007_invoices.sql`:

```sql
-- ────────────────────────────────────────────────────────────────────────
-- f_create_invoice
--
-- supabase-js cannot open a multi-statement transaction (spec §2), and a
-- read-then-increment of next_invoice_number from a Server Action is a
-- lost-update race that produces duplicate invoice numbers. That is the
-- entire reason this function exists.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_create_invoice(
  p_customer_id uuid,
  p_order_ids   uuid[],
  p_issued_on   date,
  p_due_on      date
)
returns uuid
language plpgsql
as $$
declare
  v_num        int;
  v_prefix     text;
  v_invoice_id uuid;
  v_bad        int;
begin
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'An invoice must cover at least one order';
  end if;

  if p_due_on < p_issued_on then
    raise exception 'The due date cannot be before the issue date';
  end if;

  -- Belt and braces ahead of the composite FK, so the error message is
  -- readable rather than a constraint name.
  select count(*) into v_bad
  from unnest(p_order_ids) as t(oid)
  left join public.orders o on o.id = t.oid
  where o.id is null
     or o.customer_id <> p_customer_id
     or o.status = 'cancelled';

  if v_bad > 0 then
    raise exception 'One or more orders are missing, cancelled, or belong to a different customer';
  end if;

  -- A SINGLE atomic statement. The row lock taken by UPDATE serialises
  -- concurrent callers; RETURNING gives back the post-increment value, so
  -- the number this invoice gets is next_invoice_number - 1.
  update public.app_settings
     set next_invoice_number = next_invoice_number + 1
   where id = 1
  returning next_invoice_number - 1, invoice_prefix
       into v_num, v_prefix;

  if v_num is null then
    raise exception 'app_settings row 1 is missing; cannot allocate an invoice number';
  end if;

  insert into public.invoices (customer_id, invoice_number, status, issued_on, due_on)
  values (
    p_customer_id,
    v_prefix || lpad(v_num::text, 4, '0'),
    'draft',
    p_issued_on,
    p_due_on
  )
  returning id into v_invoice_id;

  insert into public.invoice_orders (invoice_id, order_id, customer_id)
  select v_invoice_id, t.oid, p_customer_id
  from unnest(p_order_ids) as t(oid);

  return v_invoice_id;
end;
$$;

revoke execute on function public.f_create_invoice(uuid, uuid[], date, date) from public, anon;
grant  execute on function public.f_create_invoice(uuid, uuid[], date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- f_void_invoice — void, never delete.
-- Order matters: snapshot the total BEFORE deleting the join rows, or the
-- snapshot is zero.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_void_invoice(p_invoice_id uuid)
returns void
language plpgsql
as $$
declare
  v_total  numeric(12,3);
  v_status text;
begin
  select stored_status, total into v_status, v_total
  from public.v_invoice_totals
  where invoice_id = p_invoice_id;

  if v_status is null then
    raise exception 'Invoice % does not exist', p_invoice_id;
  end if;

  if v_status = 'void' then
    return;   -- idempotent
  end if;

  update public.invoices
     set status = 'void',
         voided_total = coalesce(v_total, 0)
   where id = p_invoice_id;

  -- THIS is what releases the orders to be invoiced again.
  delete from public.invoice_orders where invoice_id = p_invoice_id;
end;
$$;

revoke execute on function public.f_void_invoice(uuid) from public, anon;
grant  execute on function public.f_void_invoice(uuid) to authenticated;
```

- [ ] **Step 3: Show the SQL to the user, then apply** — MCP `apply_migration`, `name: "0007_invoices"`.

- [ ] **Step 4: Prove the composite FK rejects a cross-customer invoice**

This is a Phase 5 acceptance criterion and it must be tested **directly in SQL**, not through the UI.

```sql
begin;
  insert into public.customers (name) values ('Café A') returning id \gset a_
  insert into public.customers (name) values ('Café B') returning id \gset b_
  insert into public.products (name, wholesale_price, unit_cost)
    values ('FK Bar', 0.500, 0.250) returning id \gset p_

  insert into public.orders (customer_id, delivery_date)
    values (:'a_id', public.f_today()) returning id \gset o_
  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
    values (:'o_id', :'p_id', 'FK Bar', 10, 0.500, 0.250);

  -- An invoice for café B.
  select public.f_create_invoice(:'b_id', array[]::uuid[], public.f_today(), public.f_today() + 14);
  -- ^ expected to RAISE "must cover at least one order". Good.

  insert into public.invoices (customer_id, invoice_number, due_on)
    values (:'b_id', 'TEST-9999', public.f_today() + 14) returning id \gset i_

  -- Now try to attach café A's order to café B's invoice, by hand.
  insert into public.invoice_orders (invoice_id, order_id, customer_id)
    values (:'i_id', :'o_id', :'b_id');
rollback;
```

Expected: the final INSERT **fails** with a foreign-key violation on `invoice_orders_order_id_customer_id_fkey`. **If it succeeds, the composite FK is wrong — stop and fix it.**

Try the other cheat too, in a fresh transaction: `values (:'i_id', :'o_id', :'a_id')`. Expected: fails on `invoice_orders_invoice_id_customer_id_fkey`. Both doors must be shut.

- [ ] **Step 5: Prove one order cannot reach two live invoices**

```sql
begin;
  insert into public.customers (name) values ('Double Bill Café') returning id \gset c_
  insert into public.products (name, wholesale_price, unit_cost) values ('DB Bar', 0.500, 0.250) returning id \gset p_
  insert into public.orders (customer_id, delivery_date) values (:'c_id', public.f_today()) returning id \gset o_
  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
    values (:'o_id', :'p_id', 'DB Bar', 10, 0.500, 0.250);

  select public.f_create_invoice(:'c_id', array[:'o_id']::uuid[], public.f_today(), public.f_today()+14) as first;
  select public.f_create_invoice(:'c_id', array[:'o_id']::uuid[], public.f_today(), public.f_today()+14) as second;
rollback;
```

Expected: the second call **fails** on `invoice_orders_order_id_key`. ✅

- [ ] **Step 6: Prove voiding releases the order and freezes the total**

```sql
begin;
  insert into public.customers (name) values ('Void Café') returning id \gset c_
  insert into public.products (name, wholesale_price, unit_cost) values ('V Bar', 0.500, 0.250) returning id \gset p_
  insert into public.orders (customer_id, delivery_date) values (:'c_id', public.f_today()) returning id \gset o_
  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
    values (:'o_id', :'p_id', 'V Bar', 40, 0.500, 0.250);

  select public.f_create_invoice(:'c_id', array[:'o_id']::uuid[], public.f_today(), public.f_today()+14) \gset inv_
  select invoice_number, total, computed_status from public.v_invoice_totals where invoice_id = :'inv_f_create_invoice';

  select public.f_void_invoice(:'inv_f_create_invoice');
  select invoice_number, total, voided_total, computed_status from public.v_invoice_totals where invoice_id = :'inv_f_create_invoice';

  -- The order is free again.
  select count(*) as still_invoiceable from public.v_uninvoiced_orders where order_id = :'o_id';

  -- And can be re-invoiced.
  select public.f_create_invoice(:'c_id', array[:'o_id']::uuid[], public.f_today(), public.f_today()+14);
rollback;
```

Expected: total is `20.000` before voiding; after voiding, `computed_status` is `void`, `voided_total` is `20.000`, `total` is still `20.000`, `still_invoiceable` is `1`, and the re-invoice succeeds with a **new, higher** number. ✅

- [ ] **Step 7: Prove the invoice number is allocated atomically**

```sql
select next_invoice_number from public.app_settings where id = 1;
-- run f_create_invoice three times against three different orders
select invoice_number from public.invoices order by created_at desc limit 3;
select next_invoice_number from public.app_settings where id = 1;
```

Expected: three consecutive numbers, and `next_invoice_number` advanced by exactly 3. ✅

- [ ] **Step 8: Regenerate types** → MCP `generate_typescript_types`, then `npm run typecheck` → clean.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0007_invoices.sql src/lib/database.types.ts
git commit -m "feat(db): migration 0007 — invoices with composite FKs, payments, atomic numbering, void"
```

---

## Task 5.2: Invoice verification assertions

**Files:**
- Modify: `supabase/verify.sql`

- [ ] **Step 1: Append the Phase 5 block**

```sql
-- ── Phase 5 ─────────────────────────────────────────────────────────────

-- P5.1: an invoice's subtotal must equal the sum of its covered orders.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.v_invoice_totals t
  where t.stored_status <> 'void'
    and t.subtotal <> coalesce((
      select sum(ot.subtotal)
      from public.invoice_orders io
      join public.v_order_totals ot on ot.order_id = io.order_id
      where io.invoice_id = t.invoice_id
        and ot.status in ('confirmed','in_production','delivered')
    ), 0);
  if v_bad > 0 then
    raise exception 'P5.1 FAIL: % invoice(s) have a subtotal that does not match their orders', v_bad;
  end if;
end $$;

-- P5.2: total = subtotal + delivery_charge - discount, never negative.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.v_invoice_totals
  where stored_status <> 'void'
    and total <> greatest(subtotal + delivery_charge - discount_amount, 0);
  if v_bad > 0 then
    raise exception 'P5.2 FAIL: % invoice total(s) do not equal subtotal + delivery - discount', v_bad;
  end if;
end $$;

-- P5.3: no order may appear on more than one live invoice. The unique
-- constraint enforces it; this catches a future migration relaxing it.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from (
    select order_id from public.invoice_orders group by order_id having count(*) > 1
  ) t;
  if v_bad > 0 then
    raise exception 'P5.3 FAIL: % order(s) appear on more than one invoice', v_bad;
  end if;
end $$;

-- P5.4: no invoice may cover an order belonging to a different customer.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.invoice_orders io
  join public.orders   o on o.id = io.order_id
  join public.invoices i on i.id = io.invoice_id
  where o.customer_id <> i.customer_id;
  if v_bad > 0 then
    raise exception 'P5.4 FAIL: % invoice line(s) cross customers', v_bad;
  end if;
end $$;

-- P5.5: a partially paid invoice must NOT read as paid.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.v_invoice_totals
  where computed_status = 'paid' and amount_paid < total;
  if v_bad > 0 then
    raise exception 'P5.5 FAIL: % partially paid invoice(s) read as paid', v_bad;
  end if;
end $$;

-- P5.6: invoice numbers are unique, and next_invoice_number is ahead of
-- every allocated number. Gaps from voided invoices are expected.
do $$
declare v_dupes int; v_next int; v_max int;
begin
  select count(*) into v_dupes from (
    select invoice_number from public.invoices group by invoice_number having count(*) > 1
  ) t;
  if v_dupes > 0 then
    raise exception 'P5.6 FAIL: % duplicate invoice number(s)', v_dupes;
  end if;

  select next_invoice_number into v_next from public.app_settings where id = 1;
  select coalesce(max(nullif(regexp_replace(invoice_number, '\D', '', 'g'), '')::int), 0)
    into v_max from public.invoices;

  if v_max >= v_next then
    raise exception 'P5.6 FAIL: next_invoice_number (%) is not ahead of the highest allocated (%)', v_next, v_max;
  end if;
end $$;

-- P5.7: a voided invoice keeps its number and its frozen total.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.invoices
  where status = 'void' and (voided_total is null or invoice_number is null);
  if v_bad > 0 then
    raise exception 'P5.7 FAIL: % voided invoice(s) lost their number or total', v_bad;
  end if;
end $$;
```

- [ ] **Step 2: Run it** via MCP `execute_sql` → no exception.

- [ ] **Step 3: Commit**

```bash
git add supabase/verify.sql
git commit -m "test(db): invoice totals, uniqueness, cross-customer and partial-payment assertions"
```

---

## Task 5.3: Invoice schemas, queries and actions

**Files:**
- Create: `src/lib/schemas/invoices.ts`
- Create: `src/lib/schemas/invoices.test.ts`
- Create: `src/lib/queries/invoices.ts`
- Create: `src/lib/actions/invoices.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schemas/invoices.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createInvoiceSchema, paymentSchema, adjustmentSchema } from '@/lib/schemas/invoices'

const CUST = '11111111-1111-4111-8111-111111111111'
const ORD1 = '22222222-2222-4222-8222-222222222222'
const ORD2 = '33333333-3333-4333-8333-333333333333'
const INV  = '44444444-4444-4444-8444-444444444444'

describe('createInvoiceSchema', () => {
  const valid = {
    customer_id: CUST,
    order_ids: [ORD1, ORD2],
    issued_on: '2026-08-06',
    due_on: '2026-08-20',
  }

  it('accepts a valid invoice request', () => {
    expect(createInvoiceSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invoice with no orders', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, order_ids: [] }).success).toBe(false)
  })

  it('rejects the same order twice', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, order_ids: [ORD1, ORD1] }).success).toBe(false)
  })

  it('rejects a due date before the issue date', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, due_on: '2026-08-05' }).success).toBe(false)
  })

  it('allows a due date equal to the issue date', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, due_on: '2026-08-06' }).success).toBe(true)
  })
})

describe('paymentSchema', () => {
  const valid = { invoice_id: INV, amount: 20, paid_on: '2026-08-06', method: 'cash', reference: '' }

  it('accepts a valid payment', () => {
    expect(paymentSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a zero or negative amount', () => {
    expect(paymentSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false)
    expect(paymentSchema.safeParse({ ...valid, amount: -5 }).success).toBe(false)
  })

  it('allows a partial amount — partial payments are supported by design', () => {
    expect(paymentSchema.safeParse({ ...valid, amount: 0.001 }).success).toBe(true)
  })

  it('rejects a method outside the enum', () => {
    expect(paymentSchema.safeParse({ ...valid, method: 'bitcoin' }).success).toBe(false)
  })

  it('turns a blank method and reference into null', () => {
    const r = paymentSchema.parse({ ...valid, method: '', reference: '  ' })
    expect(r.method).toBeNull()
    expect(r.reference).toBeNull()
  })
})

describe('adjustmentSchema', () => {
  it('rejects a negative discount or delivery charge', () => {
    expect(adjustmentSchema.safeParse({ id: INV, discount_amount: -1, delivery_charge: 0 }).success).toBe(false)
    expect(adjustmentSchema.safeParse({ id: INV, discount_amount: 0, delivery_charge: -1 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run and watch it fail** → `npm test` → FAIL.

- [ ] **Step 3: Write the schemas**

Create `src/lib/schemas/invoices.ts`:

```ts
import * as z from 'zod'
import { optionalText } from '@/lib/schemas/settings'

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'other'] as const
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank transfer', card: 'Card', other: 'Other',
}

export const INVOICE_STATUSES = ['draft', 'sent', 'overdue', 'paid', 'void'] as const
export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', overdue: 'Overdue', paid: 'Paid', void: 'Void',
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Pick a date' })

const money = z.coerce
  .number({ error: 'Enter an amount' })
  .min(0, { error: 'Cannot be negative' })
  .multipleOf(0.001, { error: 'At most three decimal places' })

export const createInvoiceSchema = z
  .object({
    customer_id: z.uuid({ error: 'Pick a customer' }),
    order_ids: z
      .array(z.uuid())
      .min(1, { error: 'Select at least one order' })
      .refine((ids) => new Set(ids).size === ids.length, {
        error: 'The same order is selected twice',
      }),
    issued_on: isoDate,
    due_on: isoDate,
  })
  .refine((v) => v.due_on >= v.issued_on, {
    error: 'The due date cannot be before the issue date',
    path: ['due_on'],
  })

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>

export const paymentSchema = z.object({
  invoice_id: z.uuid(),
  amount: money.refine((v) => v > 0, { error: 'Enter an amount above zero' }),
  paid_on: isoDate,
  method: z
    .string()
    .transform((v) => (v.trim().length > 0 ? v.trim() : null))
    .nullable()
    .refine((v) => v === null || (PAYMENT_METHODS as readonly string[]).includes(v), {
      error: 'Pick a payment method',
    }),
  reference: optionalText,
})

export type PaymentInput = z.input<typeof paymentSchema>
export type PaymentOutput = z.output<typeof paymentSchema>

export const adjustmentSchema = z.object({
  id: z.uuid(),
  discount_amount: money,
  delivery_charge: money,
})
```

- [ ] **Step 4: Run and watch it pass** → `npm test` → PASS.

- [ ] **Step 5: The queries**

Create `src/lib/queries/invoices.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type InvoiceListRow = Tables<'v_invoice_list'>
export type InvoiceTotals = Tables<'v_invoice_totals'>
export type UninvoicedOrder = Tables<'v_uninvoiced_orders'>
export type Payment = Tables<'payments'>

export async function listInvoices(): Promise<InvoiceListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_invoice_list')
    .select('*')
    .order('issued_on', { ascending: false })

  if (error) throw new Error(`Could not load invoices: ${error.message}`)
  return data ?? []
}

export async function getInvoiceTotals(id: string): Promise<InvoiceTotals | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_invoice_totals').select('*').eq('invoice_id', id).maybeSingle()
  if (error) throw new Error(`Could not load the invoice: ${error.message}`)
  return data
}

export type InvoiceDetail = {
  invoice: Tables<'invoices'>
  customer: Tables<'customers'>
  totals: InvoiceTotals
  orders: (Tables<'orders'> & { order_items: Tables<'order_items'>[] })[]
  payments: Payment[]
}

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const supabase = await createClient()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, customers ( * )')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Could not load the invoice: ${error.message}`)
  if (!invoice) return null

  const [totals, { data: joins }, { data: payments }] = await Promise.all([
    getInvoiceTotals(id),
    supabase
      .from('invoice_orders')
      .select('orders ( *, order_items ( * ) )')
      .eq('invoice_id', id),
    supabase
      .from('payments')
      .select('*')
      .eq('invoice_id', id)
      .order('paid_on', { ascending: true }),
  ])

  const { customers, ...rest } = invoice as typeof invoice & {
    customers: Tables<'customers'>
  }

  return {
    invoice: rest as Tables<'invoices'>,
    customer: customers,
    totals: totals!,
    orders: (joins ?? [])
      .map((j) => j.orders)
      .filter(Boolean)
      .sort((a, b) => a!.delivery_date.localeCompare(b!.delivery_date)) as InvoiceDetail['orders'],
    payments: payments ?? [],
  }
}

export async function listUninvoicedOrders(
  customerId: string,
): Promise<UninvoicedOrder[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_uninvoiced_orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('delivery_date', { ascending: true })

  if (error) throw new Error(`Could not load uninvoiced orders: ${error.message}`)
  return data ?? []
}

/** Customers who have anything left to bill. Powers the create-invoice picker. */
export async function listCustomersWithUninvoicedOrders() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_uninvoiced_orders')
    .select('customer_id, customer_name, subtotal')

  if (error) throw new Error(`Could not load customers: ${error.message}`)

  const map = new Map<string, { id: string; name: string; count: number; value: number }>()
  for (const row of data ?? []) {
    const existing = map.get(row.customer_id!) ?? {
      id: row.customer_id!, name: row.customer_name ?? 'Unknown', count: 0, value: 0,
    }
    existing.count += 1
    existing.value += Number(row.subtotal ?? 0)
    map.set(row.customer_id!, existing)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}
```

- [ ] **Step 6: The actions**

Create `src/lib/actions/invoices.ts`:

```ts
'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  createInvoiceSchema, paymentSchema, adjustmentSchema,
} from '@/lib/schemas/invoices'
import type { ActionResult } from '@/lib/actions/auth'

function revalidateInvoiceSurfaces(id?: string) {
  revalidatePath('/invoices')
  revalidatePath('/orders')
  revalidatePath('/')
  if (id) revalidatePath(`/invoices/${id}`)
}

export async function createInvoice(
  raw: unknown,
): Promise<ActionResult & { id?: string }> {
  const parsed = createInvoiceSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the invoice below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()

  // One function call. Number allocation and both inserts happen inside a
  // single transaction, which supabase-js cannot open itself. Spec §2.
  const { data, error } = await supabase.rpc('f_create_invoice', {
    p_customer_id: parsed.data.customer_id,
    p_order_ids: parsed.data.order_ids,
    p_issued_on: parsed.data.issued_on,
    p_due_on: parsed.data.due_on,
  })

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'One of those orders is already on another invoice. Reload and try again.' }
    }
    return { ok: false, error: error.message }
  }

  revalidateInvoiceSurfaces(data as string)
  return { ok: true, id: data as string }
}

export async function markInvoiceSent(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('invoices').update({ status: 'sent' }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateInvoiceSurfaces(id)
  return { ok: true }
}

export async function recordPayment(raw: unknown): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the payment below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('payments').insert(parsed.data)
  if (error) return { ok: false, error: error.message }

  // `paid` is NOT written here. v_invoice_totals derives it from the
  // payments sum, so a partial payment correctly leaves the invoice `sent`
  // and a later top-up flips it to `paid` with no extra bookkeeping.
  revalidateInvoiceSurfaces(parsed.data.invoice_id)
  return { ok: true }
}

export async function deletePayment(
  id: string,
  invoiceId: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('payments').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateInvoiceSurfaces(invoiceId)
  return { ok: true }
}

export async function setInvoiceAdjustment(raw: unknown): Promise<ActionResult> {
  const parsed = adjustmentSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Enter valid amounts.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('invoices')
    .update({
      discount_amount: parsed.data.discount_amount,
      delivery_charge: parsed.data.delivery_charge,
    })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }
  revalidateInvoiceSurfaces(parsed.data.id)
  return { ok: true }
}

/** Irreversible → the UI must confirm with a real modal. Spec §6.4. */
export async function voidInvoice(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('f_void_invoice', { p_invoice_id: id })
  if (error) return { ok: false, error: error.message }
  revalidateInvoiceSurfaces(id)
  return { ok: true }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/schemas/invoices.ts src/lib/schemas/invoices.test.ts src/lib/queries/invoices.ts src/lib/actions/invoices.ts
git commit -m "feat(invoices): schemas, queries and actions; creation and voiding via SQL functions"
```

---

## Task 5.4: Invoice list

**Files:**
- Create: `src/app/(app)/invoices/page.tsx`
- Create: `src/app/(app)/invoices/invoices-table.tsx`
- Create: `src/components/app/invoice-status-badge.tsx`

- [ ] **Step 1: The badge**

Create `src/components/app/invoice-status-badge.tsx`, following the **Task 1.5 `StatusBadge` pattern** (leading dot, always-present label). Complete delta — it takes `computed_status`, never the stored one:

```tsx
const TONE: Record<string, string> = {
  draft:   'bg-muted text-muted-foreground',
  sent:    'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  overdue: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  paid:    'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  void:    'bg-muted text-muted-foreground line-through',
}
```

Labels come from `INVOICE_STATUS_LABELS`. The `line-through` on `void` is the shape cue — it reads as voided even in greyscale.

- [ ] **Step 2: The list**

Create `src/app/(app)/invoices/page.tsx` fetching `listInvoices()`, with a "New invoice" button to `/invoices/new`.

Create `src/app/(app)/invoices/invoices-table.tsx` using the **Task 1.4 data table pattern**. Complete delta:

- **Data:** `InvoiceListRow[]`
- **Default filter: unpaid.** When `?status` is absent, filter to `computed_status !== 'paid' && computed_status !== 'void'`. The status chips are `Unpaid` (the default), `Draft`, `Sent`, `Overdue`, `Paid`, `Void`, `All`, writing `?status=`
- **Search:** `q` on `customer_name` and `invoice_number`
- **Columns:**
  1. `invoice_number` — "Invoice #", `tabular-nums font-medium`
  2. `customer_name` — "Customer"
  3. `issued_on` — "Issued", `<DateDisplay />`
  4. `due_on` — "Due", `<DateDisplay />`; when `computed_status === 'overdue'`, wrap in `<span className="font-medium text-destructive">`
  5. `total` — "Total", `meta: { align: 'right' }`, `<Money />`
  6. `amount_paid` — "Paid", `meta: { align: 'right' }`, `<Money />`
  7. `balance` — "Balance", `meta: { align: 'right' }`, `<Money />`, bold when non-zero
  8. `computed_status` — "Status", `<InvoiceStatusBadge status={...} />`
- **Row click:** `router.push('/invoices/' + row.invoice_id)`
- **Initial sorting:** `[{ id: 'due_on', desc: false }]` — the soonest-due first is what she needs
- **Summary strip** above the table: total outstanding (`Σ balance` over non-void, non-paid) and total overdue (`Σ balance` where `computed_status === 'overdue'`), each with a count. Both through `<Money />`
- **Mobile card:** `{invoice_number} · {customer_name}`; `Due {DateDisplay}` and `<Money value={balance} />`; status badge right-aligned
- **`emptyState`:** `<NoDataYet icon={<FileText className="size-10" />} title="No invoices yet" description="Once you've delivered some orders you can bill them here — several orders can go on one invoice." action={<Button asChild className="h-11"><Link href="/invoices/new">Create the first invoice</Link></Button>} />` / `<NoResults ... />`

- [ ] **Step 3: Verify**

1. `/invoices` defaults to unpaid; paid invoices are hidden until you press "Paid" or "All". ✅
2. An overdue invoice's due date is red and its badge reads Overdue — **with no cron job having run**. ✅
3. The outstanding and overdue totals match a hand sum. ✅

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/invoices/page.tsx" "src/app/(app)/invoices/invoices-table.tsx" src/components/app/invoice-status-badge.tsx
git commit -m "feat(invoices): list with derived status, unpaid default and outstanding summary"
```

---

## Task 5.5: Create invoice

**Files:**
- Create: `src/app/(app)/invoices/new/page.tsx`
- Create: `src/components/app/invoice-builder.tsx`

- [ ] **Step 1: The page**

Create `src/app/(app)/invoices/new/page.tsx`:

```tsx
import { listCustomersWithUninvoicedOrders } from '@/lib/queries/invoices'
import { getSettings } from '@/lib/queries/settings'
import { InvoiceBuilder } from '@/components/app/invoice-builder'

export default async function NewInvoicePage() {
  const [customers, settings] = await Promise.all([
    listCustomersWithUninvoicedOrders(),
    getSettings(),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New invoice</h1>
      <InvoiceBuilder
        customers={customers}
        defaultTermsDays={settings.default_payment_terms_days}
      />
    </div>
  )
}
```

- [ ] **Step 2: A server action to fetch a customer's billable orders**

Append to `src/lib/actions/invoices.ts`:

```ts
import { listUninvoicedOrders } from '@/lib/queries/invoices'

export async function fetchUninvoicedOrders(customerId: string) {
  const rows = await listUninvoicedOrders(customerId)
  return rows.map((r) => ({
    order_id: r.order_id!,
    order_number: r.order_number!,
    delivery_date: r.delivery_date!,
    status: r.status!,
    subtotal: Number(r.subtotal ?? 0),
    total_units: Number(r.total_units ?? 0),
  }))
}
```

- [ ] **Step 3: The builder**

Create `src/components/app/invoice-builder.tsx`. A `'use client'` component with this exact behaviour:

- **State:** `customerId`, `orders` (fetched), `selected: Set<string>`, `issuedOn` (defaults to today), `dueOn`, `showAdjustment`, `submitting`, `error`
- **Customer step:** a list of `customers` as cards — name, `{count} uninvoiced orders`, `<Money value={value} />`. Clicking one sets `customerId` and calls `fetchUninvoicedOrders` in a transition. If `customers.length === 0`, render `<NoDataYet title="Nothing to invoice" description="Every delivered order is already on an invoice. Record some orders first." />`
- **Order step:** every returned order as a checkbox row — `#{order_number}`, `<DateDisplay value={delivery_date} />`, `<OrderStatusBadge />`, `{total_units} units`, `<Money value={subtotal} />` right-aligned with `tabular-nums`. A "Select all" checkbox at the top. Rows are selected by default (she is usually billing everything outstanding)
- **Dates:** `issued_on` and `due_on` as `<input type="date">`. When `issuedOn` changes, recompute `dueOn = format(addDays(parseISO(issuedOn), defaultTermsDays), 'yyyy-MM-dd')` **unless the user has already edited `dueOn` by hand** — track that with a `dueTouched` boolean
- **Adjustment:** hidden behind a `<Button variant="link">Add a discount or delivery charge</Button>`. When shown, two `inputMode="decimal"` fields. These are applied **after** creation via `setInvoiceAdjustment`, because `f_create_invoice` does not take them — chain the two calls and report a failure of the second as *"Invoice created, but the adjustment did not save. Set it on the invoice page."*
- **Running total:** `Σ subtotal of selected + deliveryCharge − discount`, through `<Money />`, in a sticky bottom bar with the Create button. Clamp the display at zero to match the SQL's `greatest(..., 0)`
- **Submit:** calls `createInvoice({ customer_id, order_ids: [...selected], issued_on, due_on })`. **Not optimistic** — server-generated identity and a money consequence, spec §6.4. On success, toast and `router.push('/invoices/' + id)`
- **Guards:** the Create button is disabled when `selected.size === 0`; the error is rendered in a `role="alert"` paragraph as well as a toast

- [ ] **Step 4: Verify — Phase 5 acceptance criteria**

1. Pick a customer with three uninvoiced orders. All three are pre-selected. The total equals the sum of the three by hand. ✅
2. Add a delivery charge of `2.000` and a discount of `1.000`. The total moves by exactly `+1.000`. ✅
3. Create it. The invoice detail shows all three orders and the same total. ✅ *(spec: "An invoice covering three orders totals the sum of those orders, plus delivery charge, minus discount")*
4. Go back to `/invoices/new`, pick the same customer → **those three orders are gone from the list.** ✅ *(spec: "An order cannot appear on two active invoices")*
5. The due date defaults to issue date + the settings terms; editing it by hand and then changing the issue date does **not** overwrite your edit. ✅

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/invoices/new" src/components/app/invoice-builder.tsx src/lib/actions/invoices.ts
git commit -m "feat(invoices): create-invoice builder with order selection and adjustments"
```

---

## Task 5.6: Invoice detail, payments and voiding

**Files:**
- Create: `src/app/(app)/invoices/[id]/page.tsx`
- Create: `src/app/(app)/invoices/[id]/invoice-actions.tsx`
- Create: `src/components/app/payment-form.tsx`

- [ ] **Step 1: The page**

Create `src/app/(app)/invoices/[id]/page.tsx`. A Server Component that awaits `params`, calls `getInvoiceDetail(id)`, `notFound()` if missing, and renders:

- **Header:** `Invoice {invoice_number}`, `<InvoiceStatusBadge status={totals.computed_status} />`, the customer name linking to their page, issued and due dates via `<DateDisplay />`, and `<InvoiceActions />`
- **Covered orders:** one card per order — `#{order_number}`, delivery date, then its `order_items` as `{quantity} × {product_name}` with `<Money value={line_total} />`. **Use `product_name` from `order_items`, the snapshot** — an invoice is a historical document and must reprint identically forever
- **Totals block:** Subtotal, Delivery charge (only if non-zero), Discount (only if non-zero, shown as a negative), **Total**, Paid, **Balance**. All through `<Money />`, right-aligned, `tabular-nums`
- **Payment history:** each payment's date, `PAYMENT_METHOD_LABELS[method]`, reference, amount, and a delete button. When empty: *"No payments recorded yet."*
- **Void notice:** when `computed_status === 'void'`, a prominent banner: *"This invoice was voided. Its orders were released and can be invoiced again. The number and total are kept for the record."*

- [ ] **Step 2: The actions bar**

Create `src/app/(app)/invoices/[id]/invoice-actions.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Printer, Send, Ban, Plus } from 'lucide-react'
import { markInvoiceSent, voidInvoice } from '@/lib/actions/invoices'
import { PaymentForm } from '@/components/app/payment-form'
import { RecordSheet } from '@/components/app/record-sheet'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  computedStatus,
  balance,
}: {
  invoiceId: string
  invoiceNumber: string
  computedStatus: string
  balance: number
}) {
  const router = useRouter()
  const [paying, setPaying] = useState(false)

  const isVoid = computedStatus === 'void'

  return (
    <div className="flex flex-wrap gap-2">
      {!isVoid && computedStatus === 'draft' ? (
        <Button
          className="h-11"
          onClick={async () => {
            const result = await markInvoiceSent(invoiceId)
            if (!result.ok) { toast.error(result.error); return }
            toast.success('Marked as sent')
            router.refresh()
          }}
        >
          <Send className="size-4" aria-hidden /> Mark sent
        </Button>
      ) : null}

      {!isVoid && balance > 0 ? (
        <Button variant="outline" className="h-11" onClick={() => setPaying(true)}>
          <Plus className="size-4" aria-hidden /> Record payment
        </Button>
      ) : null}

      <Button asChild variant="outline" className="h-11">
        <Link href={`/invoices/${invoiceId}/print`} target="_blank">
          <Printer className="size-4" aria-hidden /> Print
        </Link>
      </Button>

      {!isVoid ? (
        // Voiding is IRREVERSIBLE, so it gets a real modal confirmation.
        // Everywhere else in this app, reversible actions get an Undo
        // toast instead. Spec §6.4.
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="h-11 text-destructive">
              <Ban className="size-4" aria-hidden /> Void
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Void invoice {invoiceNumber}?</AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone. The invoice keeps its number and total
                for the record, and the orders it covers are released so you
                can invoice them again. Any payments recorded against it stay
                attached to the voided invoice.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11">Keep it</AlertDialogCancel>
              <AlertDialogAction
                className="h-11"
                onClick={async () => {
                  const result = await voidInvoice(invoiceId)
                  if (!result.ok) { toast.error(result.error); return }
                  toast.success(`${invoiceNumber} voided`)
                  router.refresh()
                }}
              >
                Void it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      <RecordSheet open={paying} onOpenChange={setPaying} title="Record a payment">
        <PaymentForm
          invoiceId={invoiceId}
          defaultAmount={balance}
          onDone={() => { setPaying(false); router.refresh() }}
        />
      </RecordSheet>
    </div>
  )
}
```

- [ ] **Step 3: The payment form**

Create `src/components/app/payment-form.tsx` using the **Task 1.6 form-field pattern**. Complete delta:

- `useForm<z.input<typeof paymentSchema>, unknown, z.output<typeof paymentSchema>>({ resolver: zodResolver(paymentSchema), mode: 'onTouched', defaultValues: { invoice_id, amount: defaultAmount, paid_on: format(new Date(), 'yyyy-MM-dd'), method: 'bank_transfer', reference: '' } })`
- **Amount** defaults to the outstanding balance (spec §7 Phase 5) — `<TextField inputMode="decimal" className="max-w-40">`. Helper text: *"Change it for a part payment."*
- **Date** — `<input type="date">`, defaults to today
- **Method** — `<SegmentedField>` over `PAYMENT_METHODS` with `PAYMENT_METHOD_LABELS`
- **Reference** — `<TextField>`, optional
- **Submit** calls `recordPayment(values)` then `onDone()`. **Not optimistic** — money consequence

- [ ] **Step 4: Verify — Phase 5 acceptance criteria**

1. On an invoice for `20.000`, record a payment of `8.000`. The badge still reads **Sent**, balance reads `BD 12.000`. ✅ *(spec: "A partial payment leaves the invoice sent, not paid; the balance is correct")*
2. Record `12.000` more. The badge flips to **Paid**, balance `BD 0.000`. **No cron job, no status write.** ✅
3. Delete the second payment → back to Sent with a `12.000` balance. ✅
4. Void an invoice. It gets a confirmation modal, not a toast. After voiding, its number and total are still shown, and its orders reappear on `/invoices/new`. ✅
5. Create a new invoice for the released orders → it gets a **new, higher** number. The gap is expected and correct. ✅

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/invoices/[id]" src/components/app/payment-form.tsx
git commit -m "feat(invoices): detail page, partial payments, void with modal confirmation"
```

---

## Task 5.7: The print route

No PDF library. Spec §7 Phase 5: a print-styled HTML route, saved as PDF by the browser.

**Files:**
- Create: `src/app/(app)/invoices/[id]/print/page.tsx`
- Create: `src/app/(app)/invoices/[id]/print/layout.tsx`

- [ ] **Step 1: A chrome-free layout**

Create `src/app/(app)/invoices/[id]/print/layout.tsx`:

```tsx
/**
 * Overrides the (app) layout's shell for this route only, so the printed
 * page has no sidebar even before the print stylesheet applies. The
 * (app) layout still runs above this, so the route is still authenticated.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[210mm] bg-white p-8 text-black">{children}</div>
}
```

- [ ] **Step 2: The invoice template**

Create `src/app/(app)/invoices/[id]/print/page.tsx`. Keep the whole template in **one file** — spec §7 Phase 5 says it will be re-themed, and a re-theme across six files is a bad afternoon.

A Server Component that awaits `params`, calls `getInvoiceDetail(id)` and `getSettings()`, `notFound()` if missing, and renders in this order:

1. **Header row:** business name, address (`address_line1`, `address_line2`, `city`, `postcode`, `country`), `business_email`, `business_phone` on the left; the word **INVOICE**, the `invoice_number`, `Issued {issued_on}` and `Due {due_on}` on the right
2. **Bill to:** customer name and their address lines
3. **A `VOID` watermark** when `computed_status === 'void'` — a large, rotated, low-opacity absolutely-positioned div. A voided invoice must never be mistaken for a live one on paper
4. **Line items table:** one row per `order_items` row across all covered orders, grouped by order with a subheading `Order #{order_number} — delivered {delivery_date}`. Columns: Description (`product_name`, the **snapshot**), Qty, Unit price, Amount. Right-align the three numeric columns with `tabular-nums`
5. **Totals block**, right-aligned: Subtotal; Delivery charge (only if non-zero); Discount (only if non-zero, as a negative); **Total** in bold with a rule above; Paid; **Balance due** in bold
6. **Payment details** from `app_settings`: `bank_name`, `bank_account_name`, `bank_account_number`, `bank_iban`, `bank_swift`. Skip any that are null — never print an empty label
7. **Terms line:** `Payment due within {default_payment_terms_days} days.` plus `invoice.notes` if present

Money goes through `formatMoney(value, settings)` directly rather than `<Money />`, because this route renders outside the `SettingsProvider`'s useful reach and already has `settings` in hand. That is the one sanctioned exception, and it still routes through `lib/format.ts`, so the Phase 8 grep stays clean.

- [ ] **Step 3: Verify — a Phase 5 acceptance criterion**

1. Open `/invoices/{id}/print` → a clean invoice, no navigation. ✅
2. Ctrl+P → **one page** for a typical invoice, black on white even in dark mode (the Phase 4 print stylesheet handles this). ✅
3. Business details and bank details come from Settings. Change the business name in Settings and reprint — it updates. ✅
4. Print a **voided** invoice → the VOID watermark is unmistakable. ✅
5. Rename a product, then reprint an old invoice → **the old name is still printed.** ✅ This is what the snapshot is for.
6. Save as PDF from the browser and open the file. It is legible. ✅

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/invoices/[id]/print"
git commit -m "feat(invoices): print route — no PDF dependency, bank details from settings, void watermark"
```

---

## Task 5.8: Fill the "Money" dashboard section

**Files:**
- Modify: `src/lib/queries/dashboard.ts`
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: The query**

Append to `src/lib/queries/dashboard.ts`:

```ts
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns'

export type MoneySummary = {
  revenueThisMonth: number
  revenueLastMonth: number
  outstanding: number
  outstandingCount: number
  overdue: number
  overdueCount: number
  unbilledDeliveredValue: number
  unbilledDeliveredCount: number
}

export async function getMoneySummary(): Promise<MoneySummary> {
  const supabase = await createClient()

  const now = new Date()
  const thisFrom = format(startOfMonth(now), 'yyyy-MM-dd')
  const thisTo   = format(endOfMonth(now), 'yyyy-MM-dd')
  const lastFrom = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
  const lastTo   = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')

  const [thisMonth, lastMonth, invoices, unbilled] = await Promise.all([
    supabase.from('v_order_totals').select('subtotal')
      .gte('delivery_date', thisFrom).lte('delivery_date', thisTo)
      .in('status', COUNTED_STATUSES as unknown as string[]),
    supabase.from('v_order_totals').select('subtotal')
      .gte('delivery_date', lastFrom).lte('delivery_date', lastTo)
      .in('status', COUNTED_STATUSES as unknown as string[]),
    supabase.from('v_invoice_totals').select('balance, computed_status'),
    supabase.from('v_uninvoiced_orders').select('subtotal').eq('status', 'delivered'),
  ])

  const sum = (rows: { subtotal: number | null }[] | null) =>
    (rows ?? []).reduce((s, r) => s + Number(r.subtotal ?? 0), 0)

  const invoiceRows = invoices.data ?? []
  const open = invoiceRows.filter(
    (i) => i.computed_status !== 'paid' && i.computed_status !== 'void',
  )
  const late = invoiceRows.filter((i) => i.computed_status === 'overdue')

  return {
    revenueThisMonth: sum(thisMonth.data),
    revenueLastMonth: sum(lastMonth.data),
    outstanding: open.reduce((s, i) => s + Number(i.balance ?? 0), 0),
    outstandingCount: open.length,
    overdue: late.reduce((s, i) => s + Number(i.balance ?? 0), 0),
    overdueCount: late.length,
    unbilledDeliveredValue: sum(unbilled.data),
    unbilledDeliveredCount: (unbilled.data ?? []).length,
  }
}
```

- [ ] **Step 2: Wire it into the dashboard**

Replace the Phase 5 placeholder in `src/app/(app)/page.tsx` with a three-card row:
- **Revenue this month** — `<Money value={revenueThisMonth} />` with a delta against last month: `((this − last) / last) × 100` as a signed percentage, green up / red down, and `—` when last month was zero
- **Outstanding** — `<Money value={outstanding} />`, `{outstandingCount} invoices`, linking to `/invoices`
- **Overdue** — `<Money value={overdue} />`, `{overdueCount} invoices`, in `text-destructive` when above zero, linking to `/invoices?status=overdue`

Add the unbilled-delivered figure to the **This week** section: `{unbilledDeliveredCount} delivered orders worth <Money value={unbilledDeliveredValue} /> not yet invoiced`, linking to `/invoices/new`. Spec §7 Phase 6 puts it there.

- [ ] **Step 3: Verify**

Every figure matches a hand calculation from seeded data. Mark an invoice paid → outstanding drops by exactly that balance. ✅

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/dashboard.ts "src/app/(app)/page.tsx"
git commit -m "feat(dashboard): revenue delta, outstanding, overdue and unbilled-delivered"
```

---

## Task 5.9: Phase Exit — acceptance gate

- [ ] `npm run typecheck` → clean, no `any`, no `@ts-ignore`
- [ ] `npm test` → all pass
- [ ] `npm run build` → succeeds
- [ ] `verify.sql` runs clean (through P5.7)
- [ ] An invoice covering three orders totals the sum of those orders, plus delivery charge, minus discount
- [ ] An order cannot appear on two active invoices — proved by the second `f_create_invoice` failing
- [ ] An order can **never** be attached to an invoice belonging to a different customer — **proved by attempting it directly in SQL** (Task 5.1 Step 4), in both directions
- [ ] A partial payment leaves the invoice `sent`, not `paid`; the balance is correct
- [ ] Voiding releases its orders to be invoiced again, and the voided invoice retains its number and total
- [ ] Invoice numbers are unique and monotonically increasing; gaps from voided invoices are expected and correct
- [ ] The print route produces a clean single-page invoice, black on white, with bank details from Settings
- [ ] A voided invoice prints with a VOID watermark
- [ ] Reprinting an old invoice after renaming a product still shows the old name
- [ ] `overdue` is nowhere stored — grep the schema: `select 1 from information_schema.columns where column_name = 'overdue'` returns nothing
- [ ] Usable at 375px
- [ ] Open the PR: `gh pr create --title "Phase 5 — Invoices and payments"`
