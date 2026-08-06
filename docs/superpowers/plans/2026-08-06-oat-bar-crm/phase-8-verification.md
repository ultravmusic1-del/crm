# Phase 8 — Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the numbers trustworthy enough to invoice from, and prove the app is usable by someone who has never seen it.

**Architecture:** A deterministic seed, a SQL assertion suite that exits non-zero on any failure, unauthenticated probes against the public REST API, and one Playwright journey that walks the whole business from an empty database.

**Tech Stack:** Adds no dependencies. Uses `@playwright/test`, installed in Phase 0.

---

**Branch:** `git checkout main && git pull && git checkout -b phase-8-verification`

**Depends on:** Phases 0–7 complete.

> ## ⚠️ Read this before Task 8.1
>
> This machine has no Docker, so per the README's decision there is **one database, and it is production**. `supabase/seed.sql` **deletes every business row**. If any real customer data exists, do not run it — create a Supabase branch first (MCP `create_branch`) and seed that. The seed file has a guard that refuses to run without an explicit confirmation, and that guard is not decoration.

---

## Task 8.1: Seed data

**Files:**
- Create: `supabase/seed.sql`

- [ ] **Step 1: Write the guard and the wipe**

Create `supabase/seed.sql`:

```sql
-- seed.sql — deterministic demo data for verification.
--
-- ⚠️ THIS DELETES EVERY BUSINESS ROW. Because this project runs against a
-- remote database (no Docker on the dev machine), the guard below is the
-- only thing between a typo and a wiped production dataset. Run:
--     set app.seed_confirmed = 'yes-destroy-all-data';
-- in the SAME session before this file.

do $$
begin
  if current_setting('app.seed_confirmed', true) is distinct from 'yes-destroy-all-data' then
    raise exception
      'seed.sql deletes all data. Run: set app.seed_confirmed = ''yes-destroy-all-data''; first.';
  end if;
end $$;

-- Order matters: children before parents where there is no cascade.
truncate table
  public.payments,
  public.invoice_orders,
  public.invoices,
  public.order_items,
  public.orders,
  public.recurring_order_items,
  public.recurring_orders,
  public.product_ingredients,
  public.customer_prices,
  public.interactions,
  public.contacts,
  public.ingredients,
  public.products,
  public.customers
restart identity cascade;

-- Reset invoice numbering so the seed is reproducible run to run.
update public.app_settings set next_invoice_number = 1 where id = 1;
```

`restart identity` is what resets `orders.order_number`, which spec §7 Phase 8 step 1 requires.

- [ ] **Step 2: Append ingredients and products**

```sql
-- ── 12 ingredients ──────────────────────────────────────────────────────
insert into public.ingredients (name, unit, pack_size, pack_cost) values
  ('Rolled oats',      'g',  1000,  2.400),
  ('Medjool dates',    'g',  1000,  6.800),
  ('Almonds',          'g',   500,  6.000),
  ('Cacao powder',     'g',   250,  4.200),
  ('Peanut butter',    'g',  1000,  5.500),
  ('Honey',            'g',   500,  3.900),
  ('Coconut oil',      'g',   500,  2.800),
  ('Desiccated coconut','g',  500,  2.100),
  ('Chia seeds',       'g',   250,  3.400),
  ('Sea salt',         'g',   500,  1.200),
  ('Vanilla extract',  'ml',  100,  8.500),
  ('Dark chocolate',   'g',  1000, 12.000);

-- ── 6 products, one of them archived and still on a schedule ────────────
insert into public.products (name, sku, unit, units_per_box, wholesale_price, retail_price, unit_cost, archived_at) values
  ('Almond Crunch Bar', 'ALM-01', 'bar', 12, 0.500, 0.900, 0.216, null),
  ('Cacao Date Bar',    'CAC-01', 'bar', 12, 0.550, 0.950, 0.248, null),
  ('Peanut Power Bar',  'PNT-01', 'bar', 12, 0.520, 0.900, 0.231, null),
  ('Coconut Chia Bar',  'COC-01', 'bar', 12, 0.480, 0.850, 0.205, null),
  ('Double Choc Bar',   'CHO-01', 'bar', 12, 0.600, 1.000, 0.298, null),
  -- Edge case: archived, but Café Lila's schedule still references it.
  ('Retired Ginger Bar','GIN-01', 'bar', 12, 0.500, 0.900, 0.220, now() - interval '20 days');

-- ── Recipes. Almond Crunch is hand-checkable: ───────────────────────────
--   40g oats    × (2.400 / 1000) = 0.096
--   10g almonds × (6.000 /  500) = 0.120
--                                  ------
--                                   0.216   ← matches unit_cost above
insert into public.product_ingredients (product_id, ingredient_id, quantity)
select p.id, i.id, v.qty
from (values
  ('Almond Crunch Bar', 'Rolled oats',        40),
  ('Almond Crunch Bar', 'Almonds',            10),
  ('Cacao Date Bar',    'Rolled oats',        35),
  ('Cacao Date Bar',    'Medjool dates',      20),
  ('Cacao Date Bar',    'Cacao powder',        5),
  ('Peanut Power Bar',  'Rolled oats',        35),
  ('Peanut Power Bar',  'Peanut butter',      20),
  ('Peanut Power Bar',  'Honey',              10),
  ('Coconut Chia Bar',  'Rolled oats',        30),
  ('Coconut Chia Bar',  'Desiccated coconut', 15),
  ('Coconut Chia Bar',  'Chia seeds',          5),
  ('Coconut Chia Bar',  'Coconut oil',        10),
  ('Double Choc Bar',   'Rolled oats',        30),
  ('Double Choc Bar',   'Dark chocolate',     20),
  ('Double Choc Bar',   'Cacao powder',        5)
) as v(product, ingredient, qty)
join public.products    p on p.name = v.product
join public.ingredients i on i.name = v.ingredient;
```

- [ ] **Step 3: Append the 15 customers, covering every status and edge case**

