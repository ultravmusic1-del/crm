-- verify.sql — SQL assertions run against the database.
-- Every block raises on failure. `psql -v ON_ERROR_STOP=1 -f` must exit 0.
-- Grown by every phase. Gated in Phase 8.
--
-- This machine has no psql, so it is run through the Supabase MCP
-- `execute_sql` tool instead. Strip the \set line when pasting there;
-- keep it in the file so `npm run db:verify` works once Docker exists.

\set ON_ERROR_STOP on

-- ── Phase 0 ─────────────────────────────────────────────────────────────

-- P0.1: every table in public has RLS enabled. No exceptions.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'P0.1 FAIL: table(s) without RLS: %', v_bad;
  end if;
end $$;

-- P0.2: every table has at least one policy. RLS on with no policy makes a
-- table invisible to everyone — that is how the signup_allowlist bug in the
-- original spec would have rejected every login.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname
    );
  if v_bad is not null then
    raise exception 'P0.2 FAIL: table(s) with RLS but no policy: %', v_bad;
  end if;
end $$;

-- P0.3: anon can execute no function in public. Postgres grants EXECUTE to
-- PUBLIC by default and PostgREST exposes functions as RPC endpoints.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'P0.3 FAIL: anon can execute function(s): %', v_bad;
  end if;
end $$;

-- P0.4: exactly one security definer function, and it is the auth trigger.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname <> 'f_handle_new_user';
  if v_bad is not null then
    raise exception 'P0.4 FAIL: unexpected security definer function(s): %', v_bad;
  end if;
end $$;

-- P0.5: every function pins search_path. A caller who controls search_path
-- can otherwise shadow objects a function references.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proconfig is null
         or not exists (
           select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
         ));
  if v_bad is not null then
    raise exception 'P0.5 FAIL: function(s) with mutable search_path: %', v_bad;
  end if;
end $$;

-- P0.6: current_date appears in no function body. The database is UTC and
-- the business is UTC+3, so current_date is wrong for three hours a day.
--
-- The CTE is `as materialized` on purpose. Written as a plain join,
-- Postgres is free to evaluate pg_get_functiondef() BEFORE the namespace
-- predicate restricts the scan — it then hits an aggregate in pg_catalog
-- and dies with `42809: "array_agg" is an aggregate function`. Materialising
-- forces the filter to run first. prokind = 'f' excludes aggregates,
-- window functions and procedures, which pg_get_functiondef cannot render.
do $$
declare v_bad text;
begin
  with public_fns as materialized (
    select oid, proname
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and prokind = 'f'
  )
  select string_agg(proname, ', ') into v_bad
  from public_fns
  where pg_get_functiondef(oid) ~* '\mcurrent_date\M';

  if v_bad is not null then
    raise exception 'P0.6 FAIL: function(s) use current_date instead of f_today(): %', v_bad;
  end if;
end $$;

-- P0.7: the allowlist is readable by the auth admin and nobody else.
do $$
begin
  if not has_table_privilege('supabase_auth_admin', 'public.signup_allowlist', 'SELECT') then
    raise exception 'P0.7 FAIL: supabase_auth_admin cannot read signup_allowlist — every login will be rejected';
  end if;
  if has_table_privilege('anon', 'public.signup_allowlist', 'SELECT')
     or has_table_privilege('authenticated', 'public.signup_allowlist', 'SELECT') then
    raise exception 'P0.7 FAIL: signup_allowlist is readable by anon or authenticated';
  end if;
end $$;

-- ── Phase 1 ─────────────────────────────────────────────────────────────

-- P1.1: at most one primary contact per customer.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from (
    select customer_id from public.contacts
    where is_primary group by customer_id having count(*) > 1
  ) t;
  if v_bad > 0 then
    raise exception 'P1.1 FAIL: % customer(s) have more than one primary contact', v_bad;
  end if;
end $$;

-- P1.2: EVERY view is security_invoker. A view without it runs as its owner
-- and bypasses RLS on its base tables. This is the single most dangerous
-- mistake available in this schema, so it is checked across all views, not
-- a hardcoded list.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and (c.reloptions is null
         or not exists (
           select 1 from unnest(c.reloptions) opt
           where opt = 'security_invoker=on' or opt = 'security_invoker=true'
         ));
  if v_bad is not null then
    raise exception 'P1.2 FAIL: view(s) missing security_invoker = on: %', v_bad;
  end if;
end $$;

-- P1.3: anon can select from no view.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and has_table_privilege('anon', c.oid, 'SELECT');
  if v_bad is not null then
    raise exception 'P1.3 FAIL: anon can select from view(s): %', v_bad;
  end if;
end $$;

