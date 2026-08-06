# Phase 4 — Production — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One page that answers "what do I bake this week, what do I need to buy, and where does it all go" — and prints legibly enough to take into the kitchen.

**Architecture:** Two `stable` SQL functions do all the arithmetic. The page is a Server Component with a week picker in the URL. The print stylesheet is a first-class feature, not polish: printing is how this page actually gets used.

**Tech Stack:** Same as Phase 3. No new dependencies.

---

**Branch:** `git checkout main && git pull && git checkout -b phase-4-production`

**Depends on:** Phase 3 complete.

**Migration numbering:** the spec calls this `0005_production.sql`, but `0005` was taken by the generation function in Phase 3 Task 3.2. This is **`0006_production.sql`**. Numbering is sequential, not phase-indexed.

---

## Task 4.1: Migration 0006 — bake list and shopping list

**Files:**
- Create: `supabase/migrations/0006_production.sql`
- Modify: `supabase/verify.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0006_production.sql`:

```sql
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
```

- [ ] **Step 2: Show the SQL to the user, then apply** — MCP `apply_migration`, `name: "0006_production"`.

- [ ] **Step 3: Add the Phase 4 assertions to `supabase/verify.sql`**

Append:

```sql
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
    raise notice 'P4.2 SKIPPED: no draft or cancelled orders in the window to test with';
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
```

- [ ] **Step 4: Run verify.sql** via MCP `execute_sql` → no exception.

- [ ] **Step 5: Verify the arithmetic by hand once**

With the Phase 3 seeded orders in place:

```sql
select product_name, total_quantity from public.f_bake_list(public.f_today(), public.f_today() + 7);
select ingredient_name, total_needed, pack_size, packs_to_buy, estimated_cost
from public.f_shopping_list(public.f_today(), public.f_today() + 7);
```

Take one ingredient and compute it yourself: `total_needed = Σ(order quantity × recipe quantity per unit)`, `packs_to_buy = ceil(total_needed / pack_size)`, `estimated_cost = packs_to_buy × pack_cost`.
**A mismatch is a bug in the SQL, not a rounding quirk. Find it.**

- [ ] **Step 6: Regenerate types** → MCP `generate_typescript_types`, then `npm run typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0006_production.sql supabase/verify.sql src/lib/database.types.ts
git commit -m "feat(db): migration 0006 — bake list, shopping list, delivery schedule"
```

---

## Task 4.2: Production queries and the week picker

**Files:**
- Create: `src/lib/queries/production.ts`
- Create: `src/lib/week.ts`
- Create: `src/lib/week.test.ts`

- [ ] **Step 1: Write the failing week-maths test**

Create `src/lib/week.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveWeek, shiftWeek } from '@/lib/week'

describe('resolveWeek', () => {
  it('defaults to the Monday–Sunday week containing today', () => {
    // 2026-08-06 is a Thursday.
    expect(resolveWeek(undefined, new Date('2026-08-06T09:00:00.000Z'))).toEqual({
      from: '2026-08-03', to: '2026-08-09',
    })
  })

  it('treats Sunday as the END of the week, not the start', () => {
    // 2026-08-09 is a Sunday. With weekStartsOn Monday it belongs to the
    // week beginning 2026-08-03 — a Sunday-start default would silently
    // shift every bake list by a day.
    expect(resolveWeek(undefined, new Date('2026-08-09T09:00:00.000Z'))).toEqual({
      from: '2026-08-03', to: '2026-08-09',
    })
  })

  it('snaps an arbitrary date param to its containing week', () => {
    expect(resolveWeek('2026-08-06', new Date('2026-01-01T00:00:00.000Z'))).toEqual({
      from: '2026-08-03', to: '2026-08-09',
    })
  })

  it('falls back to the current week for a malformed param', () => {
    expect(resolveWeek('not-a-date', new Date('2026-08-06T09:00:00.000Z'))).toEqual({
      from: '2026-08-03', to: '2026-08-09',
    })
  })
})

describe('shiftWeek', () => {
  it('moves forward one week', () => {
    expect(shiftWeek('2026-08-03', 1)).toBe('2026-08-10')
  })

  it('moves back one week across a month boundary', () => {
    expect(shiftWeek('2026-08-03', -1)).toBe('2026-07-27')
  })
})
```