```sql
-- ── 15 customers across every status ────────────────────────────────────
insert into public.customers
  (name, type, status, email, phone, address_line1, city, postcode,
   delivery_notes, source, price_tier, notes, archived_at, created_at)
values
  ('Café Lila',        'business','active',   'hello@cafelila.bh','+973 3300 1101','12 Road 4','Manama','317','Back door, ask for Sam, before 9am','Referral','wholesale',null,null, now() - interval '8 months'),
  ('Iron Gym Riffa',   'business','active',   'front@irongym.bh', '+973 3300 1102','Bldg 88','Riffa','931','Leave at reception','Cold call','wholesale',null,null, now() - interval '7 months'),
  ('Deli Nine',        'business','active',   'orders@deli9.bh',  '+973 3300 1103','Shop 9, Block 3','Manama','316',null,'Market stall','wholesale',null,null, now() - interval '6 months'),
  ('The Bean Room',    'business','active',   'hi@beanroom.bh',   '+973 3300 1104','Road 2801','Seef','428','Ring the bell twice','Instagram','wholesale',null,null, now() - interval '6 months'),
  -- EDGE: 4 orders, last one long past their usual gap → MUST be at risk.
  ('Corner Coffee',    'business','active',   'kate@cornercof.bh','+973 3300 1105','Road 15','Muharraq','207',null,'Walk-in','wholesale','Went quiet after the summer',null, now() - interval '10 months'),
  -- EDGE: exactly two orders → must NEVER be at risk.
  ('Studio Pilates',   'business','active',   'admin@studiop.bh', '+973 3300 1106','Villa 4','Saar','515',null,'Referral','wholesale',null,null, now() - interval '3 months'),
  ('Nadia Al-Sayed',   'individual','active',  'nadia@example.com','+973 3300 1107','Flat 3, Bldg 12','Manama','318',null,'Instagram','retail',null,null, now() - interval '4 months'),
  ('Omar Khalid',      'individual','active',  'omar@example.com', '+973 3300 1108','Villa 22','Budaiya','545',null,'Event','retail',null,null, now() - interval '2 months'),
  ('Green Grocer',     'business','sampling',  'buy@greengrocer.bh','+973 3300 1109','Unit 7','Manama','305',null,'Sample drop','wholesale','Two samples dropped, waiting',null, now() - interval '2 months'),
  ('Harbour Hotel',    'business','sampling',  'fb@harbourhotel.bh','+973 3300 1110','Marina','Manama','321',null,'Referral','wholesale',null,null, now() - interval '1 month'),
  ('Fit Kitchen',      'business','contacted', 'info@fitkitchen.bh','+973 3300 1111',null,'Riffa','932',null,'Cold call','wholesale',null,null, now() - interval '6 weeks'),
  ('Souq Snacks',      'business','lead',      null,               '+973 3300 1112',null,'Manama','304',null,'Walk-in','wholesale',null,null, now() - interval '3 weeks'),
  -- EDGE: a lead with no orders → must NEVER be at risk.
  ('Tower Offices',    'business','lead',      'office@tower.bh',  null,             null,'Seef','429',null,'Instagram','wholesale',null,null, now() - interval '2 weeks'),
  ('Old Town Bakery',  'business','lost',      null,               '+973 3300 1114',null,'Muharraq','208',null,'Cold call','wholesale','Makes their own now',null, now() - interval '9 months'),
  -- EDGE: archived, with plenty of orders → must NEVER be at risk.
  ('Sunset Juice Bar', 'business','lapsed',    'hi@sunsetjuice.bh','+973 3300 1115','Road 90','Manama','322',null,'Market stall','wholesale','Closed for refurbishment', now() - interval '30 days', now() - interval '11 months');

-- ── Contacts, one primary per customer ──────────────────────────────────
insert into public.contacts (customer_id, name, role, email, phone, is_primary)
select c.id, v.name, v.role, v.email, v.phone, true
from (values
  ('Café Lila',      'Sam Habib',    'Owner',       'sam@cafelila.bh',    '+973 3900 1101'),
  ('Iron Gym Riffa', 'Dana Yusuf',   'Manager',     'dana@irongym.bh',    '+973 3900 1102'),
  ('Deli Nine',      'Rashid Ali',   'Buyer',       'rashid@deli9.bh',    '+973 3900 1103'),
  ('The Bean Room',  'Layla Noor',   'Owner',       'layla@beanroom.bh',  '+973 3900 1104'),
  ('Corner Coffee',  'Kate Brennan', 'Owner',       'kate@cornercof.bh',  '+973 3900 1105'),
  ('Studio Pilates', 'Mariam Zayed', 'Studio lead', 'mariam@studiop.bh',  '+973 3900 1106'),
  ('Green Grocer',   'Hasan Fadel',  'Buyer',       'hasan@greengrocer.bh','+973 3900 1109'),
  ('Harbour Hotel',  'Chef Pierre',  'F&B manager', 'pierre@harbourhotel.bh','+973 3900 1110'),
  ('Fit Kitchen',    'Yousef Amin',  'Owner',       'yousef@fitkitchen.bh','+973 3900 1111')
) as v(customer, name, role, email, phone)
join public.customers c on c.name = v.customer;

-- A second, non-primary contact, to exercise the demotion trigger.
insert into public.contacts (customer_id, name, role, is_primary)
select c.id, 'Weekend supervisor', 'Shift lead', false
from public.customers c where c.name = 'Café Lila';

-- EDGE: a custom price for one customer only.
insert into public.customer_prices (customer_id, product_id, unit_price)
select c.id, p.id, 0.420
from public.customers c, public.products p
where c.name = 'Café Lila' and p.name = 'Almond Crunch Bar';
```

- [ ] **Step 4: Append the orders**

