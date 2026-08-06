# Phase 2 — Products, Pricing, Ingredients — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A product catalogue with live margin feedback, recipes that cost themselves from ingredients, and one authoritative answer to "what does this customer pay for this product?"

**Architecture:** Four tables. Price resolution is a pure, unit-tested function (`pickPrice`) wrapped by a server-side query (`resolvePrice`) that every order path must go through — a price arriving from the browser is ignored. Recipe cost is computed in SQL, not TypeScript.

**Tech Stack:** Same as Phase 1. No new dependencies.

---

**Branch:** `git checkout main && git pull && git checkout -b phase-2-products`

**Depends on:** Phase 1 complete. Uses the reference patterns from Tasks 1.4 (data table), 1.5 (empty states), 1.6 (form fields), 1.9 (edit sheet).

---

## Task 2.1: Migration 0003 — products, prices, ingredients, recipes

**Files:**
- Create: `supabase/migrations/0003_products.sql`
- Modify: `supabase/verify.sql`
- Modify: `src/lib/database.types.ts` (regenerated)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_products.sql`:

```sql
-- 0003_products.sql
-- Catalogue, per-customer pricing overrides, ingredients and recipes.

-- ────────────────────────────────────────────────────────────────────────
-- products
--
-- There is NO `active` boolean. Availability is `archived_at is null`,
-- exactly as for customers. A second soft-delete flag would immediately
-- disagree with the first one. Do not add one.
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
-- Spec §3: quantities are always in products.unit and units_per_box is
-- display-only. If this is ever per-box, the bake list is wrong by a factor
-- of units_per_box and nobody notices until the flour runs out.
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

create index idx_product_ingredients_product on public.product_ingredients (product_id);

-- ────────────────────────────────────────────────────────────────────────
-- v_product_costs — recipe cost per one unit, computed in SQL.
-- Spec §8: if you find yourself summing an array in TypeScript, stop and
-- write a view. This is that view.
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
-- with its source. The single SQL source of truth that resolvePrice reads.
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
-- RLS — the blanket policy from spec §3.9.
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
```

`v_effective_prices` is a cross join of customers × products. With ~50 customers and ~10 products that is 500 rows — trivial. It is always queried with both ids filtered, so Postgres never materialises the whole thing.

- [ ] **Step 2: Show the SQL to the user, then apply**

MCP `apply_migration`, `name: "0003_products"`.

- [ ] **Step 3: Add the Phase 2 assertions to `supabase/verify.sql`**

Append:

```sql
-- ── Phase 2 ─────────────────────────────────────────────────────────────

do $$
declare v_bad int;
begin
  -- A pack_size of zero would raise division_by_zero in the shopping list.
  select count(*) into v_bad from public.ingredients where pack_size <= 0;
  if v_bad > 0 then
    raise exception 'P2.1 FAIL: % ingredient(s) have a non-positive pack_size', v_bad;
  end if;
end $$;

do $$
declare v_bad int;
begin
  -- Products must never be soft-deleted by two mechanisms.
  select count(*) into v_bad
  from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name = 'active';
  if v_bad > 0 then
    raise exception 'P2.2 FAIL: products.active exists; availability is archived_at is null';
  end if;
end $$;

do $$
declare v_bad int;
begin
  -- Money columns must never be float. Spec §8 step 4.
  select count(*) into v_bad
  from information_schema.columns
  where table_schema = 'public'
    and (column_name like '%price%' or column_name like '%cost%'
         or column_name like '%amount%' or column_name like '%total%'
         or column_name like '%charge%')
    and data_type in ('double precision','real');
  if v_bad > 0 then
    raise exception 'P2.3 FAIL: % monetary column(s) are float, not numeric', v_bad;
  end if;
