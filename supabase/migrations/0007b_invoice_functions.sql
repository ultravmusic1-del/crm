-- 0007b_invoice_functions.sql
-- f_create_invoice / f_void_invoice.
--
-- supabase-js cannot open a multi-statement transaction, and a
-- read-then-increment of next_invoice_number from a Server Action is a
-- lost-update race that produces duplicate invoice numbers. That is the
-- entire reason these functions exist.

create or replace function public.f_create_invoice(
  p_customer_id uuid,
  p_order_ids   uuid[],
  p_issued_on   date,
  p_due_on      date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
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
security invoker
set search_path = ''
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