```sql
-- ── ~60 orders over 6 months, deterministic ─────────────────────────────
do $$
declare
  r_cust    record;
  v_week    int;
  v_order   uuid;
  v_date    date;
  v_product record;
  v_qty     int;
  v_price   numeric(12,3);
  v_seq     int := 0;
begin
  for r_cust in
    select c.id, c.name, c.price_tier,
           nullif(concat_ws(', ', c.address_line1, c.city, c.postcode), '') as address,
           c.delivery_notes
    from public.customers c
    where c.name in (
      'Café Lila','Iron Gym Riffa','Deli Nine','The Bean Room',
      'Corner Coffee','Nadia Al-Sayed','Sunset Juice Bar'
    )
  loop
    for v_week in 0..23 loop
      -- Corner Coffee stops 9 weeks ago: its average gap is ~14 days, so
      -- ~63 days of silence trips risk_flag (63 > greatest(14*1.5, 45)).
      continue when r_cust.name = 'Corner Coffee' and v_week < 9;
      -- Sunset Juice Bar stopped when it closed.
      continue when r_cust.name = 'Sunset Juice Bar' and v_week < 6;
      -- Fortnightly customers.
      continue when r_cust.name in ('Deli Nine','Nadia Al-Sayed') and v_week % 2 = 1;
      -- Corner Coffee ordered fortnightly too, hence the ~14-day gap.
      continue when r_cust.name = 'Corner Coffee' and v_week % 2 = 1;

      v_date := public.f_today() - (v_week * 7);
      v_seq  := v_seq + 1;

      insert into public.orders
        (customer_id, status, ordered_on, delivery_date, delivery_address, delivery_notes_snapshot)
      values (
        r_cust.id,
        case when v_date > public.f_today() then 'confirmed' else 'delivered' end,
        v_date - 2, v_date, r_cust.address, r_cust.delivery_notes
      )
      returning id into v_order;

      -- Two or three products, chosen deterministically from the sequence.
      for v_product in
        select p.id, p.name, p.unit_cost, p.wholesale_price, p.retail_price
        from public.products p
        where p.archived_at is null
        order by p.name
        limit case when v_seq % 3 = 0 then 3 else 2 end
        offset (v_seq % 3)
      loop
        v_qty := 20 + ((v_seq + length(v_product.name)) % 5) * 10;

        select coalesce(
          cp.unit_price,
          case when r_cust.price_tier = 'retail'
               then v_product.retail_price else v_product.wholesale_price end
        ) into v_price
        from (select 1) _
        left join public.customer_prices cp
          on cp.customer_id = r_cust.id and cp.product_id = v_product.id;

        insert into public.order_items
          (order_id, product_id, product_name, quantity, unit_price, unit_cost)
        values (v_order, v_product.id, v_product.name, v_qty, v_price, v_product.unit_cost);
      end loop;
    end loop;
  end loop;
end $$;

-- EDGE: a single-line order.
do $$
declare v_order uuid; v_cust uuid; v_prod record;
begin
  select id into v_cust from public.customers where name = 'Studio Pilates';
  select id, name, wholesale_price, unit_cost into v_prod
  from public.products where name = 'Coconut Chia Bar';

  insert into public.orders (customer_id, status, ordered_on, delivery_date)
  values (v_cust, 'delivered', public.f_today() - 40, public.f_today() - 38)
  returning id into v_order;
  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
  values (v_order, v_prod.id, v_prod.name, 15, v_prod.wholesale_price, v_prod.unit_cost);

  -- EDGE: exactly two orders for this customer, so it must NOT be at risk.
  insert into public.orders (customer_id, status, ordered_on, delivery_date)
  values (v_cust, 'delivered', public.f_today() - 12, public.f_today() - 10)
  returning id into v_order;
  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
  values (v_order, v_prod.id, v_prod.name, 15, v_prod.wholesale_price, v_prod.unit_cost);
end $$;

-- EDGE: a cancelled order. It must appear nowhere in revenue or the bake list.
do $$
declare v_order uuid; v_cust uuid; v_prod record;
begin
  select id into v_cust from public.customers where name = 'The Bean Room';
  select id, name, wholesale_price, unit_cost into v_prod
  from public.products where name = 'Double Choc Bar';

  insert into public.orders (customer_id, status, ordered_on, delivery_date, notes)
  values (v_cust, 'cancelled', public.f_today() - 5, public.f_today() + 2, 'Cancelled — they double-booked')
  returning id into v_order;
  insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
  values (v_order, v_prod.id, v_prod.name, 100, v_prod.wholesale_price, v_prod.unit_cost);
end $$;

-- ── 3 recurring schedules, one referencing the archived product ─────────
do $$
declare v_sched uuid; v_cust uuid;
begin
  select id into v_cust from public.customers where name = 'Café Lila';
  insert into public.recurring_orders (customer_id, frequency, day_of_week, starts_on, notes)
  values (v_cust, 'weekly', 2, public.f_today() - 60, 'Standing Tuesday order')
  returning id into v_sched;
  insert into public.recurring_order_items (recurring_order_id, product_id, quantity)
  select v_sched, p.id, v.qty from (values ('Almond Crunch Bar', 40), ('Cacao Date Bar', 20)) v(n, qty)
  join public.products p on p.name = v.n;
  -- EDGE: an archived product still on a live schedule.
  insert into public.recurring_order_items (recurring_order_id, product_id, quantity)
  select v_sched, p.id, 10 from public.products p where p.name = 'Retired Ginger Bar';

  select id into v_cust from public.customers where name = 'Iron Gym Riffa';
  insert into public.recurring_orders (customer_id, frequency, day_of_week, starts_on)
  values (v_cust, 'fortnightly', 4, public.f_today() - 28)
  returning id into v_sched;
  insert into public.recurring_order_items (recurring_order_id, product_id, quantity)
  select v_sched, p.id, 60 from public.products p where p.name = 'Peanut Power Bar';

  select id into v_cust from public.customers where name = 'Deli Nine';
  insert into public.recurring_orders (customer_id, frequency, day_of_month, starts_on, active)
  values (v_cust, 'monthly', 15, public.f_today() - 120, true)
  returning id into v_sched;
  insert into public.recurring_order_items (recurring_order_id, product_id, quantity)
  select v_sched, p.id, 50 from public.products p where p.name = 'Coconut Chia Bar';
end $$;
```

- [ ] **Step 5: Append the interactions and invoices**