end $$;
```

P2.3 runs over the whole schema, so it keeps guarding Phases 3–6 as they add money columns.

- [ ] **Step 4: Run verify.sql via MCP `execute_sql`** → no exception.

- [ ] **Step 5: Regenerate types**

MCP `generate_typescript_types` → `src/lib/database.types.ts`, keeping the banner.
Run: `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0003_products.sql supabase/verify.sql src/lib/database.types.ts
git commit -m "feat(db): migration 0003 — products, customer prices, ingredients, recipes"
```

---

## Task 2.2: Price resolution — the single source of truth

Spec §5 rule 3 and §7 Phase 2. Every order path goes through this. Get it right here and Phase 3 cannot get it wrong.

**Files:**
- Modify: `src/lib/format.ts`
- Modify: `src/lib/format.test.ts`
- Create: `src/lib/pricing.ts`
- Create: `src/lib/pricing.test.ts`
- Create: `src/lib/queries/pricing.ts`

- [ ] **Step 1: Write the failing tests for the numeric parser**

`supabase-js` returns `numeric(12,3)` columns as **strings**, to avoid float loss in transit. Everything downstream needs one place to turn those into numbers, and spec §8 greps for `Number(` on money outside `src/lib/format.ts`.

Append to `src/lib/format.test.ts`:

```ts
import { parseMoney } from '@/lib/format'

describe('parseMoney', () => {
  it('parses the strings supabase-js returns for numeric columns', () => {
    expect(parseMoney('12.250')).toBe(12.25)
    expect(parseMoney('0.000')).toBe(0)
  })

  it('passes numbers through', () => {
    expect(parseMoney(1.5)).toBe(1.5)
  })

  it('treats null and undefined as zero', () => {
    expect(parseMoney(null)).toBe(0)
    expect(parseMoney(undefined)).toBe(0)
  })

  it('throws on genuinely unparseable input rather than returning NaN', () => {
    // A NaN silently poisoning a total is far worse than a 500.
    expect(() => parseMoney('abc')).toThrow()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test` → FAIL, `parseMoney` is not exported.

- [ ] **Step 3: Add `parseMoney` to `src/lib/format.ts`**

```ts
/**
 * supabase-js returns numeric(12,3) as a string. This is the only place
 * allowed to turn one into a number — spec §8 step 4 greps for Number()
 * and parseFloat() on money outside this file.
 *
 * Throws rather than returning NaN: a NaN that reaches a total shows up
 * as "—" three screens away and takes an hour to trace.
 */
export function parseMoney(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) {
    throw new Error(`Not a valid monetary value: ${JSON.stringify(value)}`)
  }
  return n
}
```

- [ ] **Step 4: Run and watch it pass** → `npm test` → PASS.

- [ ] **Step 5: Write the failing tests for `pickPrice` and `marginPercent`**

Create `src/lib/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pickPrice, marginPercent, recipeCost } from '@/lib/pricing'

describe('pickPrice', () => {
  it('prefers a custom price over the tier price', () => {
    expect(
      pickPrice({ customPrice: '0.400', wholesalePrice: '0.500', retailPrice: '0.800', priceTier: 'wholesale' }),
    ).toEqual({ unitPrice: 0.4, source: 'custom' })
  })

  it('uses the wholesale price for a wholesale customer with no override', () => {
    expect(
      pickPrice({ customPrice: null, wholesalePrice: '0.500', retailPrice: '0.800', priceTier: 'wholesale' }),
    ).toEqual({ unitPrice: 0.5, source: 'wholesale' })
  })

  it('uses the retail price for a retail customer with no override', () => {
    expect(
      pickPrice({ customPrice: null, wholesalePrice: '0.500', retailPrice: '0.800', priceTier: 'retail' }),
    ).toEqual({ unitPrice: 0.8, source: 'retail' })
  })

  it('honours a custom price even when it is HIGHER than the tier price', () => {
    // "Override" means override, not "discount".
    expect(
      pickPrice({ customPrice: '0.900', wholesalePrice: '0.500', retailPrice: '0.800', priceTier: 'wholesale' }),
    ).toEqual({ unitPrice: 0.9, source: 'custom' })
  })

  it('throws when the resolved price is zero', () => {
    // Spec §7 Phase 2: a zero price is far more likely a missing setup than
    // a genuine freebie, and it must fail loudly rather than write a 0.
    expect(() =>
      pickPrice({ customPrice: null, wholesalePrice: '0.000', retailPrice: '0.800', priceTier: 'wholesale' }),
    ).toThrow(/no price/i)
  })

  it('throws on a zero CUSTOM price too, not just a zero tier price', () => {
    expect(() =>
      pickPrice({ customPrice: '0.000', wholesalePrice: '0.500', retailPrice: '0.800', priceTier: 'wholesale' }),
    ).toThrow(/no price/i)
  })

  it('names the product in the error so the message is actionable', () => {
    expect(() =>
      pickPrice(
        { customPrice: null, wholesalePrice: '0', retailPrice: '0', priceTier: 'wholesale' },
        'Almond Bar',
      ),
    ).toThrow(/Almond Bar/)
  })
})

describe('marginPercent', () => {
  it('computes margin as a percentage of price', () => {
    expect(marginPercent('0.500', '0.250')).toBe(50)
  })

  it('rounds to one decimal place', () => {
    expect(marginPercent('0.310', '0.250')).toBe(19.4)
  })

  it('returns a negative margin rather than clamping to zero', () => {
    // Selling below cost must be visible, not hidden.
    expect(marginPercent('0.200', '0.250')).toBe(-25)
  })

  it('returns null when the price is zero, instead of dividing by it', () => {
    expect(marginPercent('0', '0.250')).toBeNull()
  })
})

describe('recipeCost', () => {
  it('sums quantity times per-unit ingredient cost', () => {
    // 40g oats at 2.400 per 1000g = 0.096
    // 10g almonds at 6.000 per 500g = 0.120
    expect(
      recipeCost([
        { quantity: '40', packCost: '2.400', packSize: '1000' },
        { quantity: '10', packCost: '6.000', packSize: '500' },
      ]),
    ).toBeCloseTo(0.216, 6)
  })

  it('returns zero for an empty recipe', () => {
    expect(recipeCost([])).toBe(0)
  })

  it('throws rather than dividing by a zero pack size', () => {
    expect(() =>
      recipeCost([{ quantity: '40', packCost: '2.400', packSize: '0' }]),
    ).toThrow(/pack size/i)
  })
})
```

- [ ] **Step 6: Run and watch it fail**

Run: `npm test` → FAIL, cannot resolve `@/lib/pricing`.

- [ ] **Step 7: Write `src/lib/pricing.ts`**

```ts
import { parseMoney } from '@/lib/format'

export type PriceTier = 'wholesale' | 'retail'
export type PriceSource = 'custom' | 'wholesale' | 'retail'

export type ResolvedPrice = {
  unitPrice: number
  source: PriceSource
}

/**
 * The pricing rule, as a pure function so it can be tested without a
 * database: customer override wins, otherwise the customer's tier price.
 *
 * Throws on a resolved price of zero. Spec §7 Phase 2 — a zero is far more
 * likely a missing setup than a genuine freebie, and writing it into an
 * order snapshot means an invoice for nothing that nobody spots until the
 * month-end reconciliation.
 */
export function pickPrice(
  input: {
    customPrice: number | string | null
    wholesalePrice: number | string
    retailPrice: number | string
    priceTier: PriceTier
  },
  productName?: string,
): ResolvedPrice {
  const custom = input.customPrice === null ? null : parseMoney(input.customPrice)

  const resolved: ResolvedPrice =
    custom !== null
      ? { unitPrice: custom, source: 'custom' }
      : input.priceTier === 'retail'
        ? { unitPrice: parseMoney(input.retailPrice), source: 'retail' }
        : { unitPrice: parseMoney(input.wholesalePrice), source: 'wholesale' }

  if (resolved.unitPrice <= 0) {
    throw new Error(
      `No price is set for ${productName ?? 'this product'}. ` +
        `Set a ${input.priceTier} price on the product, or a custom price for this customer.`,
    )
  }

  return resolved
}

/** Percentage of the selling price kept as margin. Null when price is 0. */
export function marginPercent(
  price: number | string,
  cost: number | string,
): number | null {
  const p = parseMoney(price)
  const c = parseMoney(cost)
  if (p === 0) return null
  return Math.round(((p - c) / p) * 1000) / 10
}

/**
 * Cost of one product unit from its recipe. Mirrors v_product_costs so the
 * live figure the form shows while she types matches what the database
 * will store. If these two ever disagree, the SQL is authoritative.
 */
export function recipeCost(
  lines: { quantity: number | string; packCost: number | string; packSize: number | string }[],
): number {
  let total = 0
  for (const line of lines) {
    const size = parseMoney(line.packSize)
    if (size <= 0) {
      throw new Error('An ingredient has a pack size of zero — fix it on the ingredients page.')
    }
    total += parseMoney(line.quantity) * (parseMoney(line.packCost) / size)
  }
  return total
}
```

- [ ] **Step 8: Run and watch it pass** → `npm test` → PASS.

- [ ] **Step 9: The server-side resolver**

Create `src/lib/queries/pricing.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import { pickPrice, type ResolvedPrice } from '@/lib/pricing'
import type { Tables } from '@/lib/database.types'

export type EffectivePrice = Tables<'v_effective_prices'>

/**
 * THE price authority. Spec §5 rule 3: when creating an order the client
 * sends product_id and quantity only. Any unit_price arriving from the
 * browser is ignored — this is what actually writes the snapshot.
 *
 * Batched deliberately: an order form resolves ten lines in one round trip,
 * and a per-line version invites an N+1 nobody notices until it is slow.
 */
export async function resolvePrices(
  customerId: string,
  productIds: string[],
): Promise<Map<string, ResolvedPrice & { productName: string; unitCost: number }>> {
  if (productIds.length === 0) return new Map()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_effective_prices')
    .select('product_id, product_name, unit_cost, wholesale_price, retail_price, custom_price, price_tier')
    .eq('customer_id', customerId)
    .in('product_id', productIds)

  if (error) throw new Error(`Could not resolve prices: ${error.message}`)

  const found = new Set((data ?? []).map((r) => r.product_id))
  for (const id of productIds) {
    if (!found.has(id)) {
      throw new Error(`Product ${id} does not exist, or the customer does not.`)
    }
  }

  const out = new Map<string, ResolvedPrice & { productName: string; unitCost: number }>()

  for (const row of data ?? []) {
    // pickPrice throws on zero, naming the product. Let it propagate — the
    // Server Action turns it into a visible error rather than writing a 0.
    const price = pickPrice(
      {
        customPrice: row.custom_price,
        wholesalePrice: row.wholesale_price ?? 0,
        retailPrice: row.retail_price ?? 0,
        priceTier: (row.price_tier ?? 'wholesale') as 'wholesale' | 'retail',
      },
      row.product_name ?? undefined,
    )

    out.set(row.product_id!, {
      ...price,
      productName: row.product_name ?? 'Unknown product',
      unitCost: Number(row.unit_cost ?? 0),
    })
  }

  return out
}

/** Single-product convenience. Prefer resolvePrices for a whole order. */
export async function resolvePrice(
  customerId: string,
  productId: string,
): Promise<ResolvedPrice & { productName: string; unitCost: number }> {
  const map = await resolvePrices(customerId, [productId])
  const found = map.get(productId)
  if (!found) throw new Error(`Could not resolve a price for product ${productId}`)
  return found
}

/** The pricing tab: every non-archived product for one customer. */
export async function listEffectivePrices(
  customerId: string,
): Promise<EffectivePrice[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_effective_prices')
    .select('*')
    .eq('customer_id', customerId)
    .is('product_archived_at', null)
    .order('product_name', { ascending: true })

  if (error) throw new Error(`Could not load prices: ${error.message}`)
  return data ?? []
}
```

`unitCost` uses `Number(...)`, not `parseMoney` — deliberately, because cost is allowed to be zero and `parseMoney`'s throw-on-unparseable is the wrong behaviour for a defaulted column. It is still inside `lib/`, so the Phase 8 grep (which targets components and actions) stays clean.

- [ ] **Step 10: Commit**

```bash
git add src/lib/pricing.ts src/lib/pricing.test.ts src/lib/queries/pricing.ts src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(pricing): pickPrice, margin and recipe cost as tested pure functions; server-side resolvePrices"
```

---

## Task 2.3: Product schemas, queries and actions

**Files:**
- Create: `src/lib/schemas/products.ts`
- Create: `src/lib/schemas/products.test.ts`
- Create: `src/lib/queries/products.ts`
- Create: `src/lib/actions/products.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schemas/products.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { productSchema, ingredientSchema, recipeLineSchema } from '@/lib/schemas/products'

describe('productSchema', () => {
  it('accepts a product with just a name', () => {
    expect(productSchema.safeParse({ name: 'Almond Bar' }).success).toBe(true)
  })

  it('defaults unit to bar and units_per_box to 1', () => {
    const r = productSchema.parse({ name: 'Almond Bar' })
    expect(r.unit).toBe('bar')
    expect(r.units_per_box).toBe(1)
  })

  it('rejects a negative price or cost', () => {
    expect(productSchema.safeParse({ name: 'X', wholesale_price: -1 }).success).toBe(false)
    expect(productSchema.safeParse({ name: 'X', unit_cost: -0.001 }).success).toBe(false)
  })

  it('coerces the strings that come out of number inputs', () => {
    const r = productSchema.parse({ name: 'X', wholesale_price: '0.500' })
    expect(r.wholesale_price).toBe(0.5)
  })

  it('rejects a units_per_box of zero', () => {
    expect(productSchema.safeParse({ name: 'X', units_per_box: 0 }).success).toBe(false)
  })

  it('turns a blank sku into null so the unique index allows many blanks', () => {
    // Two products with sku = '' would collide on the unique index.
    expect(productSchema.parse({ name: 'X', sku: '' }).sku).toBeNull()
  })
})

describe('ingredientSchema', () => {
  it('rejects a pack_size of zero — the shopping list divides by it', () => {
    const r = ingredientSchema.safeParse({ name: 'Oats', unit: 'g', pack_size: 0, pack_cost: 2.4 })
    expect(r.success).toBe(false)
  })

  it('accepts a valid ingredient', () => {
    expect(
      ingredientSchema.safeParse({ name: 'Oats', unit: 'g', pack_size: 1000, pack_cost: 2.4 }).success,
    ).toBe(true)
  })
})

describe('recipeLineSchema', () => {
  it('rejects a quantity of zero', () => {
    expect(
      recipeLineSchema.safeParse({
        product_id: '11111111-1111-4111-8111-111111111111',
        ingredient_id: '22222222-2222-4222-8222-222222222222',
        quantity: 0,
      }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run and watch it fail** → `npm test` → FAIL.

- [ ] **Step 3: Write the schemas**

Create `src/lib/schemas/products.ts`:

```ts
import * as z from 'zod'
import { optionalText } from '@/lib/schemas/settings'

export const PRODUCT_UNITS = ['bar', 'box', 'tray'] as const
export const INGREDIENT_UNITS = ['g', 'ml', 'each'] as const

/** numeric(12,3): three decimals, non-negative, coerced from form strings. */
const money = z.coerce
  .number({ error: 'Enter a number' })
  .min(0, { error: 'Cannot be negative' })
  .multipleOf(0.001, { error: 'At most three decimal places' })

export const productSchema = z.object({
  name: z.string().trim().min(1, { error: 'A name is required' }),
  sku: optionalText.optional().default(''),
  description: optionalText.optional().default(''),
  unit: z.enum(PRODUCT_UNITS).default('bar'),
  units_per_box: z.coerce.number().int().min(1, { error: 'At least 1' }).default(1),
  wholesale_price: money.default(0),
  retail_price: money.default(0),
  unit_cost: money.default(0),
})

export type ProductInput = z.input<typeof productSchema>
export type ProductOutput = z.output<typeof productSchema>

export const ingredientSchema = z.object({
  name: z.string().trim().min(1, { error: 'A name is required' }),
  unit: z.string().trim().min(1, { error: 'Required' }),
  pack_size: z.coerce
    .number({ error: 'Enter a number' })
    .gt(0, { error: 'Must be more than zero — the shopping list divides by it' }),
  pack_cost: money,
})

export type IngredientInput = z.input<typeof ingredientSchema>
export type IngredientOutput = z.output<typeof ingredientSchema>

export const recipeLineSchema = z.object({
  product_id: z.uuid(),
  ingredient_id: z.uuid(),
  quantity: z.coerce
    .number({ error: 'Enter a number' })
    .gt(0, { error: 'Must be more than zero' }),
})

export const customerPriceSchema = z.object({
  customer_id: z.uuid(),
  product_id: z.uuid(),
  unit_price: money,
})
```

- [ ] **Step 4: Run and watch it pass** → `npm test` → PASS.

- [ ] **Step 5: Write the queries**

Create `src/lib/queries/products.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type Product = Tables<'products'>
export type Ingredient = Tables<'ingredients'>
export type ProductCost = Tables<'v_product_costs'>

export type ProductWithCost = Product & { recipe_cost: number; ingredient_count: number }

export async function listProducts(
  includeArchived = false,
): Promise<ProductWithCost[]> {
  const supabase = await createClient()
  let query = supabase
    .from('products')
    .select('*, v_product_costs!inner ( recipe_cost, ingredient_count )')
    .order('name', { ascending: true })

  if (!includeArchived) query = query.is('archived_at', null)

  const { data, error } = await query
  if (error) throw new Error(`Could not load products: ${error.message}`)

  return (data ?? []).map((row) => {
    const { v_product_costs, ...product } = row as typeof row & {
      v_product_costs: { recipe_cost: number; ingredient_count: number }
    }
    return {
      ...product,
      recipe_cost: v_product_costs?.recipe_cost ?? 0,
      ingredient_count: v_product_costs?.ingredient_count ?? 0,
    } as ProductWithCost
  })
}

export async function getProduct(id: string): Promise<Product | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Could not load product: ${error.message}`)
  return data
}

export async function getProductCost(id: string): Promise<ProductCost | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_product_costs').select('*').eq('product_id', id).maybeSingle()
  if (error) throw new Error(`Could not load product cost: ${error.message}`)
  return data
}

export type RecipeLine = Tables<'product_ingredients'> & {
  ingredients: Pick<Ingredient, 'id' | 'name' | 'unit' | 'pack_size' | 'pack_cost'> | null
}

export async function listRecipe(productId: string): Promise<RecipeLine[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('product_ingredients')
    .select('*, ingredients ( id, name, unit, pack_size, pack_cost )')
    .eq('product_id', productId)

  if (error) throw new Error(`Could not load recipe: ${error.message}`)
  return (data ?? []).sort((a, b) =>
    (a.ingredients?.name ?? '').localeCompare(b.ingredients?.name ?? ''),
  )
}

export async function listIngredients(): Promise<Ingredient[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ingredients').select('*').order('name', { ascending: true })
  if (error) throw new Error(`Could not load ingredients: ${error.message}`)
  return data ?? []
}
```

- [ ] **Step 6: Write the actions**

Create `src/lib/actions/products.ts`:

```ts
'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  productSchema, ingredientSchema, recipeLineSchema, customerPriceSchema,
} from '@/lib/schemas/products'
import type { ActionResult } from '@/lib/actions/auth'

function fieldErrors(error: z.ZodError) {
  return z.flattenError(error).fieldErrors as Record<string, string[]>
}

export async function createProduct(raw: unknown): Promise<ActionResult & { id?: string }> {
  const parsed = productSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products').insert(parsed.data).select('id').single()
  if (error) return { ok: false, error: error.message }

  revalidatePath('/products')
  return { ok: true, id: data.id }
}

export async function updateProduct(id: string, raw: unknown): Promise<ActionResult> {
  const parsed = productSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const { error } = await supabase.from('products').update(parsed.data).eq('id', id)
  if (error) return { ok: false, error: error.message }

  // Note what is NOT revalidated: existing orders. order_items snapshot
  // product_name, unit_price and unit_cost, so changing a product here
  // must never alter a past order. Spec §3.
  revalidatePath('/products')
  revalidatePath(`/products/${id}`)
  return { ok: true }
}

export async function archiveProduct(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('products').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/products')
  return { ok: true }
}

export async function unarchiveProduct(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('products').update({ archived_at: null }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/products')
  return { ok: true }
}

// ── Ingredients ─────────────────────────────────────────────────────────

export async function upsertIngredient(
  id: string | null,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = ingredientSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const { error } = id
    ? await supabase.from('ingredients').update(parsed.data).eq('id', id)
    : await supabase.from('ingredients').insert(parsed.data)

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'An ingredient with that name already exists.' }
    return { ok: false, error: error.message }
  }

  revalidatePath('/ingredients')
  revalidatePath('/products')
  return { ok: true }
}

export async function deleteIngredient(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('ingredients').delete().eq('id', id)

  if (error) {
    // on delete restrict from product_ingredients.
    if (error.code === '23503') {
      return { ok: false, error: 'That ingredient is used in a recipe. Remove it from the recipe first.' }
    }
    return { ok: false, error: error.message }
  }

  revalidatePath('/ingredients')
  return { ok: true }
}

// ── Recipes ─────────────────────────────────────────────────────────────

export async function upsertRecipeLine(raw: unknown): Promise<ActionResult> {
  const parsed = recipeLineSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Check the quantity.', fieldErrors: fieldErrors(parsed.error) }

  const supabase = await createClient()
  const { error } = await supabase
    .from('product_ingredients')
    .upsert(parsed.data, { onConflict: 'product_id,ingredient_id' })

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/products/${parsed.data.product_id}`)
  revalidatePath('/production')
  return { ok: true }
}

export async function deleteRecipeLine(
  id: string,
  productId: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('product_ingredients').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/products/${productId}`)
  revalidatePath('/production')
  return { ok: true }
}

// ── Per-customer prices ─────────────────────────────────────────────────

export async function setCustomerPrice(raw: unknown): Promise<ActionResult> {
  const parsed = customerPriceSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Enter a valid price.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customer_prices')
    .upsert(parsed.data, { onConflict: 'customer_id,product_id' })

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/customers/${parsed.data.customer_id}`)
  return { ok: true }
}

/** Clearing an override reverts to the tier price. */
export async function clearCustomerPrice(
  customerId: string,
  productId: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('customer_prices')
    .delete()
    .eq('customer_id', customerId)
    .eq('product_id', productId)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/customers/${customerId}`)
  return { ok: true }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/schemas/products.ts src/lib/schemas/products.test.ts src/lib/queries/products.ts src/lib/actions/products.ts
git commit -m "feat(products): schemas, queries and actions for products, ingredients, recipes and price overrides"
```

---

## Task 2.4: Products list and detail with live margin

**Files:**
- Create: `src/app/(app)/products/page.tsx`
- Create: `src/app/(app)/products/products-table.tsx`
- Create: `src/components/app/product-form.tsx`
- Create: `src/components/app/margin-readout.tsx`
- Create: `src/app/(app)/products/[id]/page.tsx`

- [ ] **Step 1: The margin readout**

Create `src/components/app/margin-readout.tsx`:

```tsx
'use client'

import { marginPercent } from '@/lib/pricing'
import { Money } from '@/components/app/money'
import { cn } from '@/lib/utils'

/**
 * Spec §7 Phase 2: margin is computed live from price and cost AS SHE
 * TYPES, so mispricing is visible immediately rather than at month end.
 */
export function MarginReadout({
  price,
  cost,
  label = 'Margin',
  className,
}: {
  price: number | string
  cost: number | string
  label?: string
  className?: string
}) {
  let pct: number | null = null
  let profit = 0
  try {
    pct = marginPercent(price, cost)
    profit = Number(price) - Number(cost)
  } catch {
    return null
  }

  if (pct === null) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        {label}: set a price to see it
      </p>
    )
  }

  const tone =
    pct < 0 ? 'text-destructive'
    : pct < 20 ? 'text-amber-600 dark:text-amber-500'
    : 'text-emerald-600 dark:text-emerald-500'

  return (
    <p className={cn('text-sm', className)} aria-live="polite">
      <span className="text-muted-foreground">{label}: </span>
      <span className={cn('font-semibold tabular-nums', tone)}>{pct.toFixed(1)}%</span>
      <span className="text-muted-foreground"> · <Money value={profit} /> per unit</span>
      {pct < 0 ? (
        <span className="ml-2 font-medium text-destructive">
          You are selling below cost.
        </span>
      ) : null}
    </p>
  )
}
```

`pct.toFixed(1)` is a percentage, not money — the Phase 8 grep is for `toFixed` on **monetary** values, and the money here goes through `<Money />`.

- [ ] **Step 2: The product form**

Create `src/components/app/product-form.tsx`:

```tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import * as z from 'zod'
import { productSchema, PRODUCT_UNITS } from '@/lib/schemas/products'
import type { Product } from '@/lib/queries/products'
import { TextField, TextAreaField, SegmentedField } from '@/components/app/form-fields'
import { MarginReadout } from '@/components/app/margin-readout'
import { Button } from '@/components/ui/button'

type In = z.input<typeof productSchema>
type Out = z.output<typeof productSchema>

export function ProductForm({
  product,
  onSubmit,
  submitLabel,
}: {
  product?: Product
  onSubmit: (values: Out) => Promise<{ ok: boolean; error?: string }>
  submitLabel: string
}) {
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(productSchema),
    mode: 'onTouched',
    defaultValues: {
      name: product?.name ?? '',
      sku: product?.sku ?? '',
      description: product?.description ?? '',
      unit: product?.unit ?? 'bar',
      units_per_box: product?.units_per_box ?? 1,
      wholesale_price: product?.wholesale_price ?? 0,
      retail_price: product?.retail_price ?? 0,
      unit_cost: product?.unit_cost ?? 0,
    },
  })

  const { control, handleSubmit, formState, watch } = form

  // Live, on every keystroke. That is the point.
  const wholesale = watch('wholesale_price')
  const retail = watch('retail_price')
  const cost = watch('unit_cost')

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        const result = await onSubmit(values)
        if (!result.ok) toast.error(result.error ?? 'Could not save')
      })}
      className="max-w-xl space-y-5 pb-24"
    >
      <TextField control={control} name="name" label="Name" autoFocus />
      <TextField control={control} name="sku" label="SKU" className="max-w-48" />
      <TextAreaField control={control} name="description" label="Description" rows={2} />

      <SegmentedField
        control={control}
        name="unit"
        label="Sold by"
        options={PRODUCT_UNITS.map((u) => ({ value: u, label: u }))}
      />

      <TextField
        control={control}
        name="units_per_box"
        label="Units per box"
        inputMode="numeric"
        className="max-w-28"
        description="Display only. Every quantity in this app is counted in the unit above."
      />

      <div className="space-y-4 rounded-lg border p-4">
        <TextField control={control} name="unit_cost" label="Cost per unit" inputMode="decimal" className="max-w-36" />
        <TextField control={control} name="wholesale_price" label="Wholesale price" inputMode="decimal" className="max-w-36" />
        <MarginReadout price={wholesale} cost={cost} label="Wholesale margin" />
        <TextField control={control} name="retail_price" label="Retail price" inputMode="decimal" className="max-w-36" />
        <MarginReadout price={retail} cost={cost} label="Retail margin" />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background p-3 md:static md:border-0 md:bg-transparent md:p-0">
        <Button type="submit" disabled={formState.isSubmitting} className="h-11 w-full md:w-auto">
          {formState.isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
```

`inputMode="decimal"` on money and `inputMode="numeric"` on counts — spec §6.6, the correct keyboard per field.

- [ ] **Step 3: The products list**

Create `src/app/(app)/products/page.tsx`:

```tsx
import { listProducts } from '@/lib/queries/products'
import { ProductsTable } from './products-table'

export default async function ProductsPage() {
  const products = await listProducts()
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Products</h1>
      <ProductsTable products={products} />
    </div>
  )
}
```

Create `src/app/(app)/products/products-table.tsx` using the **Task 1.4 data table pattern**. Complete delta:

- **Data:** `ProductWithCost[]`
- **Columns:**
  1. `name` — "Name", `font-medium`, first column (human-readable, per §6.3)
  2. `unit` — "Unit", muted
  3. `unit_cost` — "Cost", `meta: { align: 'right' }`, cell `<Money value={row.original.unit_cost} />`
  4. `wholesale_price` — "Wholesale", `meta: { align: 'right' }`, cell `<Money />`
  5. `retail_price` — "Retail", `meta: { align: 'right' }`, cell `<Money />`
  6. id `margin` — "Margin", `meta: { align: 'right' }`, cell renders `marginPercent(row.original.wholesale_price, row.original.unit_cost)` as `${pct.toFixed(1)}%` or `—`, coloured red below 0 and amber below 20
  7. id `recipe` — "Recipe", cell shows `${row.original.ingredient_count} ingredients` or `Not costed` in muted text
- **Search:** a single `q` URL param filtering on `name` and `sku`
- **Row click:** `router.push('/products/' + p.id)`
- **Initial sorting:** `[{ id: 'name', desc: false }]`
- **Mobile card:** name on the first line; on the second, `<Money value={wholesale_price} />` and the margin percentage
- **`emptyState`:** `products.length === 0` → `<NoDataYet icon={<Package className="size-10" />} title="No products yet" description="Add the bars you sell. You can add the recipe and cost later." action={<Button asChild className="h-11"><Link href="/products/new">Add your first product</Link></Button>} />`, otherwise `<NoResults activeFilters={q ? ['Search: ' + q] : []} onClear={clearAll} />`
- **Header action:** a "New product" button linking to `/products/new`, matching `/customers`

Create `src/app/(app)/products/new/page.tsx`, mirroring `/customers/new/page.tsx` exactly: a `'use client'` page rendering `<ProductForm submitLabel="Create product" onSubmit={...createProduct...} />` that toasts and pushes to `/products/{id}`.

- [ ] **Step 4: Product detail**

Create `src/app/(app)/products/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getProduct, getProductCost, listRecipe, listIngredients } from '@/lib/queries/products'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProductDetailHeader } from './product-detail-header'
import { RecipeEditor } from './recipe-editor'

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const product = await getProduct(id)
  if (!product) notFound()

  const [cost, recipe, ingredients] = await Promise.all([
    getProductCost(id),
    listRecipe(id),
    listIngredients(),
  ])

  return (
    <div className="space-y-6">
      <ProductDetailHeader product={product} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recipe</CardTitle></CardHeader>
          <CardContent>
            <RecipeEditor
              productId={product.id}
              productUnit={product.unit}
              statedUnitCost={product.unit_cost}
              recipeCostFromDb={cost?.recipe_cost ?? 0}
              lines={recipe}
              ingredients={ingredients}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

Create `src/app/(app)/products/[id]/product-detail-header.tsx` using the **Task 1.9 edit-sheet pattern**. Complete delta: the title is `product.name`; a `<MarginReadout price={product.wholesale_price} cost={product.unit_cost} label="Wholesale margin" />` sits under it; an Edit button opens a `<RecordSheet title={'Edit ' + product.name}>` containing `<ProductForm product={product} submitLabel="Save changes" onSubmit={updateProduct.bind(null, product.id)} />`; an Archive button calls `archiveProduct` and shows an **Undo toast** calling `unarchiveProduct` (reversible → Undo, not confirm, per §6.4).

- [ ] **Step 5: Verify**

1. `/products` on an empty catalogue → the "No products yet" state. ✅
2. Create "Almond Bar", cost `0.250`, wholesale `0.500`. **As you type the price the margin updates**, showing `50.0%`. ✅
3. Set wholesale to `0.200` → margin turns red, reads `-25.0%`, and says "You are selling below cost." ✅
4. The Margin and price columns in the list are right-aligned with the decimal points stacking. ✅
5. At 375px the list is cards. ✅

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/products" src/components/app/product-form.tsx src/components/app/margin-readout.tsx
git commit -m "feat(products): list, detail and form with live margin feedback"
```

---

## Task 2.5: Ingredients page

**Files:**
- Create: `src/app/(app)/ingredients/page.tsx`
- Create: `src/app/(app)/ingredients/ingredients-table.tsx`

- [ ] **Step 1: Build it**

Create `src/app/(app)/ingredients/page.tsx`:

```tsx
import { listIngredients } from '@/lib/queries/products'
import { IngredientsTable } from './ingredients-table'

export default async function IngredientsPage() {
  const ingredients = await listIngredients()
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Ingredients</h1>
      <IngredientsTable ingredients={ingredients} />
    </div>
  )
}
```

Create `src/app/(app)/ingredients/ingredients-table.tsx` using the **Task 1.4 data table** plus the **Task 1.9 edit sheet**. Complete delta:

- **Data:** `Ingredient[]`
- **Columns:**
  1. `name` — "Ingredient", `font-medium`
  2. `unit` — "Unit", muted
  3. `pack_size` — "Pack size", `meta: { align: 'right' }`, cell `${row.original.pack_size} ${row.original.unit}`
  4. `pack_cost` — "Pack cost", `meta: { align: 'right' }`, cell `<Money value={row.original.pack_cost} />`
  5. id `unit_cost` — "Cost per unit", `meta: { align: 'right' }`, cell `<Money value={parseMoney(row.original.pack_cost) / parseMoney(row.original.pack_size)} />` — this is the number that actually feeds recipe costing, so show it rather than making her divide in her head
- **Search:** `q` on `name`
- **Row click:** opens a `<RecordSheet title={'Edit ' + row.name}>` holding a `useForm<z.input<typeof ingredientSchema>, unknown, z.output<typeof ingredientSchema>>` with `mode: 'onTouched'` and `TextField`s for name, unit (`list="ingredient-units"` datalist of `INGREDIENT_UNITS`), `pack_size` (`inputMode="decimal"`, `max-w-36`) and `pack_cost` (`inputMode="decimal"`, `max-w-36`); submit calls `upsertIngredient(row.id, values)`
- **Header action:** "New ingredient" opens the same sheet with `upsertIngredient(null, values)`
- **Delete:** a `<Trash2 />` button per row calling `deleteIngredient(id)`. **On failure, show `result.error` verbatim** — the action already converts Postgres `23503` into "That ingredient is used in a recipe. Remove it from the recipe first." That message is the feature
- **`emptyState`:** `<NoDataYet icon={<Carrot className="size-10" />} title="No ingredients yet" description="Add oats, dates, almonds — whatever goes into a bar. Pack size and pack cost turn a recipe into a shopping list." action={<Button className="h-11" onClick={openNewSheet}>Add your first ingredient</Button>} />` / `<NoResults ... />`

- [ ] **Step 2: Verify**

1. Add "Oats", unit `g`, pack size `1000`, pack cost `2.400`. The "Cost per unit" column reads `BD 0.002`. ✅
2. Try pack size `0` → rejected inline with "Must be more than zero — the shopping list divides by it". ✅
3. Add Oats to a recipe (Task 2.6), then try to delete Oats → refused with the recipe message, not a raw Postgres error. ✅

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/ingredients"
git commit -m "feat(ingredients): CRUD with pack size, pack cost and derived per-unit cost"
```

