-- 0009_invoice_orders_fk_indexes.sql
--
-- Phase 8 performance advisor: invoice_orders has two composite foreign
-- keys — (order_id, customer_id) -> orders(id, customer_id) and
-- (invoice_id, customer_id) -> invoices(id, customer_id) — added in
-- 0007_invoices.sql to enforce "no invoice covers an order belonging to a
-- different customer" (P5.4) at the constraint level. Neither had a
-- covering index, so every update/delete on orders or invoices that checks
-- these constraints falls back to a sequential scan of invoice_orders.
--
-- The existing single-column indexes (idx_invoice_orders_invoice on
-- invoice_id, the unique constraint on order_id) do not count: Postgres
-- wants an index whose leading columns match the full FK column list, in
-- order, to serve the constraint check efficiently.

create index idx_invoice_orders_order_customer
  on public.invoice_orders (order_id, customer_id);

create index idx_invoice_orders_invoice_customer
  on public.invoice_orders (invoice_id, customer_id);
