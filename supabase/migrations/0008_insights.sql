-- 0008_insights.sql
-- The reporting layer. Every figure here is SQL, never TypeScript.

-- ────────────────────────────────────────────────────────────────────────
-- v_customer_summary
--
-- risk_flag needs care or it fires on every new customer. The
-- order_count >= 3 guard is load-bearing: with one order avg_gap_days is
-- null, Postgres's greatest() IGNORES nulls, so the threshold silently
-- collapses to lapse_threshold_days and flags everyone who ordered once
-- two months ago. Do not remove the guard "to catch more customers".
--
-- avg_gap_days is span / (n - 1), not span / n: three orders have two
-- gaps between them.
-- ────────────────────────────────────────────────────────────────────────
create view public.v_customer_summary
with (security_invoker = on) as
select
  c.id                                        as customer_id,
  c.name,
  c.status,
  c.type,
  c.city,
  c.price_tier,
  c.archived_at,
  coalesce(agg.lifetime_revenue, 0)::numeric(12,3) as lifetime_revenue,
  coalesce(agg.order_count, 0)                as order_count,
  agg.first_order_date,
  agg.last_order_date,
  case
    when agg.last_order_date is not null
    then (public.f_today() - agg.last_order_date)
  end                                         as days_since_last_order,
  agg.avg_gap_days,
  last_touch.last_contacted_at,
  (
        coalesce(agg.order_count, 0) >= 3
    and c.archived_at is null
    and c.status not in ('lead','lost')
    and agg.last_order_date is not null
    and (public.f_today() - agg.last_order_date)
          > greatest(agg.avg_gap_days * 1.5, s.lapse_threshold_days)
  )                                           as risk_flag
from public.customers c
cross join (
  select lapse_threshold_days from public.app_settings where id = 1
) s
left join lateral (
  select
    sum(t.subtotal)      as lifetime_revenue,
    count(*)             as order_count,
    min(t.delivery_date) as first_order_date,
    max(t.delivery_date) as last_order_date,
    case
      when count(*) > 1
      then (max(t.delivery_date) - min(t.delivery_date))::numeric / (count(*) - 1)
    end                  as avg_gap_days
  from public.v_order_totals t
  where t.customer_id = c.id
    -- Explicit. draft and cancelled are never revenue. Spec §3.
    and t.status in ('confirmed','in_production','delivered')
) agg on true
left join lateral (
  select max(i.occurred_at) as last_contacted_at
  from public.interactions i
  where i.customer_id = c.id
) last_touch on true;

revoke all on public.v_customer_summary from anon;

-- ────────────────────────────────────────────────────────────────────────
-- f_product_performance
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_product_performance(p_from date, p_to date)
returns table (
  product_id   uuid,
  product_name text,
  units_sold   int,
  revenue      numeric(12,3),
  cost         numeric(12,3),
  margin       numeric(12,3),
  margin_pct   numeric(6,2)
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.name,
    sum(oi.quantity)::int,
    sum(oi.line_total)::numeric(12,3),
    sum(oi.quantity * oi.unit_cost)::numeric(12,3),
    (sum(oi.line_total) - sum(oi.quantity * oi.unit_cost))::numeric(12,3),
    case
      when sum(oi.line_total) > 0
      then round(
        ((sum(oi.line_total) - sum(oi.quantity * oi.unit_cost))
          / sum(oi.line_total)) * 100, 2)
    end
  from public.order_items oi
  join public.orders   o on o.id = oi.order_id
  join public.products p on p.id = oi.product_id
  where o.delivery_date between p_from and p_to
    and o.status in ('confirmed','in_production','delivered')
  group by p.id, p.name
  order by sum(oi.line_total) desc;
$$;

revoke execute on function public.f_product_performance(date, date) from public, anon;
grant  execute on function public.f_product_performance(date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- f_revenue_by_month — generate_series zero-fills empty months, so the
-- chart has no gaps and no misleading straight line across them.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_revenue_by_month(p_months int default 12)
returns table (month date, revenue numeric(12,3), order_count int)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.month::date,
    coalesce(sum(t.subtotal), 0)::numeric(12,3),
    count(t.order_id)::int
  from generate_series(
    date_trunc('month', public.f_today()::timestamp) - ((p_months - 1) || ' months')::interval,
    date_trunc('month', public.f_today()::timestamp),
    interval '1 month'
  ) m(month)
  left join public.v_order_totals t
    on date_trunc('month', t.delivery_date::timestamp) = m.month
   and t.status in ('confirmed','in_production','delivered')
  group by m.month
  order by m.month;
$$;

revoke execute on function public.f_revenue_by_month(int) from public, anon;
grant  execute on function public.f_revenue_by_month(int) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- f_new_customers_by_month
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_new_customers_by_month(p_months int default 12)
returns table (month date, new_customers int)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.month::date,
    count(c.id)::int
  from generate_series(
    date_trunc('month', public.f_today()::timestamp) - ((p_months - 1) || ' months')::interval,
    date_trunc('month', public.f_today()::timestamp),
    interval '1 month'
  ) m(month)
  left join public.customers c
    on date_trunc('month', c.created_at) = m.month
   and c.archived_at is null
  group by m.month
  order by m.month;
$$;

revoke execute on function public.f_new_customers_by_month(int) from public, anon;
grant  execute on function public.f_new_customers_by_month(int) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- f_outreach_effectiveness
--
-- Does a sample drop actually work? Per channel: how many touches, how
-- many distinct customers, and how many of those went on to order AFTER
-- their first touch on that channel. "After" matters — counting existing
-- customers' orders would make every channel look like a triumph.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_outreach_effectiveness(p_from date, p_to date)
returns table (
  channel               text,
  interaction_count     int,
  customers_touched     int,
  customers_who_ordered int,
  conversion_pct        numeric(6,2)
)
language sql
stable
security invoker
set search_path = ''
as $$
  with touched as (
    select
      i.channel,
      i.customer_id,
      min(i.occurred_at)::date as first_touch
    from public.interactions i
    where i.occurred_at::date between p_from and p_to
    group by i.channel, i.customer_id
  ),
  flagged as (
    select
      t.channel,
      t.customer_id,
      exists (
        select 1
        from public.orders o
        where o.customer_id = t.customer_id
          and o.status in ('confirmed','in_production','delivered')
          and o.ordered_on >= t.first_touch
      ) as ordered_after
    from touched t
  ),
  counts as (
    select i.channel, count(*)::int as interaction_count
    from public.interactions i
    where i.occurred_at::date between p_from and p_to
    group by i.channel
  )
  select
    f.channel,
    c.interaction_count,
    count(*)::int,
    count(*) filter (where f.ordered_after)::int,
    round(100.0 * count(*) filter (where f.ordered_after) / nullif(count(*), 0), 2)
  from flagged f
  join counts c on c.channel = f.channel
  group by f.channel, c.interaction_count
  order by f.channel;
$$;

revoke execute on function public.f_outreach_effectiveness(date, date) from public, anon;
grant  execute on function public.f_outreach_effectiveness(date, date) to authenticated;