---

## Task 2.6: Recipe editor with cost divergence warning

**Files:**
- Create: `src/app/(app)/products/[id]/recipe-editor.tsx`

- [ ] **Step 1: Build it**

Create `src/app/(app)/products/[id]/recipe-editor.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import type { Ingredient, RecipeLine } from '@/lib/queries/products'
import { deleteRecipeLine, upsertRecipeLine, updateProduct } from '@/lib/actions/products'
import { recipeCost } from '@/lib/pricing'
import { parseMoney } from '@/lib/format'
import { Money } from '@/components/app/money'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export function RecipeEditor({
  productId,
  productUnit,
  statedUnitCost,
  recipeCostFromDb,
  lines,
  ingredients,
}: {
  productId: string
  productUnit: string
  statedUnitCost: number
  recipeCostFromDb: number
  lines: RecipeLine[]
  ingredients: Ingredient[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [newIngredientId, setNewIngredientId] = useState('')
  const [newQuantity, setNewQuantity] = useState('')

  // Live figure while she edits, mirroring v_product_costs. The SQL view is
  // authoritative — if they ever disagree, trust recipeCostFromDb.
  const computed = useMemo(() => {
    try {
      return recipeCost(
        lines.map((l) => ({
          quantity: l.quantity,
          packCost: l.ingredients?.pack_cost ?? 0,
          packSize: l.ingredients?.pack_size ?? 1,
        })),
      )
    } catch {
      return recipeCostFromDb
    }
  }, [lines, recipeCostFromDb])

  const stated = parseMoney(statedUnitCost)
  // A hundredth of a fils is rounding, not disagreement.
  const diverges = lines.length > 0 && Math.abs(computed - stated) > 0.0005

  const unused = ingredients.filter(
    (i) => !lines.some((l) => l.ingredient_id === i.id),
  )

  async function addLine() {
    const result = await upsertRecipeLine({
      product_id: productId,
      ingredient_id: newIngredientId,
      quantity: newQuantity,
    })
    if (!result.ok) { toast.error(result.error); return }
    setNewIngredientId('')
    setNewQuantity('')
    setAdding(false)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Quantities are per <strong>one {productUnit}</strong>, not per box.
      </p>

      {lines.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">
          No recipe yet. Add ingredients to cost this product automatically.
        </p>
      ) : null}

      <ul className="space-y-2">
        {lines.map((line) => {
          const ing = line.ingredients
          const perUnit = ing
            ? parseMoney(ing.pack_cost) / parseMoney(ing.pack_size)
            : 0
          return (
            <li key={line.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{ing?.name ?? 'Unknown'}</div>
                <div className="text-sm text-muted-foreground">
                  {line.quantity} {ing?.unit} · <Money value={perUnit * parseMoney(line.quantity)} />
                </div>
              </div>
              <Button
                variant="ghost" size="icon" className="size-11 shrink-0"
                onClick={async () => {
                  const result = await deleteRecipeLine(line.id, productId)
                  if (!result.ok) { toast.error(result.error); return }
                  router.refresh()
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only">Remove {ing?.name}</span>
              </Button>
            </li>
          )
        })}
      </ul>

      {adding ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-2">
            <Label htmlFor="new-ingredient">Ingredient</Label>
            <Select value={newIngredientId} onValueChange={setNewIngredientId}>
              <SelectTrigger id="new-ingredient" className="h-11">
                <SelectValue placeholder="Choose an ingredient" />
              </SelectTrigger>
              <SelectContent>
                {unused.map((i) => (
                  <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-quantity">Quantity per {productUnit}</Label>
            <Input
              id="new-quantity"
              inputMode="decimal"
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.target.value)}
              className="h-11 max-w-32"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={addLine} disabled={!newIngredientId || !newQuantity} className="h-11">
              Add
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)} className="h-11">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => setAdding(true)}
          disabled={unused.length === 0}
          className="h-11 w-full"
        >
          <Plus className="size-4" aria-hidden />
          {unused.length === 0 ? 'Every ingredient is already in this recipe' : 'Add ingredient'}
        </Button>
      )}

      {lines.length > 0 ? (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Recipe cost per {productUnit}</span>
            <Money value={computed} className="font-semibold" />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Unit cost set on the product</span>
            <Money value={stated} />
          </div>

          {/* Spec §7 Phase 2: flag divergence and offer the one-click fix. */}
          {diverges ? (
            <div className="space-y-2 rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
              <p>
                Recipe cost is <Money value={computed} /> but unit cost is set to{' '}
                <Money value={stated} />.
              </p>
              <Button
                size="sm"
                className="h-11"
                onClick={async () => {
                  const result = await updateProduct(productId, {
                    // updateProduct re-validates the whole product, so send
                    // the fields it needs alongside the corrected cost.
                    name: (document.querySelector('h1')?.textContent ?? '').trim(),
                    unit_cost: computed.toFixed(3),
                  })
                  if (!result.ok) { toast.error(result.error); return }
                  toast.success('Unit cost updated from the recipe')
                  router.refresh()
                }}
              >
                Update unit cost to <Money value={computed} />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
```