- [ ] **Step 2: Run and watch it fail** → `npm test` → FAIL.

- [ ] **Step 3: Write it**

Create `src/lib/week.ts`:

```ts
import { addWeeks, endOfWeek, format, isValid, parseISO, startOfWeek } from 'date-fns'

export type Week = { from: string; to: string }

/**
 * Monday–Sunday. weekStartsOn: 1 everywhere in this app — the dashboard's
 * week summary, the production page and the insights period picker must
 * agree, or the same orders appear in two different weeks.
 */
const OPTS = { weekStartsOn: 1 as const }

export function resolveWeek(param: string | undefined, now: Date = new Date()): Week {
  const parsed = param ? parseISO(param) : null
  const anchor = parsed && isValid(parsed) ? parsed : now
  return {
    from: format(startOfWeek(anchor, OPTS), 'yyyy-MM-dd'),
    to:   format(endOfWeek(anchor, OPTS),   'yyyy-MM-dd'),
  }
}

export function shiftWeek(from: string, by: number): string {
  return format(addWeeks(parseISO(from), by), 'yyyy-MM-dd')
}
```

- [ ] **Step 4: Run and watch it pass** → `npm test` → PASS.

- [ ] **Step 5: The queries**

Create `src/lib/queries/production.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type BakeListRow = {
  product_id: string
  product_name: string
  product_unit: string
  total_quantity: number
  contributors: {
    order_id: string
    order_number: number
    customer_name: string
    delivery_date: string
    quantity: number
  }[]
}

export type ShoppingListRow = {
  ingredient_id: string
  ingredient_name: string
  unit: string
  total_needed: number
  pack_size: number
  packs_to_buy: number
  estimated_cost: number
}

export type DeliveryRow = Tables<'v_delivery_schedule'>

export async function getBakeList(from: string, to: string): Promise<BakeListRow[]> {
  const supabase = await createClient()
  // Parameters are p_-prefixed because `from` and `to` are reserved words
  // in Postgres and cannot be function parameter names. Spec §3.
  const { data, error } = await supabase.rpc('f_bake_list', { p_from: from, p_to: to })
  if (error) throw new Error(`Could not build the bake list: ${error.message}`)
  return (data ?? []) as unknown as BakeListRow[]
}

export async function getShoppingList(from: string, to: string): Promise<ShoppingListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('f_shopping_list', { p_from: from, p_to: to })
  if (error) throw new Error(`Could not build the shopping list: ${error.message}`)
  return (data ?? []) as unknown as ShoppingListRow[]
}

export async function getDeliverySchedule(
  from: string,
  to: string,
): Promise<DeliveryRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_delivery_schedule')
    .select('*')
    .gte('delivery_date', from)
    .lte('delivery_date', to)
    .order('delivery_date', { ascending: true })
    .order('customer_name', { ascending: true })

  if (error) throw new Error(`Could not load deliveries: ${error.message}`)
  return data ?? []
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/week.ts src/lib/week.test.ts src/lib/queries/production.ts
git commit -m "feat(production): week resolution and bake/shopping/delivery queries"
```

---

## Task 4.3: The production page

**Files:**
- Create: `src/app/(app)/production/page.tsx`
- Create: `src/app/(app)/production/week-picker.tsx`
- Create: `src/app/(app)/production/bake-list.tsx`
- Create: `src/app/(app)/production/shopping-list.tsx`
- Create: `src/app/(app)/production/delivery-schedule.tsx`
- Create: `src/app/(app)/production/mark-in-production.tsx`

- [ ] **Step 1: The page**

Create `src/app/(app)/production/page.tsx`:

```tsx
import { resolveWeek } from '@/lib/week'
import { getBakeList, getDeliverySchedule, getShoppingList } from '@/lib/queries/production'
import { formatDateRange } from '@/lib/format'
import { WeekPicker } from './week-picker'
import { BakeList } from './bake-list'
import { ShoppingList } from './shopping-list'
import { DeliverySchedule } from './delivery-schedule'

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  // Next 16: searchParams is a Promise.
  const { week } = await searchParams
  const { from, to } = resolveWeek(week)

  const [bake, shopping, deliveries] = await Promise.all([
    getBakeList(from, to),
    getShoppingList(from, to),
    getDeliverySchedule(from, to),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-semibold">Production</h1>
        <WeekPicker from={from} />
      </div>

      {/* Only visible on paper: the printed sheet must say which week it is,
          or a sheet left on the counter is worse than no sheet. */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Bake list — {formatDateRange(from, to)}</h1>
      </div>

      <BakeList rows={bake} from={from} to={to} />
      <ShoppingList rows={shopping} />
      <DeliverySchedule rows={deliveries} />
    </div>
  )
}
```

- [ ] **Step 2: The week picker**

Create `src/app/(app)/production/week-picker.tsx`:

```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { format } from 'date-fns'
import { shiftWeek } from '@/lib/week'
import { Button } from '@/components/ui/button'

export function WeekPicker({ from }: { from: string }) {
  const router = useRouter()
  const params = useSearchParams()

  function go(week: string) {
    const next = new URLSearchParams(params.toString())
    next.set('week', week)
    router.replace(`/production?${next.toString()}`, { scroll: false })
  }

  const thisWeek = format(new Date(), 'yyyy-MM-dd')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" className="size-11" onClick={() => go(shiftWeek(from, -1))}>
        <ChevronLeft className="size-4" aria-hidden />
        <span className="sr-only">Previous week</span>
      </Button>
      <Button variant="outline" className="h-11" onClick={() => go(thisWeek)}>
        This week
      </Button>
      <Button variant="outline" size="icon" className="size-11" onClick={() => go(shiftWeek(from, 1))}>
        <ChevronRight className="size-4" aria-hidden />
        <span className="sr-only">Next week</span>
      </Button>
      <Button className="h-11" onClick={() => window.print()}>
        <Printer className="size-4" aria-hidden />
        Print
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: The bake list**

Create `src/app/(app)/production/bake-list.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import type { BakeListRow } from '@/lib/queries/production'
import { formatDate } from '@/lib/format'
import { NoDataYet } from '@/components/app/empty-state'
import { MarkInProduction } from './mark-in-production'