```sql
-- ── ~40 interactions ────────────────────────────────────────────────────
insert into public.interactions
  (customer_id, contact_id, occurred_at, channel, direction, subject, notes, outcome, follow_up_on, follow_up_done)
select
  c.id,
  (select id from public.contacts where customer_id = c.id and is_primary limit 1),
  now() - (v.days_ago || ' days')::interval,
  v.channel, v.direction, v.subject, v.notes, v.outcome,
  case when v.follow_up_in is null then null
       else public.f_today() + v.follow_up_in end,
  v.done
from (values
  ('Café Lila',      2,  'whatsapp',   'outbound','Weekly confirm','Confirmed Tuesday as usual.','ordered',       null, false),
  ('Café Lila',      30, 'in_person',  'outbound','Dropped off','Sam happy with the almond.','ordered',           null, false),
  ('Café Lila',      70, 'phone',      'inbound', 'Extra order','Asked for 20 extra for an event.','ordered',     null, false),
  ('Iron Gym Riffa', 5,  'email',      'outbound','New flavour','Sent the double choc sheet.','interested',        3, false),
  ('Iron Gym Riffa', 40, 'phone',      'outbound','Check in','All good.','no_response',                          null, false),
  ('Deli Nine',      8,  'phone',      'outbound','Monthly order','Confirmed the 15th.','ordered',                null, false),
  ('The Bean Room',  1,  'whatsapp',   'inbound', 'Cancelled','They double-booked their counter.','other',          7, false),
  -- Overdue follow-up: must show as Overdue on the dashboard.
  ('Corner Coffee',  20, 'phone',      'outbound','Chasing','Left a voicemail.','no_response',                     -6, false),
  ('Corner Coffee',  55, 'email',      'outbound','Summer order','No reply.','no_response',                      null, true),
  -- Due today.
  ('Green Grocer',   3,  'sample_drop','outbound','Two samples','Left almond and cacao with Hasan.','interested',   0, false),
  ('Green Grocer',   12, 'phone',      'outbound','First call','Asked us to drop samples.','follow_up',           null, true),
  ('Harbour Hotel',  6,  'sample_drop','outbound','Samples for chef','Pierre liked the peanut.','interested',       5, false),
  ('Fit Kitchen',    10, 'email',      'outbound','Intro','Sent the price list.','no_response',                     2, false),
  ('Fit Kitchen',    25, 'phone',      'outbound','Cold call','Gatekeeper took a message.','no_response',         null, true),
  ('Souq Snacks',    15, 'in_person',  'outbound','Walked in','Owner was out.','follow_up',                         1, false),
  ('Tower Offices',  9,  'email',      'outbound','Intro','No reply yet.','no_response',                          null, false),
  ('Old Town Bakery',120,'phone',      'outbound','Last try','They make their own now.','not_interested',         null, true),
  ('Nadia Al-Sayed', 14, 'whatsapp',   'inbound', 'Reorder','Wants the same again.','ordered',                    null, false),
  ('Omar Khalid',    18, 'whatsapp',   'inbound', 'First order','Found us at the market.','ordered',              null, false),
  ('Studio Pilates', 11, 'email',      'outbound','Reorder?','Asked if they want more.','interested',               4, false)
) as v(customer, days_ago, channel, direction, subject, notes, outcome, follow_up_in, done)
join public.customers c on c.name = v.customer;

-- ── 15 invoices in mixed states ─────────────────────────────────────────
do $$
declare
  r_cust  record;
  v_ids   uuid[];
  v_inv   uuid;
  v_total numeric(12,3);
  v_n     int := 0;
begin
  for r_cust in
    select distinct o.customer_id, c.name
    from public.orders o
    join public.customers c on c.id = o.customer_id
    where o.status = 'delivered'
    order by c.name
  loop
    -- Up to three invoices per customer, three delivered orders each.
    for v_n in 1..3 loop
      select array_agg(t.order_id) into v_ids
      from (
        select o.id as order_id
        from public.orders o
        where o.customer_id = r_cust.customer_id
          and o.status = 'delivered'
          and not exists (select 1 from public.invoice_orders io where io.order_id = o.id)
        order by o.delivery_date
        limit 3
      ) t;

      exit when v_ids is null or array_length(v_ids, 1) is null;
      exit when (select count(*) from public.invoices) >= 15;

      v_inv := public.f_create_invoice(
        r_cust.customer_id, v_ids,
        public.f_today() - 30 + (v_n * 7),
        public.f_today() - 16 + (v_n * 7)
      );

      update public.invoices set status = 'sent' where id = v_inv;

      select total into v_total from public.v_invoice_totals where invoice_id = v_inv;

      if v_n = 1 then
        -- Paid in full.
        insert into public.payments (invoice_id, paid_on, amount, method, reference)
        values (v_inv, public.f_today() - 20, v_total, 'bank_transfer', 'TRF-' || v_n);
      elsif v_n = 2 then
        -- EDGE: partially paid. Must read `sent`, not `paid`.
        insert into public.payments (invoice_id, paid_on, amount, method, reference)
        values (v_inv, public.f_today() - 10, round(v_total / 2, 3), 'cash', null);
      end if;
      -- v_n = 3 is left unpaid, and its due date is in the past → overdue.
    end loop;
  end loop;
end $$;

-- EDGE: a voided invoice. Its orders are released and can be re-invoiced.
do $$
declare v_inv uuid;
begin
  select invoice_id into v_inv
  from public.v_invoice_totals
  where computed_status = 'overdue'
  order by invoice_number
  limit 1;

  if v_inv is not null then
    perform public.f_void_invoice(v_inv);
  end if;
end $$;

-- Generate upcoming orders from the schedules, so the production page has
-- something in it.
select public.f_generate_scheduled_orders(public.f_today() + 21);
```

- [ ] **Step 6: Run it**

Via MCP `execute_sql`, in **one** call so the `set` and the file share a session:

```sql
set app.seed_confirmed = 'yes-destroy-all-data';
-- …then the whole of seed.sql, minus its psql meta-commands…
```

- [ ] **Step 7: Sanity-check the shape**

```sql
select
  (select count(*) from public.customers)           as customers,
  (select count(*) from public.products)            as products,
  (select count(*) from public.ingredients)         as ingredients,
  (select count(*) from public.product_ingredients) as recipe_lines,
  (select count(*) from public.orders)              as orders,
  (select count(*) from public.order_items)         as order_items,
  (select count(*) from public.recurring_orders)    as schedules,
  (select count(*) from public.invoices)            as invoices,
  (select count(*) from public.payments)            as payments,
  (select count(*) from public.interactions)        as interactions;
```

