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
  -- follow_up_done requires a follow_up_on date (app invariant, P1.4); these
  -- four had no follow-up scheduled, so they stay "not done".
  ('Corner Coffee',  55, 'email',      'outbound','Summer order','No reply.','no_response',                      null, false),
  -- Due today.
  ('Green Grocer',   3,  'sample_drop','outbound','Two samples','Left almond and cacao with Hasan.','interested',   0, false),
  ('Green Grocer',   12, 'phone',      'outbound','First call','Asked us to drop samples.','follow_up',           null, false),
  ('Harbour Hotel',  6,  'sample_drop','outbound','Samples for chef','Pierre liked the peanut.','interested',       5, false),
  ('Fit Kitchen',    10, 'email',      'outbound','Intro','Sent the price list.','no_response',                     2, false),
  ('Fit Kitchen',    25, 'phone',      'outbound','Cold call','Gatekeeper took a message.','no_response',         null, false),
  ('Souq Snacks',    15, 'in_person',  'outbound','Walked in','Owner was out.','follow_up',                         1, false),
  ('Tower Offices',  9,  'email',      'outbound','Intro','No reply yet.','no_response',                          null, false),
  ('Old Town Bakery',120,'phone',      'outbound','Last try','They make their own now.','not_interested',         null, false),
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
