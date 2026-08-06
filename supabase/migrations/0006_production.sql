-- 0006_production.sql
-- Weekly bake list and the shopping list derived from it.

-- ────────────────────────────────────────────────────────────────────────
-- f_bake_list
--
-- Status filter, spelled out because getting it wrong is silent:
-- 'delivered' is INCLUDED deliberately. Reprinting Wednesday's weekly bake
-- list must not drop Monday's and Tuesday's already-delivered orders — the
-- totals would change mid-week and stop matching what she actually baked.
-- Only 'draft' and 'cancelled' are excluded.
--
-- Grouped by product_id and labelled with the product's CURRENT name, not
-- the order_items snapshot. The snapshot is for invoices, which are
-- historical documents; a bake list is a forward-looking instruction and
-- should use the name on the shelf today. A renamed product must produce
-- ONE row here, not two.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_bake_list(p_from date, p_to date)
returns table (
  product_id     uuid,
  product_name   text,
  product_unit   text,
  total_quantity int,
  contributors   jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.unit,
    sum(oi.quantity)::int,
    jsonb_agg(
      jsonb_build_object(
        'order_id',      o.id,
        'order_number',  o.order_number,
        'customer_name', c.name,
        'delivery_date', o.delivery_date,
        'quantity',      oi.quantity
      )
      order by o.delivery_date, c.name
    )
  from public.order_items oi
  join public.orders    o on o.id = oi.order_id
  join public.customers c on c.id = o.customer_id
  join public.products  p on p.id = oi.product_id
  where o.delivery_date between p_from and p_to
    and o.status in ('confirmed','in_production','delivered')
  group by p.id, p.name, p.unit
  order by sum(oi.quantity) desc, p.name;
$$;

revoke execute on function public.f_bake_list(date, date) from public, anon;
grant  execute on function public.f_bake_list(date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- f_shopping_list
--
-- product_ingredients.quantity is per ONE products.unit, and
-- order_items.quantity is also in products.unit, so they multiply directly.
-- units_per_box never enters this calculation — if it ever does, the
-- shopping list is wrong by that factor.
--
-- The division by pack_size is why ingredients.pack_size is `not null
-- check (pack_size > 0)`: a null would silently null the row out and a
-- zero would raise division_by_zero and take down the whole page.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_shopping_list(p_from date, p_to date)
returns table (
  ingredient_id   uuid,
  ingredient_name text,
  unit            text,
  total_needed    numeric(12,3),
  pack_size       numeric(12,3),
  packs_to_buy    int,
  estimated_cost  numeric(12,3)
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bake as (
    select oi.product_id, sum(oi.quantity)::numeric as qty
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.delivery_date between p_from and p_to
      and o.status in ('confirmed','in_production','delivered')
    group by oi.product_id
  )
  select
    i.id,
    i.name,
    i.unit,
    sum(bake.qty * pi.quantity)::numeric(12,3),
    i.pack_size,
    ceil(sum(bake.qty * pi.quantity) / i.pack_size)::int,
    (ceil(sum(bake.qty * pi.quantity) / i.pack_size) * i.pack_cost)::numeric(12,3)
  from bake
  join public.product_ingredients pi on pi.product_id = bake.product_id
  join public.ingredients         i  on i.id = pi.ingredient_id
  group by i.id, i.name, i.unit, i.pack_size, i.pack_cost
  order by i.name;
$$;

revoke execute on function public.f_shopping_list(date, date) from public, anon;
grant  execute on function public.f_shopping_list(date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- v_delivery_schedule — the same window, by day, with the SNAPSHOTTED
-- address and notes. Snapshots here, not a join to customers: a delivery
-- sheet must say where it went, not where they live now.
-- ────────────────────────────────────────────────────────────────────────
create view public.v_delivery_schedule
with (security_invoker = on) as
select
  o.id                     as order_id,
  o.order_number,
  o.delivery_date,
  o.status,
  c.id                     as customer_id,
  c.name                   as customer_name,
  c.phone                  as customer_phone,
  o.delivery_address,
  o.delivery_notes_snapshot,
  coalesce(sum(oi.quantity), 0)::int as total_units,
  jsonb_agg(
    jsonb_build_object('name', oi.product_name, 'quantity', oi.quantity)
    order by oi.product_name
  ) filter (where oi.id is not null) as items
from public.orders o
join public.customers c on c.id = o.customer_id
left join public.order_items oi on oi.order_id = o.id
where o.status in ('confirmed','in_production','delivered')
group by o.id, c.id;

revoke all on public.v_delivery_schedule from anon;