Expected roughly: 15 customers, 6 products, 12 ingredients, 15 recipe lines, 60+ orders, 3 schedules, up to 15 invoices, 20 interactions. Exact order counts depend on the generator; what matters is that every edge case below exists.

- [ ] **Step 8: Confirm every named edge case landed**

```sql
select 'custom price'        as edge, count(*) from public.customer_prices
union all select 'single-line order',   count(*) from (select order_id from public.order_items group by order_id having count(*) = 1) t
union all select 'partially paid',      count(*) from public.v_invoice_totals where amount_paid > 0 and amount_paid < total
union all select 'voided invoice',      count(*) from public.invoices where status = 'void'
union all select 'cancelled order',     count(*) from public.orders where status = 'cancelled'
union all select 'exactly two orders',  count(*) from public.v_customer_summary where order_count = 2
union all select 'archived customer',   count(*) from public.customers where archived_at is not null
union all select 'archived product on a schedule', count(*)
  from public.recurring_order_items roi
  join public.products p on p.id = roi.product_id where p.archived_at is not null
union all select 'at-risk customer',    count(*) from public.v_customer_summary where risk_flag
union all select 'overdue follow-up',   count(*) from public.v_follow_ups_due where is_overdue;
```

Expected: **every row is at least 1.** Any zero means that edge case is untested — fix the seed before continuing.

- [ ] **Step 9: Commit**

```bash
git add supabase/seed.sql
git commit -m "test(seed): deterministic seed with every documented edge case and a destructive-run guard"
```

---

## Task 8.2: Run the full assertion suite

**Files:**
- Modify: `supabase/verify.sql`

- [ ] **Step 1: Add the final cross-cutting assertions**

Append a Phase 8 block:

```sql
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
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and pg_get_functiondef(p.oid) ~* '\mcurrent_date\M';
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

  if v_orders <> v_summary then
    raise exception 'P8.7 FAIL: order revenue % <> customer summary revenue %', v_orders, v_summary;
  end if;
  if v_orders <> v_products then
    raise exception 'P8.7 FAIL: order revenue % <> product performance revenue %', v_orders, v_products;
  end if;
end $$;

do $$ begin raise notice 'verify.sql: ALL ASSERTIONS PASSED'; end $$;
```

P8.7 is the strongest single check in the suite: three independent SQL paths must agree on one number.

- [ ] **Step 2: Run the whole file** via MCP `execute_sql` (strip the `\set` line).

Expected: the final notice, `verify.sql: ALL ASSERTIONS PASSED`, and **no exception**. Fix any failure before continuing — a failing assertion is a real bug, not a seed artefact.

- [ ] **Step 3: Note the psql path**

The file still runs unchanged under `npm run db:verify` once Docker and psql are installed. Confirm it starts with `\set ON_ERROR_STOP on`.

- [ ] **Step 4: Commit**

```bash
git add supabase/verify.sql
git commit -m "test(db): RLS, grants, security-definer, timezone and cross-path revenue assertions"
```

---

## Task 8.3: Reconcile by hand

Spec §7 Phase 8 step 3. **Any mismatch is a bug in the SQL, not a rounding quirk — find it.**

- [ ] **Step 1: Pull the figures**

```sql
select
  (select coalesce(sum(subtotal),0) from public.v_order_totals
     where status in ('confirmed','in_production','delivered'))              as total_revenue,
  (select coalesce(sum(subtotal),0) from public.v_order_totals
     where status in ('confirmed','in_production','delivered')
       and delivery_date >= date_trunc('month', public.f_today()::timestamp)::date) as revenue_this_month,
  (select lifetime_revenue from public.v_customer_summary where name = 'Café Lila') as cafe_lila_ltv,
  (select coalesce(sum(balance),0) from public.v_invoice_totals
     where computed_status in ('sent','overdue'))                            as outstanding;
```

- [ ] **Step 2: Rebuild them in a spreadsheet**

Export the raw rows and recompute independently:

```sql
select o.id, c.name, o.status, o.delivery_date, oi.product_name,
       oi.quantity, oi.unit_price, oi.line_total
from public.orders o
join public.customers  c on c.id = o.customer_id
join public.order_items oi on oi.order_id = o.id
order by c.name, o.delivery_date;
```

In the spreadsheet: `SUMIFS` over `line_total` where status is one of the three counted values. Compare to `total_revenue`.

- [ ] **Step 3: Reconcile every one of the four figures**

- [ ] `total_revenue` matches the spreadsheet exactly
- [ ] `revenue_this_month` matches a spreadsheet filter on the delivery month
- [ ] `cafe_lila_ltv` matches a filter on that one customer
- [ ] `outstanding` matches `Σ(invoice total) − Σ(payments)` over non-void, non-fully-paid invoices

Record the four numbers in the PR description. If a later change moves one of them, you will know.

- [ ] **Step 4: Also reconcile one week's bake list**

Pick a week, list its orders from the spreadsheet, sum the quantity per product, and compare to `f_bake_list` for the same dates. They must be identical.

---

## Task 8.4: Money precision audit

Spec §7 Phase 8 step 4.

- [ ] **Step 1: Grep for the forbidden patterns**

```bash
grep -rnE "toFixed|parseFloat" src --include="*.ts" --include="*.tsx" | grep -v "src/lib/format.ts" | grep -v "\.test\.ts"
```

Expected: only these, each justified in a comment at the call site:
- `margin-readout.tsx` — `pct.toFixed(1)`, a **percentage**, not money
- `product-performance-table.tsx` — same
- `recipe-editor.tsx` — `computed.toFixed(3)`, serialising a number for a `numeric(12,3)` column, not display

**Anything else is a bug.** Route it through `<Money />` or `formatMoney`.

- [ ] **Step 2: Grep for raw `Number()` on money outside `lib/`**

