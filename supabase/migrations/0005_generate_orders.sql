-- 0005_generate_orders.sql
-- Materialise orders from active schedules through a horizon.
-- Called from a visible button on /schedules, NEVER from a render:
-- Next 16 forbids writes during a render, and prefetch would race it.
--
-- ⚠ HISTORY: the version first applied to the remote used
--     on conflict (recurring_order_id, delivery_date) do nothing
-- and raised `42P10: there is no unique or exclusion constraint matching
-- the ON CONFLICT specification` on the very first run, because the arbiter
-- index idx_orders_recurring_delivery is PARTIAL and Postgres will not use
-- a partial index as an arbiter unless the clause repeats its predicate.
-- The corrected body below is what the remote now runs; the remote records
-- that correction as migration 0005b. Replaying these files from scratch
-- produces the same end state.

create or replace function public.f_generate_scheduled_orders(p_until date)
returns table (
  created_count int,
  skipped_count int,
  warnings      text[]
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_created  int    := 0;
  v_skipped  int    := 0;
  v_warnings text[] := '{}';
  v_today    date   := public.f_today();
  v_order_id uuid;
  v_items    int;
  r          record;
  d          date;
begin
  for r in
    select
      ro.id, ro.customer_id, ro.frequency, ro.day_of_week, ro.day_of_month,
      ro.starts_on, ro.ends_on, ro.notes,
      c.name as customer_name, c.price_tier, c.delivery_notes,
      nullif(concat_ws(', ', c.address_line1, c.address_line2, c.city, c.postcode), '')
        as address
    from public.recurring_orders ro
    join public.customers c on c.id = ro.customer_id
    where ro.active                                      -- skip inactive schedules
      and c.archived_at is null
      and ro.starts_on <= p_until
      and (ro.ends_on is null or ro.ends_on >= v_today)  -- skip past ends_on
  loop
    -- Warn about archived products BEFORE generating, once per schedule, so
    -- a discontinued bar is not quietly generated forever.
    v_warnings := v_warnings || (
      select coalesce(
        array_agg(format(
          'Schedule for %s: "%s" is archived and was left off every generated order.',
          r.customer_name, p.name)),
        '{}'::text[])
      from public.recurring_order_items roi
      join public.products p on p.id = roi.product_id
      where roi.recurring_order_id = r.id
        and p.archived_at is not null
    );

    for d in
      select gs::date
      from generate_series(
        greatest(r.starts_on, v_today),
        least(p_until, coalesce(r.ends_on, p_until)),
        interval '1 day'
      ) gs
    loop
      -- Does this date match the schedule?
      continue when not (
        case r.frequency
          when 'weekly' then
            extract(dow from d)::int = r.day_of_week
          when 'fortnightly' then
            extract(dow from d)::int = r.day_of_week
            -- Parity anchors on starts_on, NOT on the epoch or the year
            -- boundary. (d - starts_on) is an integer number of days.
            and ((d - r.starts_on) / 7) % 2 = 0
          when 'monthly' then
            extract(day from d)::int = r.day_of_month
        end
      );

      -- MUST be reset each iteration: RETURNING ... INTO leaves the previous
      -- value in place when ON CONFLICT DO NOTHING skips the row, which
      -- would double-count creations and re-insert items.
      v_order_id := null;

      insert into public.orders (
        customer_id, delivery_date, recurring_order_id, status,
        delivery_address, delivery_notes_snapshot, notes
      )
      values (
        r.customer_id, d, r.id, 'confirmed',
        r.address, r.delivery_notes, r.notes
      )
      -- Idempotency. The unique index alone would RAISE, not skip, so a
      -- second run would abort partway through instead of being a no-op.
      --
      -- The `where` clause is REQUIRED: the arbiter index is partial, and
      -- without repeating its predicate Postgres raises 42P10.
      on conflict (recurring_order_id, delivery_date)
        where recurring_order_id is not null
        do nothing
      returning id into v_order_id;

      if v_order_id is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      -- Snapshot name, price and cost, exactly as the order form does.
      -- Price resolution mirrors v_effective_prices: override, else tier.
      insert into public.order_items (
        order_id, product_id, product_name, quantity, unit_price, unit_cost
      )
      select
        v_order_id, roi.product_id, p.name, roi.quantity,
        coalesce(cp.unit_price,
          case when r.price_tier = 'retail' then p.retail_price else p.wholesale_price end),
        p.unit_cost
      from public.recurring_order_items roi
      join public.products p on p.id = roi.product_id
      left join public.customer_prices cp
        on cp.customer_id = r.customer_id and cp.product_id = roi.product_id
      where roi.recurring_order_id = r.id
        and p.archived_at is null      -- skip archived products
        and coalesce(cp.unit_price,
              case when r.price_tier = 'retail' then p.retail_price else p.wholesale_price end
            ) > 0;                     -- and anything with no price set

      get diagnostics v_items = row_count;

      if v_items = 0 then
        -- An order with no lines is meaningless and would show as a
        -- zero-value delivery on the bake list. Remove it and say why.
        delete from public.orders where id = v_order_id;
        v_warnings := v_warnings || format(
          'Schedule for %s on %s produced no lines (every product is archived or has no price). No order was created.',
          r.customer_name, d);
        continue;
      end if;

      v_created := v_created + 1;
    end loop;
  end loop;

  return query select v_created, v_skipped, v_warnings;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default and PostgREST exposes
-- functions as RPC endpoints. This one WRITES.
revoke execute on function public.f_generate_scheduled_orders(date) from public, anon;
grant  execute on function public.f_generate_scheduled_orders(date) to authenticated;