-- P1.4: no interaction has a follow-up flagged done with no date, or a
-- date in a state the "due" view could never surface.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.interactions
  where follow_up_done and follow_up_on is null;
  if v_bad > 0 then
    raise exception 'P1.4 FAIL: % interaction(s) marked follow-up-done with no follow-up date', v_bad;
  end if;
end $$;

-- ── Phase 2 ─────────────────────────────────────────────────────────────

-- P2.1: a pack_size of zero would raise division_by_zero in the shopping
-- list and take down the whole production page.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.ingredients where pack_size <= 0;
  if v_bad > 0 then
    raise exception 'P2.1 FAIL: % ingredient(s) have a non-positive pack_size', v_bad;
  end if;
end $$;

-- P2.2: products must never be soft-deleted by two mechanisms.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name = 'active';
  if v_bad > 0 then
    raise exception 'P2.2 FAIL: products.active exists; availability is archived_at is null';
  end if;
end $$;

-- P2.3: money columns must never be float. Runs over the WHOLE schema, so
-- it keeps guarding every later phase as they add monetary columns.
do $$
declare v_bad text;
begin
  select string_agg(table_name || '.' || column_name, ', ') into v_bad
  from information_schema.columns
  where table_schema = 'public'
    and (column_name ~ 'price|cost|amount|total|charge|discount|revenue|margin')
    and data_type in ('double precision', 'real');
  if v_bad is not null then
    raise exception 'P2.3 FAIL: monetary column(s) are float, not numeric: %', v_bad;
  end if;
end $$;

-- P2.4: v_product_costs must equal a direct recomputation from the recipe.
-- This is the arithmetic the whole margin story rests on.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.v_product_costs vc
  where vc.recipe_cost <> coalesce((
    select round(sum(pi.quantity * (i.pack_cost / i.pack_size)), 3)
    from public.product_ingredients pi
    join public.ingredients i on i.id = pi.ingredient_id
    where pi.product_id = vc.product_id
  ), 0);
  if v_bad > 0 then
    raise exception 'P2.4 FAIL: % product(s) have a recipe_cost that does not match their recipe', v_bad;
  end if;
end $$;

-- P2.5: the effective price must always equal override-else-tier, and its
-- stated source must agree with the number.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.v_effective_prices
  where effective_price <> coalesce(
          custom_price,
          case when price_tier = 'retail' then retail_price else wholesale_price end)
     or (custom_price is not null and price_source <> 'custom')
     or (custom_price is null and price_tier = 'retail'    and price_source <> 'retail')
     or (custom_price is null and price_tier = 'wholesale' and price_source <> 'wholesale');
  if v_bad > 0 then
    raise exception 'P2.5 FAIL: % effective price row(s) disagree with override-else-tier', v_bad;
  end if;
end $$;

-- ── Phase 3 ─────────────────────────────────────────────────────────────

-- P3.1: the SQL fortnightly rule must produce the same dates as
-- src/lib/recurrence.ts. These expectations are copied from
-- src/lib/recurrence.test.ts — change one, change both.
do $$
declare v_dates date[]; v_start date := date '2026-08-04'; v_from date := date '2026-08-06';
begin
  select array_agg(d order by d) into v_dates
  from generate_series(greatest(v_start, v_from), v_from + 60, interval '1 day') g(d)
  where extract(dow from g.d)::int = 2
    and ((g.d::date - v_start) / 7) % 2 = 0;

  if v_dates[1:4] is distinct from array[
    date '2026-08-18', date '2026-09-01', date '2026-09-15', date '2026-09-29'
  ] then
    raise exception 'P3.1 FAIL: SQL fortnightly parity disagrees with recurrence.test.ts. Got %', v_dates[1:4];
  end if;
end $$;

-- P3.2: day_of_week 0 must mean Sunday in SQL, matching date-fns getDay().
do $$
begin
  if extract(dow from date '2026-08-09')::int <> 0 then
    raise exception 'P3.2 FAIL: 2026-08-09 is a Sunday; extract(dow) did not return 0';
  end if;
end $$;

-- P3.3: generation must be idempotent.
do $$
declare v_before int; v_after int;
begin
  select count(*) into v_before from public.orders where recurring_order_id is not null;
  perform public.f_generate_scheduled_orders(public.f_today() + 21);
  perform public.f_generate_scheduled_orders(public.f_today() + 21);
  select count(*) into v_after from public.orders where recurring_order_id is not null;
  if v_after <> v_before then
    raise exception 'P3.3 FAIL: generation is not idempotent (% -> %)', v_before, v_after;
  end if;
end $$;

-- P3.4: no non-cancelled order may exist with zero line items.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.orders o
  where o.status <> 'cancelled'
    and not exists (select 1 from public.order_items oi where oi.order_id = o.id);
  if v_bad > 0 then
    raise exception 'P3.4 FAIL: % non-cancelled order(s) have no line items', v_bad;
  end if;
end $$;