```bash
grep -rnE "Number\((row|item|invoice|order|p|i|r)\.[a-z_]*(price|cost|total|amount|balance|revenue|subtotal|charge|discount)" src/app src/components
```

Expected: empty. Each hit should use `parseMoney` from `src/lib/format.ts`.

- [ ] **Step 3: Confirm no monetary column is a float**

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (column_name ~ 'price|cost|amount|total|charge|discount|revenue|margin')
order by table_name, column_name;
```

Expected: every row reads `numeric`. **No `double precision`, no `real`.** Assertion P2.3 already checks this; do it by eye once as well.

- [ ] **Step 4: Confirm three-decimal rendering end to end**

With `currency_decimals = 3`, an invoice for `BD 20.000` must render as `BD 20.000` on the list, the detail and the print route — never `BD 20.00` or `BD 20`.

---

## Task 8.5: Idempotency test

- [ ] **Step 1: Run generation five times and count**

```sql
select count(*) as before from public.orders where recurring_order_id is not null;
select * from public.f_generate_scheduled_orders(public.f_today() + 21);
select * from public.f_generate_scheduled_orders(public.f_today() + 21);
select * from public.f_generate_scheduled_orders(public.f_today() + 21);
select * from public.f_generate_scheduled_orders(public.f_today() + 21);
select * from public.f_generate_scheduled_orders(public.f_today() + 21);
select count(*) as after from public.orders where recurring_order_id is not null;
```

Expected: `after = before`, every call reports `created_count = 0`, and **no call errors**. ✅

- [ ] **Step 2: The same through the UI**

Press "Generate upcoming orders" on `/schedules` five times. Every run after the first reports `Created 0`, and the archived-product warning naming *Retired Ginger Bar* appears each time. ✅

---

## Task 8.6: RLS test — tables, views AND functions

Spec §7 Phase 8 step 6. **Views are the likely failure**, because they bypass RLS unless created `with (security_invoker = on)`.

**Files:**
- Create: `scripts/rls-probe.sh`

- [ ] **Step 1: Write the probe**

Create `scripts/rls-probe.sh`:

```bash
#!/usr/bin/env bash
# Unauthenticated probe against the public REST API. No session, only the
# publishable key — which ships in the browser bundle by design.
# Every endpoint must return no data.
set -u

URL="${NEXT_PUBLIC_SUPABASE_URL:?set NEXT_PUBLIC_SUPABASE_URL}"
KEY="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}"

fail=0

probe() {
  local path="$1" method="${2:-GET}" body="${3:-}"
  local out
  if [ "$method" = "POST" ]; then
    out=$(curl -s -X POST "$URL/rest/v1/$path" \
      -H "apikey: $KEY" -H "Content-Type: application/json" -d "$body")
  else
    out=$(curl -s "$URL/rest/v1/$path" -H "apikey: $KEY")
  fi

  if [ "$out" = "[]" ] || echo "$out" | grep -qiE '"(code|message|error)"'; then
    echo "PASS  $path"
  else
    echo "FAIL  $path  -> ${out:0:200}"
    fail=1
  fi
}

echo "── Tables ──"
for t in customers contacts interactions products customer_prices ingredients \
         product_ingredients orders order_items recurring_orders \
         recurring_order_items invoices invoice_orders payments \
         app_settings profiles signup_allowlist; do
  probe "$t?select=*&limit=1"
done

echo "── Views (the likely failure) ──"
for v in v_customer_list v_follow_ups_due v_product_costs v_effective_prices \
         v_order_totals v_order_list v_delivery_schedule v_invoice_totals \
         v_invoice_list v_uninvoiced_orders v_customer_summary; do
  probe "$v?select=*&limit=1"
done

echo "── Functions ──"
probe "rpc/f_today" POST '{}'
probe "rpc/f_bake_list" POST '{"p_from":"2000-01-01","p_to":"2100-01-01"}'
probe "rpc/f_shopping_list" POST '{"p_from":"2000-01-01","p_to":"2100-01-01"}'
probe "rpc/f_product_performance" POST '{"p_from":"2000-01-01","p_to":"2100-01-01"}'
probe "rpc/f_revenue_by_month" POST '{"p_months":12}'
probe "rpc/f_new_customers_by_month" POST '{"p_months":12}'
probe "rpc/f_outreach_effectiveness" POST '{"p_from":"2000-01-01","p_to":"2100-01-01"}'
probe "rpc/f_generate_scheduled_orders" POST '{"p_until":"2100-01-01"}'
probe "rpc/f_create_invoice" POST '{"p_customer_id":"00000000-0000-4000-8000-000000000000","p_order_ids":[],"p_issued_on":"2026-01-01","p_due_on":"2026-01-15"}'
probe "rpc/f_void_invoice" POST '{"p_invoice_id":"00000000-0000-4000-8000-000000000000"}'

echo "── Writes ──"
probe "customers" POST '{"name":"RLS probe should not exist"}'

if [ "$fail" -eq 0 ]; then
  echo "ALL RLS PROBES PASSED"
else
  echo "RLS PROBES FAILED — fix before shipping"
  exit 1
fi
```

- [ ] **Step 2: Run it with the app not running**

```bash
set -a && . ./.env.local && set +a && bash scripts/rls-probe.sh
```

Expected: every line reads `PASS`, ending in `ALL RLS PROBES PASSED`.

**If a view returns data, it is missing `with (security_invoker = on)`.** Fix it in a new migration — do not edit the old one — and re-run.

- [ ] **Step 3: Confirm nothing was written**

```sql
select count(*) from public.customers where name = 'RLS probe should not exist';
```

Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/rls-probe.sh
git commit -m "test(security): unauthenticated probe over every table, view and function"
```

---

## Task 8.7: Advisors

- [ ] **Step 1: Run both**

Call MCP `get_advisors` with `type: "security"`, then `type: "performance"`.

- [ ] **Step 2: Resolve or record every finding**

Create `docs/advisor-findings.md` with one row per finding: the check, the object, and either the migration that fixed it or the reason it is accepted.

Expected accepted findings:
- **`f_handle_new_user` is SECURITY DEFINER** — intentional. Correction C4: the `auth.users` trigger runs under a role with no write access to `public`. It has `set search_path = ''`, takes no user input, and writes one row.
- **`app_settings` has an unindexed foreign key** — it has none, so this should not appear; if it does, read it carefully.