export function BakeList({
  rows,
  from,
  to,
}: {
  rows: BakeListRow[]
  from: string
  to: string
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())

  if (rows.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-lg font-semibold">Bake list</h2>
        <NoDataYet
          title="Nothing to bake this week"
          description="Orders with a delivery date in this week will appear here automatically."
        />
      </section>
    )
  }

  const allOrderIds = [
    ...new Set(rows.flatMap((r) => r.contributors.map((c) => c.order_id))),
  ]

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Bake list</h2>
        <div className="print:hidden">
          <MarkInProduction orderIds={allOrderIds} />
        </div>
      </div>

      <ul className="divide-y rounded-lg border print:border-0">
        {rows.map((row) => {
          const isOpen = open.has(row.product_id)
          return (
            <li key={row.product_id}>
              <button
                type="button"
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s)
                    if (n.has(row.product_id)) n.delete(row.product_id)
                    else n.add(row.product_id)
                    return n
                  })
                }
                className="flex min-h-14 w-full items-center gap-3 px-3 text-left hover:bg-accent/50 print:min-h-0 print:py-1"
              >
                {/* Quantity first and large: this is read at arm's length
                    from a printed sheet on a worktop. */}
                <span className="w-20 shrink-0 text-right text-2xl font-bold tabular-nums print:text-xl">
                  {row.total_quantity}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-lg font-medium print:text-base">{row.product_name}</span>
                  <span className="ml-1 text-sm text-muted-foreground">
                    {row.product_unit}s · {row.contributors.length} orders
                  </span>
                </span>
                <ChevronDown
                  className={isOpen ? 'size-4 rotate-180 print:hidden' : 'size-4 print:hidden'}
                  aria-hidden
                />
              </button>

              {isOpen ? (
                <ul className="space-y-1 bg-muted/40 px-3 pb-3 pl-24 text-sm">
                  {row.contributors.map((c) => (
                    <li key={`${c.order_id}-${row.product_id}`} className="flex justify-between gap-2">
                      <Link href={`/orders/${c.order_id}`} className="underline-offset-4 hover:underline">
                        {c.customer_name}
                      </Link>
                      <span className="text-muted-foreground">
                        {formatDate(c.delivery_date)} · {c.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: The shopping list**

Create `src/app/(app)/production/shopping-list.tsx`:

```tsx
import type { ShoppingListRow } from '@/lib/queries/production'
import { Money } from '@/components/app/money'
import { NoDataYet } from '@/components/app/empty-state'

export function ShoppingList({ rows }: { rows: ShoppingListRow[] }) {
  if (rows.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-lg font-semibold">Shopping list</h2>
        <NoDataYet
          title="Nothing to buy"
          description="Add recipes to your products and this list builds itself from the bake list."
        />
      </section>
    )
  }

  const total = rows.reduce((s, r) => s + Number(r.estimated_cost), 0)

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Shopping list</h2>
      <div className="overflow-hidden rounded-lg border print:border-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 print:bg-transparent">
            <tr>
              <th className="p-2 text-left font-medium">Ingredient</th>
              <th className="p-2 text-right font-medium">Needed</th>
              <th className="p-2 text-right font-medium">Packs</th>
              <th className="p-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.ingredient_id}>
                <td className="p-2">{r.ingredient_name}</td>
                <td className="p-2 text-right tabular-nums">
                  {Number(r.total_needed)} {r.unit}
                </td>
                {/* The number she acts on. Largest thing in the row. */}
                <td className="p-2 text-right text-base font-bold tabular-nums">
                  {r.packs_to_buy}
                </td>
                <td className="p-2 text-right"><Money value={r.estimated_cost} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2">
            <tr>
              <td className="p-2 font-semibold" colSpan={3}>Estimated total</td>
              <td className="p-2 text-right font-semibold"><Money value={total} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
```

- [ ] **Step 5: The delivery schedule**

Create `src/app/(app)/production/delivery-schedule.tsx`. A Server Component grouping `rows` by `delivery_date`, with an `<h3>` per day showing `formatDate(date)` and the weekday. Under each day, one card per delivery: customer name (linking to `/customers/{customer_id}`), `total_units` units, the item list from the `items` jsonb (`{quantity} × {name}`), the **snapshotted** `delivery_address`, `delivery_notes_snapshot` rendered prominently (it is the thing that stops a wasted trip), and `customer_phone` as a `tel:` link. Empty state: `<NoDataYet title="No deliveries this week" description="Confirmed orders with a delivery date this week will show up here with their addresses." />`.

- [ ] **Step 6: The bulk action**

Create `src/app/(app)/production/mark-in-production.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { setOrderStatusBulk } from '@/lib/actions/orders'
import { Button } from '@/components/ui/button'

export function MarkInProduction({ orderIds }: { orderIds: string[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (orderIds.length === 0) return null

  return (
    <Button
      variant="outline"
      className="h-11"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        const result = await setOrderStatusBulk(orderIds, 'in_production')
        setBusy(false)
        if (!result.ok) { toast.error(result.error); return }
        toast.success(`Marked ${result.count} order${result.count === 1 ? '' : 's'} in production`)
        router.refresh()
      }}
    >
      Mark this week&apos;s orders in production
    </Button>
  )
}
```

Not optimistic — it touches many objects at once, and spec §6.4 restricts optimistic UI to single-object mutations.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/production"
git commit -m "feat(production): bake list, shopping list, delivery schedule with week picker"
```

---

## Task 4.4: The print stylesheet

Spec §7 Phase 4: *"Not optional polish — it is how the feature gets used."*

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add the print rules**

Append to `src/app/globals.css`:

```css
/* ────────────────────────────────────────────────────────────────────
   Print. She prints the bake list and takes it into the kitchen, and
   prints invoices via Save as PDF (Phase 5). Both must be legible at
   arm's length and readable in black and white.
   ──────────────────────────────────────────────────────────────────── */
@media print {
  /* Force light rendering regardless of the on-screen theme. Printing a
     dark-mode page wastes an entire toner cartridge. */
  :root,
  :root[data-theme='dark'],
  .dark {
    color-scheme: light;
    --background: #fff;
    --foreground: #000;
    --muted: #fff;
    --muted-foreground: #333;
    --border: #999;
    --card: #fff;
    --card-foreground: #000;
    --accent: #fff;
    --primary: #000;
  }

  html,
  body {
    background: #fff !important;
    color: #000 !important;
    font-size: 12pt;
  }

  /* Navigation, controls and anything interactive. */
  aside,
  header,
  nav,
  [data-slot='toaster'],
  .print\:hidden {
    display: none !important;
  }

  main {
    padding: 0 !important;
    margin: 0 !important;
    max-width: none !important;
  }

  /* Flatten the app chrome so content starts at the top of the sheet. */
  body > div,
  main > div {
    display: block !important;
  }

  /* Never split a product or a delivery across two pages. */
  li,
  tr,
  section > div {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  h1, h2, h3 {
    break-after: avoid;
    page-break-after: avoid;
  }

  a {
    color: #000 !important;
    text-decoration: none !important;
  }

  /* URLs after links would be noise on a kitchen worktop. */
  a[href]::after {
    content: '' !important;
  }

  table {
    border-collapse: collapse;
    width: 100%;
  }

  th, td {
    border-bottom: 1px solid #999;
  }

  @page {
    margin: 12mm;
  }
}
```

- [ ] **Step 2: Verify — this is a Phase 4 acceptance criterion**

Open `/production` with a full week of seeded orders and press Print (or Ctrl+P).

1. The print preview has **no sidebar, no topbar, no buttons**. ✅
2. It is **black on white** even with dark mode on. ✅
3. The week's date range appears as a heading. ✅
4. Quantities are large enough to read from a metre away. ✅
5. A typical week fits **one page**. If it does not, reduce the delivery-schedule detail — the bake list and shopping list are the parts that must fit. ✅
6. No product row is split across a page break. ✅

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(production): print stylesheet — light-forced, chrome-free, page-break safe"
```

---

## Task 4.5: Phase Exit — acceptance gate

- [ ] `npm run typecheck` → clean, no `any`, no `@ts-ignore`
- [ ] `npm test` → all pass, including the 6 week-maths tests
- [ ] `npm run build` → succeeds
- [ ] `verify.sql` runs clean (through P4.3)
- [ ] Bake list totals equal the sum of order items across the range, **verified by hand** against seed data
- [ ] `draft` and `cancelled` are excluded; **`delivered` is included** — mark one order delivered mid-week, reprint, and confirm the totals are unchanged
- [ ] Shopping list `packs_to_buy` = `ceil(total_needed / pack_size)` for every row, checked by hand on one ingredient
- [ ] The estimated cost total matches the sum of the rows
- [ ] Printed output is legible at arm's length and fits one page for a typical week
- [ ] Printing while in dark mode still produces black on white
- [ ] "Mark this week's orders in production" updates every contributing order
- [ ] The delivery schedule shows the **snapshotted** address, not the customer's current one — change a customer's address and confirm an existing order's delivery sheet is unchanged
- [ ] Both empty states behave: an empty week shows "Nothing to bake this week"
- [ ] Usable at 375px
- [ ] Open the PR: `gh pr create --title "Phase 4 — Production"`