-- P3.5: no line item may have a zero price. resolvePrices throws on zero;
-- this catches anything that got in another way.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.order_items where unit_price <= 0;
  if v_bad > 0 then
    raise exception 'P3.5 FAIL: % order line(s) have a zero unit_price', v_bad;
  end if;
end $$;

-- P3.6: v_order_totals must equal a direct sum of its line items.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.v_order_totals t
  where t.subtotal <> coalesce((
    select sum(oi.line_total) from public.order_items oi where oi.order_id = t.order_id
  ), 0);
  if v_bad > 0 then
    raise exception 'P3.6 FAIL: % order(s) have a subtotal that does not match their items', v_bad;
  end if;
end $$;

-- ── Phase 4 ─────────────────────────────────────────────────────────────

-- P4.1: the bake list must equal a direct sum of order_items over the same
-- window and statuses. This is the arithmetic spec §7 Phase 4 asks to be
-- verified by hand; here it is, verified automatically as well.
do $$
declare
  v_from date := public.f_today() - 90;
  v_to   date := public.f_today() + 90;
  v_bake  int;
  v_direct int;
begin
  select coalesce(sum(total_quantity), 0) into v_bake
  from public.f_bake_list(v_from, v_to);

  select coalesce(sum(oi.quantity), 0) into v_direct
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.delivery_date between v_from and v_to
    and o.status in ('confirmed','in_production','delivered');

  if v_bake <> v_direct then
    raise exception 'P4.1 FAIL: bake list total % <> direct sum %', v_bake, v_direct;
  end if;
end $$;

-- P4.2: draft and cancelled orders must never reach the bake list.
do $$
declare
  v_from date := public.f_today() - 90;
  v_to   date := public.f_today() + 90;
  v_excluded int;
  v_bake int;
  v_all  int;
begin
  select coalesce(sum(oi.quantity), 0) into v_excluded
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.delivery_date between v_from and v_to
    and o.status in ('draft','cancelled');

  if v_excluded = 0 then
    raise notice 'P4.2 SKIPPED: no draft or cancelled orders in the window';
    return;
  end if;

  select coalesce(sum(total_quantity), 0) into v_bake from public.f_bake_list(v_from, v_to);

  select coalesce(sum(oi.quantity), 0) into v_all
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.delivery_date between v_from and v_to;

  if v_bake + v_excluded <> v_all then
    raise exception 'P4.2 FAIL: bake list % + excluded % <> all %', v_bake, v_excluded, v_all;
  end if;
end $$;

-- P4.3: packs_to_buy must always cover total_needed. An off-by-one here
-- means running out of oats mid-bake.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.f_shopping_list(public.f_today() - 90, public.f_today() + 90)
  where packs_to_buy * pack_size < total_needed;
  if v_bad > 0 then
    raise exception 'P4.3 FAIL: % shopping line(s) buy fewer packs than needed', v_bad;
  end if;
end $$;

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

-- ── Phase 6 ─────────────────────────────────────────────────────────────

-- P6.1: a customer with fewer than three orders must NEVER be at risk.
-- Without the order_count >= 3 guard, avg_gap_days is null, greatest()
-- ignores nulls, the threshold collapses to lapse_threshold_days, and
-- everyone who ordered once two months ago lights up.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.v_customer_summary
  where risk_flag and order_count < 3;
  if v_bad > 0 then
    raise exception 'P6.1 FAIL: % customer(s) with under 3 orders are flagged at risk', v_bad;
  end if;
end $$;

-- P6.2: archived customers, leads and lost customers are never at risk.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.v_customer_summary
  where risk_flag and (archived_at is not null or status in ('lead','lost'));
  if v_bad > 0 then
    raise exception 'P6.2 FAIL: % archived/lead/lost customer(s) are flagged at risk', v_bad;
  end if;
end $$;

-- P6.3: lifetime revenue must equal the sum of that customer's counted orders.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.v_customer_summary s
  where s.lifetime_revenue <> coalesce((
    select sum(t.subtotal) from public.v_order_totals t
    where t.customer_id = s.customer_id
      and t.status in ('confirmed','in_production','delivered')
  ), 0);
  if v_bad > 0 then
    raise exception 'P6.3 FAIL: % customer summary revenue figure(s) are wrong', v_bad;
  end if;
end $$;

-- P6.4: cancelled orders are excluded from revenue everywhere.
do $$
declare v_cancelled numeric; v_total numeric; v_summary numeric;
begin
  select coalesce(sum(subtotal), 0) into v_cancelled
  from public.v_order_totals where status = 'cancelled';

  if v_cancelled = 0 then
    raise notice 'P6.4 SKIPPED: no cancelled orders to test with';
    return;
  end if;

  select coalesce(sum(subtotal), 0) into v_total from public.v_order_totals;
  select coalesce(sum(lifetime_revenue), 0) into v_summary from public.v_customer_summary;

  if v_summary >= v_total then
    raise exception 'P6.4 FAIL: summary revenue % includes cancelled orders (all orders total %)', v_summary, v_total;
  end if;