Everything else — especially anything about RLS, exposed views, or missing indexes on foreign keys — gets a **new migration**, never an edit to an old one.

- [ ] **Step 3: Re-run both advisors** until only the recorded findings remain.

- [ ] **Step 4: Commit**

```bash
git add docs/advisor-findings.md supabase/migrations
git commit -m "chore(db): resolve advisor findings; record the one intentional exception"
```

---

## Task 8.8: Type check and build

- [ ] **Step 1: Type check** → `npm run typecheck` → clean.

- [ ] **Step 2: No escape hatches**

```bash
grep -rnE ":\s*any\b|as any\b|@ts-ignore|@ts-expect-error" src --include="*.ts" --include="*.tsx"
```

Expected: empty. Spec §8: *"If a type is hard, the model is probably wrong."*

Note that `src/lib/database.types.ts` is generated and exempt — exclude it if it produces noise, but do not silence real hits in hand-written code.

- [ ] **Step 3: Build** → `npm run build` → succeeds with no errors and no new warnings.

- [ ] **Step 4: Unit tests** → `npm test` → all pass.

Expected suite size, roughly: 8 format + 4 parseMoney + 4 auth + 7 settings + 9 customers + 11 interactions + 6 products + 11 pricing + 12 recurrence + 9 orders + 6 week + 11 invoices + 8 period + 7 aliases + 8 CSV.

- [ ] **Step 5: Lint** → `npm run lint` → clean. (`next lint` was removed in Next 16; the script calls ESLint directly.)

---

## Task 8.9: Cold-start walkthrough, automated

Spec §7 Phase 8 step 9: reset to an empty database and complete the whole journey without touching SQL.

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/cold-start.spec.ts`
- Create: `.env.test.local` (gitignored)

- [ ] **Step 1: The config**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one shared database
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Spec §6.6 gives phone and laptop equal weight, so the journey runs
    // on both. A pass on desktop only is half a pass.
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
})
```

- [ ] **Step 2: Credentials**

Create `.env.test.local` (add `.env.test.local` to `.gitignore`):

```
E2E_EMAIL=vivaankavalani11@gmail.com
E2E_PASSWORD=<the dev account password>
```

**Never commit this.** Confirm with `git check-ignore -v .env.test.local`.

- [ ] **Step 3: The journey**

Create `e2e/cold-start.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

/**
 * Spec §7 Phase 8 step 9: the full journey from an empty database, using
 * only the UI. Every step must be discoverable — if a locator here needs a
 * URL typed by hand, that step is not discoverable and it is a bug.
 *
 * Run this against a FRESH database (truncate via seed.sql's wipe block,
 * without the seed inserts), not against seeded data.
 */

const STAMP = process.env.E2E_STAMP ?? 'E2E'
const CUSTOMER = `${STAMP} Test Café`
const PRODUCT = `${STAMP} Test Bar`
const INGREDIENT = `${STAMP} Test Oats`

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL!)
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL('/')
})

test('a signed-out visitor is sent to the login page', async ({ browser }) => {
  const anon = await browser.newContext()
  const page = await anon.newPage()
  await page.goto('/customers')
  await expect(page).toHaveURL(/\/login/)
  await anon.close()
})

test('cold start: customer to payment, entirely through the UI', async ({ page }) => {
  // ── 1. Add a customer ────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Customers' }).click()
  await page.getByRole('link', { name: /new customer/i }).click()
  await page.getByLabel('Name').fill(CUSTOMER)
  await page.getByRole('button', { name: /create customer/i }).click()
  await expect(page.getByRole('heading', { name: CUSTOMER })).toBeVisible()

  // ── 2. Log an interaction with a follow-up ───────────────────────────
  await page.getByRole('button', { name: /log interaction/i }).click()
  await page.getByRole('radio', { name: 'Phone' }).click()
  await page.getByLabel('What happened?').fill('Cold-start walkthrough call.')
  await page.getByRole('radio', { name: 'Interested' }).click()
  await page.getByRole('button', { name: 'In 3 days' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('tab', { name: /activity/i }).click()
  await expect(page.getByText('Cold-start walkthrough call.')).toBeVisible()

  // ── 3. Add an ingredient and a product with a recipe ─────────────────
  await page.getByRole('link', { name: 'Ingredients' }).click()
  await page.getByRole('button', { name: /new ingredient|add your first ingredient/i }).click()
  await page.getByLabel('Name').fill(INGREDIENT)
  await page.getByLabel('Unit').fill('g')
  await page.getByLabel('Pack size').fill('1000')
  await page.getByLabel('Pack cost').fill('2.400')
  await page.getByRole('button', { name: /add ingredient|save/i }).click()
  await expect(page.getByText(INGREDIENT)).toBeVisible()

  await page.getByRole('link', { name: 'Products' }).click()
  await page.getByRole('link', { name: /new product|add your first product/i }).click()
  await page.getByLabel('Name').fill(PRODUCT)
  await page.getByLabel('Cost per unit').fill('0.250')
  await page.getByLabel('Wholesale price').fill('0.500')
  // Margin must appear live, before saving.
  await expect(page.getByText('50.0%')).toBeVisible()
  await page.getByRole('button', { name: /create product/i }).click()
  await expect(page.getByRole('heading', { name: PRODUCT })).toBeVisible()

  await page.getByRole('button', { name: /add ingredient/i }).click()
  await page.getByRole('combobox', { name: /ingredient/i }).click()
  await page.getByRole('option', { name: new RegExp(INGREDIENT) }).click()
  await page.getByLabel(/quantity per/i).fill('40')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('0.096')).toBeVisible() // 40 × 2.400/1000

  // ── 4. Create an order ───────────────────────────────────────────────
  await page.getByRole('link', { name: 'Orders' }).click()
  await page.getByRole('link', { name: /new order|create the first order/i }).click()
  await page.getByRole('combobox', { name: /customer/i }).click()
  await page.getByRole('option', { name: CUSTOMER }).click()
  await page.getByRole('button', { name: /add product/i }).click()
  await page.getByRole('option', { name: new RegExp(PRODUCT) }).click()
  await page.getByRole('button', { name: /increase quantity/i }).click()
  await page.getByRole('button', { name: /create order/i }).click()
  await expect(page.getByRole('heading', { name: /order #/i })).toBeVisible()

  // ── 5. The order reaches the bake list ───────────────────────────────
  await page.getByRole('link', { name: 'Production' }).click()
  await expect(page.getByText(PRODUCT)).toBeVisible()
  // And so does the shopping list, through the recipe.
  await expect(page.getByText(INGREDIENT)).toBeVisible()

  // ── 6. Mark it delivered ─────────────────────────────────────────────
  await page.getByRole('link', { name: 'Orders' }).click()
  await page.getByRole('row', { name: new RegExp(CUSTOMER) }).click()
  await page.getByRole('combobox', { name: /status/i }).click()
  await page.getByRole('option', { name: 'Delivered' }).click()
  await expect(page.getByText('Delivered')).toBeVisible()

  // ── 7. Invoice it ────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Invoices' }).click()
  await page.getByRole('link', { name: /new invoice|create the first invoice/i }).click()
  await page.getByText(CUSTOMER).click()
  await page.getByRole('button', { name: /create invoice/i }).click()
  await expect(page.getByRole('heading', { name: /invoice inv-/i })).toBeVisible()

  // ── 8. Record the payment ────────────────────────────────────────────
  await page.getByRole('button', { name: /mark sent/i }).click()
  await page.getByRole('button', { name: /record payment/i }).click()
  await page.getByRole('button', { name: /save|record/i }).click()
  await expect(page.getByText('Paid')).toBeVisible()
})

test('no screen scrolls horizontally on a phone', async ({ page }) => {
  for (const path of [
    '/', '/customers', '/orders', '/schedules', '/production',
    '/invoices', '/products', '/ingredients', '/insights', '/settings',
  ]) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows, `${path} scrolls horizontally`).toBe(false)
  }
})
```

