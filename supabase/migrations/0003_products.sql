-- 0003_products.sql
-- Catalogue, per-customer pricing overrides, ingredients and recipes.

-- ────────────────────────────────────────────────────────────────────────
-- products
--
-- There is NO `active` boolean. Availability is `archived_at is null`,
-- exactly as for customers. A second soft-delete flag would immediately
-- disagree with the first one.
-- ────────────────────────────────────────────────────────────────────────
create table public.products (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  sku             text unique,
  description     text,
  unit            text not null default 'bar'
                       check (unit in ('bar','box','tray')),
  units_per_box   int  not null default 1 check (units_per_box > 0),
  wholesale_price numeric(12,3) not null default 0 check (wholesale_price >= 0),
  retail_price    numeric(12,3) not null default 0 check (retail_price    >= 0),
  unit_cost       numeric(12,3) not null default 0 check (unit_cost       >= 0),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_products_archived_at on public.products (archived_at);
create index idx_products_name_lower  on public.products (lower(name));

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- customer_prices — an override. No row means fall back to the tier price.
-- ────────────────────────────────────────────────────────────────────────
create table public.customer_prices (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id  uuid not null references public.products(id)  on delete cascade,
  unit_price  numeric(12,3) not null check (unit_price >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (customer_id, product_id)
);

create index idx_customer_prices_customer on public.customer_prices (customer_id);
create index idx_customer_prices_product  on public.customer_prices (product_id);

create trigger trg_customer_prices_updated_at
  before update on public.customer_prices
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- ingredients
--
-- pack_size is not null and strictly positive because the shopping list
-- divides by it: a null would silently null out the row, a zero would raise
-- division_by_zero and take down the whole production page.
-- ────────────────────────────────────────────────────────────────────────
create table public.ingredients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  unit       text not null,                             -- 'g', 'ml', 'each'
  pack_size  numeric(12,3) not null default 1 check (pack_size > 0),
  pack_cost  numeric(12,3) not null default 0 check (pack_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_ingredients_updated_at
  before update on public.ingredients
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- product_ingredients — quantity per ONE products.unit.
--
-- Quantities are always in products.unit and units_per_box is display-only.
-- If this is ever per-box, the bake list is wrong by a factor of
-- units_per_box and nobody notices until the flour runs out.
--
-- on delete restrict on ingredient_id: deleting an ingredient that is in a
-- recipe must fail loudly rather than silently re-costing every product.
-- ────────────────────────────────────────────────────────────────────────
create table public.product_ingredients (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id)    on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity      numeric(12,3) not null check (quantity > 0),
  created_at    timestamptz not null default now(),
  unique (product_id, ingredient_id)
);

create index idx_product_ingredients_product    on public.product_ingredients (product_id);
create index idx_product_ingredients_ingredient on public.product_ingredients (ingredient_id);

-- ────────────────────────────────────────────────────────────────────────
-- v_product_costs — recipe cost per one unit, computed in SQL.
-- If you find yourself summing an array in TypeScript, stop and write a
-- view. This is that view.
-- ────────────────────────────────────────────────────────────────────────
create view public.v_product_costs
with (security_invoker = on) as
select
  p.id                                        as product_id,
  p.unit_cost                                 as stated_unit_cost,
  coalesce(r.recipe_cost, 0)::numeric(12,3)   as recipe_cost,
  coalesce(r.ingredient_count, 0)             as ingredient_count
from public.products p
left join lateral (
  select
    sum(pi.quantity * (i.pack_cost / i.pack_size)) as recipe_cost,
    count(*)                                       as ingredient_count
  from public.product_ingredients pi
  join public.ingredients i on i.id = pi.ingredient_id
  where pi.product_id = p.id
) r on true;

revoke all on public.v_product_costs from anon;

-- ────────────────────────────────────────────────────────────────────────
-- v_effective_prices — the price every customer pays for every product,
-- with its source. The single SQL source of truth that resolvePrices reads.
--
-- A cross join of customers x products. With ~50 customers and ~10 products
-- that is 500 rows, and it is always queried with both ids filtered, so
-- Postgres never materialises the whole thing.
-- ────────────────────────────────────────────────────────────────────────
create view public.v_effective_prices
with (security_invoker = on) as
select
  c.id                            as customer_id,
  p.id                            as product_id,
  p.name                          as product_name,
  p.unit                          as product_unit,
  p.unit_cost                     as unit_cost,
  p.wholesale_price               as wholesale_price,
  p.retail_price                  as retail_price,
  cp.unit_price                   as custom_price,
  c.price_tier                    as price_tier,
  coalesce(
    cp.unit_price,
    case when c.price_tier = 'retail' then p.retail_price else p.wholesale_price end
  )                               as effective_price,
  case
    when cp.unit_price is not null then 'custom'
    when c.price_tier = 'retail'   then 'retail'
    else 'wholesale'
  end                             as price_source,
  p.archived_at                   as product_archived_at
from public.customers c
cross join public.products p
left join public.customer_prices cp
  on cp.customer_id = c.id and cp.product_id = p.id;

revoke all on public.v_effective_prices from anon;

-- ────────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────────
alter table public.products            enable row level security;
alter table public.customer_prices     enable row level security;
alter table public.ingredients         enable row level security;
alter table public.product_ingredients enable row level security;

create policy "app users have full access" on public.products
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));

create policy "app users have full access" on public.customer_prices
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));

create policy "app users have full access" on public.ingredients
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));

create policy "app users have full access" on public.product_ingredients
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));