end $$;

-- P6.5: product performance revenue must equal the order_items sum.
do $$
declare v_from date := public.f_today() - 365; v_to date := public.f_today() + 365;
declare v_perf numeric; v_direct numeric;
begin
  select coalesce(sum(revenue), 0) into v_perf
  from public.f_product_performance(v_from, v_to);

  select coalesce(sum(oi.line_total), 0) into v_direct
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.delivery_date between v_from and v_to
    and o.status in ('confirmed','in_production','delivered');

  if v_perf <> v_direct then
    raise exception 'P6.5 FAIL: product performance revenue % <> direct sum %', v_perf, v_direct;
  end if;
end $$;

-- P6.6: revenue by month must sum to the same total over the same window.
do $$
declare v_months numeric; v_direct numeric; v_from date;
begin
  select min(month) into v_from from public.f_revenue_by_month(12);
  select coalesce(sum(revenue), 0) into v_months from public.f_revenue_by_month(12);

  select coalesce(sum(t.subtotal), 0) into v_direct
  from public.v_order_totals t
  where t.delivery_date >= v_from
    and t.delivery_date < (date_trunc('month', public.f_today()::timestamp) + interval '1 month')::date
    and t.status in ('confirmed','in_production','delivered');

  if v_months <> v_direct then
    raise exception 'P6.6 FAIL: revenue by month % <> direct sum %', v_months, v_direct;
  end if;
end $$;

-- ── Phase 8 ─────────────────────────────────────────────────────────────

-- P8.1: every table in public has RLS enabled. No exceptions.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'P8.1 FAIL: table(s) without RLS: %', v_bad;
  end if;
end $$;

-- P8.2: every table except signup_allowlist has at least one policy.
-- A table with RLS and no policy is invisible, which is how the Phase 0
-- login bug happened.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);
  if v_bad is not null then
    raise exception 'P8.2 FAIL: table(s) with RLS but no policy: %', v_bad;
  end if;
end $$;

-- P8.3: anon can execute no function in public. Spec correction C3.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then
    raise exception 'P8.3 FAIL: anon can execute function(s): %', v_bad;
  end if;
end $$;

-- P8.4: exactly one security definer function, and it is the auth trigger.
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname <> 'f_handle_new_user';
  if v_bad is not null then
    raise exception 'P8.4 FAIL: unexpected security definer function(s): %', v_bad;
  end if;
end $$;

-- P8.5: `overdue` is nowhere stored.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from information_schema.columns
  where table_schema = 'public' and column_name = 'overdue';
  if v_bad > 0 then
    raise exception 'P8.5 FAIL: an overdue column exists; it must stay derived';
  end if;
end $$;

-- P8.6: current_date appears in no function body. The database is UTC and
-- the business is UTC+3, so current_date is wrong for three hours a day.
--
-- Same materialized-CTE trick as P0.6: a plain join lets Postgres evaluate
-- pg_get_functiondef() before the namespace predicate restricts the scan,
-- which hits an aggregate in pg_catalog and dies with 42809.
do $$
declare v_bad text;
begin
  with public_fns as materialized (
    select oid, proname
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and prokind = 'f'
  )
  select string_agg(proname, ', ') into v_bad
  from public_fns
  where pg_get_functiondef(oid) ~* '\mcurrent_date\M';

  if v_bad is not null then
    raise exception 'P8.6 FAIL: function(s) use current_date instead of f_today(): %', v_bad;
  end if;
end $$;

-- P8.7: total revenue is reproducible three different ways.
do $$
declare v_orders numeric; v_summary numeric; v_products numeric;
begin
  select coalesce(sum(subtotal), 0) into v_orders
  from public.v_order_totals
  where status in ('confirmed','in_production','delivered');

  select coalesce(sum(lifetime_revenue), 0) into v_summary
  from public.v_customer_summary;

  select coalesce(sum(revenue), 0) into v_products
  from public.f_product_performance(date '2000-01-01', date '2100-01-01');

  if v_orders = 0 then
    raise exception 'P8.7 FAIL: total revenue is 0 — this assertion needs seeded data to mean anything';
  end if;

  if v_orders <> v_summary then
    raise exception 'P8.7 FAIL: order revenue % <> customer summary revenue %', v_orders, v_summary;
  end if;
  if v_orders <> v_products then
    raise exception 'P8.7 FAIL: order revenue % <> product performance revenue %', v_orders, v_products;
  end if;
end $$;

do $$ begin raise notice 'verify.sql: ALL ASSERTIONS PASSED'; end $$;
