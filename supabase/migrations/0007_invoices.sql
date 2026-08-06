-- 0007_invoices.sql
-- Invoices, the orders they cover, payments, and derived totals.

-- ────────────────────────────────────────────────────────────────────────
-- invoices
--
-- `overdue` is NOT a stored status. It is derived from
-- (status = 'sent' and due_on < f_today()). Storing it would need a cron
-- job to keep it true, and a stale flag on money is worse than no flag.
--
-- `paid` is in the check constraint for compatibility but is NEVER written
-- by this application — it is derived in v_invoice_totals from the payments
-- sum. The stored status only ever moves draft -> sent -> void by explicit
-- user action.
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
-- The composite foreign keys make it STRUCTURALLY IMPOSSIBLE to put cafe
-- A's order on cafe B's invoice — a bug that is otherwise silent and
-- extremely embarrassing.
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

create index idx_invoice_orders_invoice  on public.invoice_orders (invoice_id);
create index idx_invoice_orders_customer on public.invoice_orders (customer_id);

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

-- Orders that can still be invoiced: counted status, not already on an
-- invoice.
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