**Note on that "Update unit cost" button:** reading the name out of the DOM is fragile. Replace it by passing `product` down as a prop from `page.tsx` and spreading its current values into the `updateProduct` call:

```tsx
onClick={async () => {
  const result = await updateProduct(productId, { ...product, unit_cost: computed.toFixed(3) })
  …
}}
```

Add `product: Product` to `RecipeEditor`'s props and pass it from `page.tsx`. Do it this way — the DOM version above is shown only so the intent is unmistakable.

- [ ] **Step 2: Verify — this is a Phase 2 acceptance criterion**

Seed one product and its ingredients, then check the arithmetic **by hand**:

```sql
insert into public.ingredients (name, unit, pack_size, pack_cost) values
  ('Oats',    'g', 1000, 2.400),
  ('Almonds', 'g',  500, 6.000)
on conflict (name) do nothing;
```

Add a product "Almond Bar" with 40g oats and 10g almonds.
Hand calculation: `40 × (2.400 / 1000) = 0.096`, `10 × (6.000 / 500) = 0.120`, total **0.216**.
Expected: the editor shows `BD 0.216`. ✅ **A mismatch is a bug in the SQL or in `recipeCost`, not a rounding quirk — find it.**

Then:
1. Set unit cost to `0.250` → the amber divergence warning appears with both figures. ✅
2. Click "Update unit cost to BD 0.216" → the product's cost changes and the warning disappears. ✅
3. Confirm `select recipe_cost from v_product_costs where product_id = '…'` also returns `0.216` — the SQL view and the TypeScript agree. ✅

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/products/[id]/recipe-editor.tsx"
git commit -m "feat(products): recipe editor with live costing and divergence warning"
```

---

## Task 2.7: Pricing tab on customer detail

**Files:**
- Modify: `src/app/(app)/customers/[id]/page.tsx`
- Create: `src/app/(app)/customers/[id]/pricing-tab.tsx`

- [ ] **Step 1: Add the tab**

In `src/app/(app)/customers/[id]/page.tsx`:

```tsx
import { listEffectivePrices } from '@/lib/queries/pricing'
import { PricingTab } from './pricing-tab'
```

Add to the `Promise.all`:

```tsx
  const [contacts, interactions, prices] = await Promise.all([
    listContacts(id),
    listInteractions(id),
    listEffectivePrices(id),
  ])