- [ ] **Step 4: Reset to empty and run**

Run the wipe block from `seed.sql` (the guard plus the `truncate`, **without** the inserts) via MCP `execute_sql`. Then:

```bash
npx playwright test
```

Expected: green on **both** the desktop and mobile projects.

**A failing locator is a real finding, not a test bug.** If `getByRole('link', { name: /new customer/i })` cannot find the button, that step is not discoverable from the UI and spec §7 Phase 8 step 9 has failed. Fix the app, not the selector.

- [ ] **Step 5: Re-seed**

Re-run `seed.sql` in full so the database has demo data for Task 8.10.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e .gitignore
git commit -m "test(e2e): cold-start walkthrough and mobile overflow check on desktop and phone"
```

---

## Task 8.10: The real test

Spec §7 Phase 8 step 10. Nothing above substitutes for this.

- [ ] **Step 1: Set up**

Deploy the current branch. Open the app on **her** phone, signed in, on the dashboard. Have a notebook.

- [ ] **Step 2: Give exactly two instructions, then stop talking**

> "Add a customer."

> "Now log a call with them."

- [ ] **Step 3: Watch. Do not help.**

Not a hint, not a pointed look. Write down:
- every pause longer than two seconds, and what she was looking at
- every tap that did not do what she expected
- every word on screen she read twice
- every moment she looked up at you

- [ ] **Step 4: Ask three questions afterwards**

1. "What did you expect to happen when you tapped that?"
2. "Was there anything you were looking for and could not find?"
3. "What would you call this thing?" (pointing at whatever she hesitated over)

Her vocabulary goes into `NAV_ALIASES` in `src/lib/aliases.ts`.

- [ ] **Step 5: Every hesitation is a bug. Write them down and fix them.**

Create `docs/usability-findings.md`: what she did, what she expected, what happened, and the fix. Then fix them. This list is more valuable than every assertion in `verify.sql` — those prove the numbers are right, this proves the app gets used.

- [ ] **Step 6: Commit**

```bash
git add docs/usability-findings.md
git commit -m "docs: usability findings from the first real session"
```

---

## Task 8.11: Ship

- [ ] **Step 1: Final gate — every line must pass**

- [ ] `npm run typecheck` → clean
- [ ] `npm test` → all pass
- [ ] `npm run lint` → clean
- [ ] `npm run build` → succeeds
- [ ] `npx playwright test` → green on desktop **and** mobile
- [ ] `verify.sql` → `ALL ASSERTIONS PASSED`
- [ ] `scripts/rls-probe.sh` → `ALL RLS PROBES PASSED`
- [ ] Security Advisor: only the recorded `f_handle_new_user` exception
- [ ] Performance Advisor: every finding fixed or recorded
- [ ] The four hand-reconciled figures match the spreadsheet
- [ ] The money grep returns only the three justified percentage/serialisation hits
- [ ] No `any`, no `@ts-ignore` in hand-written code
- [ ] Generation five times changes nothing
- [ ] Every usability finding from Task 8.10 is fixed or explicitly deferred with a reason

- [ ] **Step 2: Clean the demo data out of production**

If the seed ran against the real project, wipe it before she starts entering real customers:

```sql
set app.seed_confirmed = 'yes-destroy-all-data';
-- then only the truncate block from seed.sql, with none of the inserts
```

Then re-check: `select count(*) from public.customers;` → `0`. And `select next_invoice_number from public.app_settings;` → `1`.

- [ ] **Step 3: Merge and deploy**

```bash
gh pr create --title "Phase 8 — Verification" --body "Seed data, full assertion suite, RLS probes, cold-start e2e, advisor findings, first usability session."
```

Merge every phase branch to `main` in order, confirm the Vercel production deployment is green, and log in on the production URL one final time.

- [ ] **Step 4: Hand over**

Confirm with her:
- [ ] She can sign in on her phone and on the laptop
- [ ] Settings holds the real business name, address, currency and bank details
- [ ] `signup_allowlist` contains only the two real addresses
- [ ] She knows the bake list prints, and has printed one
- [ ] She knows "Generate upcoming orders" is a button she presses, not magic that happens