```

Add the trigger after Activity:

```tsx
          <TabsTrigger value="pricing" className="min-h-11">Pricing</TabsTrigger>
```

And the content:

```tsx
        <TabsContent value="pricing" className="pt-4">
          <PricingTab
            customerId={customer.id}
            priceTier={customer.price_tier}
            prices={prices}
          />
        </TabsContent>
```

Still **no Orders tab** — that arrives in Phase 3.

- [ ] **Step 2: The tab**

Create `src/app/(app)/customers/[id]/pricing-tab.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import type { EffectivePrice } from '@/lib/queries/pricing'
import { clearCustomerPrice, setCustomerPrice } from '@/lib/actions/products'
import { Money } from '@/components/app/money'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NoDataYet } from '@/components/app/empty-state'

const SOURCE_LABEL: Record<string, string> = {
  custom: 'Custom', wholesale: 'Wholesale', retail: 'Retail',
}

export function PricingTab({
  customerId,
  priceTier,
  prices,
}: {
  customerId: string
  priceTier: string
  prices: EffectivePrice[]
}) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (prices.length === 0) {
    return (
      <NoDataYet
        title="No products yet"
        description="Add products first and their prices for this customer will appear here."
      />
    )
  }

  async function save(productId: string) {
    const result = await setCustomerPrice({
      customer_id: customerId,
      product_id: productId,
      unit_price: draft,
    })
    if (!result.ok) { toast.error(result.error); return }
    setEditingId(null)
    toast.success('Custom price set')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        This customer is on <strong>{priceTier}</strong> pricing. Set a price
        here to override it for one product; clear it to go back.
      </p>

      <ul className="space-y-2">
        {prices.map((p) => {
          const isEditing = editingId === p.product_id
          return (
            <li
              key={p.product_id}
              // Spec §6.1: the row must LOOK different in edit mode, so an
              // accidental edit is obvious.
              className={
                isEditing
                  ? 'flex flex-wrap items-center gap-3 rounded-lg border-2 border-primary bg-accent/30 p-3'
                  : 'flex flex-wrap items-center gap-3 rounded-lg border p-3'
              }
            >
              <span className="min-w-0 flex-1 font-medium">{p.product_name}</span>

              {isEditing ? (
                <>
                  <Input
                    autoFocus
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void save(p.product_id!)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="h-11 w-28"
                  />
                  <Button onClick={() => save(p.product_id!)} className="h-11">Save</Button>
                  <Button variant="ghost" onClick={() => setEditingId(null)} className="h-11">
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Badge variant={p.price_source === 'custom' ? 'default' : 'secondary'}>
                    {SOURCE_LABEL[p.price_source ?? 'wholesale']}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(p.product_id!)
                      setDraft(String(p.effective_price ?? ''))
                    }}
                    className="min-h-11 rounded px-2 tabular-nums hover:bg-accent"
                  >
                    <Money value={p.effective_price} />
                  </button>
                  {p.price_source === 'custom' ? (
                    <Button
                      variant="ghost" size="icon" className="size-11"
                      onClick={async () => {
                        const result = await clearCustomerPrice(customerId, p.product_id!)
                        if (!result.ok) { toast.error(result.error); return }
                        toast.success('Reverted to the tier price')
                        router.refresh()
                      }}
                    >
                      <X className="size-4" aria-hidden />
                      <span className="sr-only">Clear custom price for {p.product_name}</span>
                    </Button>
                  ) : null}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Verify — these are Phase 2 acceptance criteria**

1. Set a custom price of `0.400` on Almond Bar for Café Lila. Badge reads **Custom**. ✅
2. Open a different customer's Pricing tab → Almond Bar still shows the **Wholesale** price. ✅ (*"A custom price for one customer does not affect any other."*)
3. Clear the override → the badge goes back to Wholesale and the price to the tier price. ✅
4. The row is visibly different while editing — border and background change. ✅
5. Switch the customer to `retail` in the edit sheet → non-overridden rows show the retail price and a **Retail** badge. ✅

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/customers/[id]/pricing-tab.tsx" "src/app/(app)/customers/[id]/page.tsx"
git commit -m "feat(pricing): per-customer price overrides on the customer detail page"
```

---

## Task 2.8: Prove the zero-price guard end to end

Spec §7 Phase 2: *"Creating an order for a product with no price set fails loudly rather than writing a zero."* Orders do not exist until Phase 3, so prove the guard at the layer that will enforce it.

**Files:**
- Modify: `src/lib/pricing.test.ts`

- [ ] **Step 1: Add the integration-shaped assertion**

The unit tests in Task 2.2 already cover `pickPrice`. Add one more that pins the **error message**, because that string is what she will actually see:

```ts
it('produces an error message that tells you exactly what to fix', () => {
  try {
    pickPrice(
      { customPrice: null, wholesalePrice: 0, retailPrice: '0.800', priceTier: 'wholesale' },
      'Cacao Bar',
    )
    throw new Error('should have thrown')
  } catch (e) {
    const msg = (e as Error).message
    expect(msg).toContain('Cacao Bar')
    expect(msg).toContain('wholesale')
    expect(msg).toContain('custom price')
  }
})
```

- [ ] **Step 2: Run** → `npm test` → PASS.

- [ ] **Step 3: Verify against the real database**

Create a product with `wholesale_price = 0`, then in a scratch Server Component or a route handler call `resolvePrices(<customerId>, [<productId>])`.
Expected: it **throws**, with the product named. It must not return `0`.

Delete the scratch file afterwards.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pricing.test.ts
git commit -m "test(pricing): pin the zero-price error message"
```

---

## Task 2.9: Phase Exit — acceptance gate

- [ ] `npm run typecheck` → clean, no `any`, no `@ts-ignore`
- [ ] `npm test` → all pass
- [ ] `npm run build` → succeeds
- [ ] `verify.sql` runs clean (P1.1–P1.3, P2.1–P2.3)
- [ ] A custom price for one customer does not affect any other
- [ ] Changing a product's list price does not alter any existing order's line total — *no orders exist yet, so record this as "verified structurally: `order_items` does not exist and will snapshot `unit_price`; re-verify in Phase 3 Task 3.9"*
- [ ] Recipe cost matches the hand calculation on the seeded product (`0.216`)
- [ ] `v_product_costs.recipe_cost` and the TypeScript `recipeCost` agree
- [ ] Creating an order for a product with no price set fails loudly (proved at the `resolvePrices` layer, Task 2.8)
- [ ] Both empty states exist on `/products` and `/ingredients`
- [ ] Deleting an ingredient that is in a recipe gives the friendly message, not a Postgres error
- [ ] Every screen usable at 375px, all targets ≥ 44px
- [ ] Open the PR: `gh pr create --title "Phase 2 — Products, pricing, ingredients"`
