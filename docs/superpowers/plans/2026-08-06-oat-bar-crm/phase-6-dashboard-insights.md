# Phase 6 — Dashboard and Insights — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn passive records into a prompt to act. The at-risk-customer list is the feature that justifies the whole application — everything else is bookkeeping she could do on paper.

**Architecture:** All aggregation is SQL — one view and four `stable` functions. Charts are `"use client"` Recharts 3 inside shadcn's `ChartContainer`, with an explicit minimum height, because an unmeasured container is the top cause of blank charts.

**Tech Stack:** Adds Recharts 3.10 (already installed in Phase 0) and shadcn's `chart` component. No new dependencies.

---

**Branch:** `git checkout main && git pull && git checkout -b phase-6-insights`

**Depends on:** Phase 5 complete. Migration number is **`0008_insights.sql`** (the spec says 0007; that number went to invoices).

---

## Task 6.1: Migration 0008 — customer summary and reporting functions

**Files:**
- Create: `supabase/migrations/0008_insights.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0008_insights.sql`:

```sql
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
```

- [ ] **Step 2: Show the SQL to the user, then apply** — MCP `apply_migration`, `name: "0008_insights"`.

- [ ] **Step 3: Add the Phase 6 assertions to `supabase/verify.sql`**

These encode the spec's exact risk-flag guard cases.

```sql
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
```

- [ ] **Step 4: Run verify.sql** via MCP `execute_sql` → no exception.

- [ ] **Step 5: Regenerate types** → MCP `generate_typescript_types`, then `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0008_insights.sql supabase/verify.sql src/lib/database.types.ts
git commit -m "feat(db): migration 0008 — customer summary with risk flag, product performance, monthly series"
```

---

## Task 6.2: Insight queries

**Files:**
- Create: `src/lib/queries/insights.ts`
- Create: `src/lib/period.ts`
- Create: `src/lib/period.test.ts`

- [ ] **Step 1: Write the failing period test**

Create `src/lib/period.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolvePeriod, PERIOD_OPTIONS } from '@/lib/period'

const NOW = new Date('2026-08-06T09:00:00.000Z') // Thursday

describe('resolvePeriod', () => {
  it('defaults to this month', () => {
    expect(resolvePeriod(undefined, undefined, undefined, NOW)).toEqual({
      key: 'this_month', from: '2026-08-01', to: '2026-08-31',
    })
  })

  it('resolves last month across a year boundary', () => {
    expect(resolvePeriod('last_month', undefined, undefined, new Date('2027-01-15T00:00:00.000Z')))
      .toEqual({ key: 'last_month', from: '2026-12-01', to: '2026-12-31' })
  })

  it('resolves the last 90 days inclusive of today', () => {
    const r = resolvePeriod('last_90', undefined, undefined, NOW)
    expect(r.to).toBe('2026-08-06')
    expect(r.from).toBe('2026-05-09')
  })

  it('resolves this year', () => {
    expect(resolvePeriod('this_year', undefined, undefined, NOW)).toEqual({
      key: 'this_year', from: '2026-01-01', to: '2026-12-31',
    })
  })

  it('honours a custom range', () => {
    expect(resolvePeriod('custom', '2026-03-01', '2026-03-31', NOW)).toEqual({
      key: 'custom', from: '2026-03-01', to: '2026-03-31',
    })
  })

  it('falls back to this month when custom dates are missing or reversed', () => {
    expect(resolvePeriod('custom', undefined, undefined, NOW).key).toBe('this_month')
    expect(resolvePeriod('custom', '2026-03-31', '2026-03-01', NOW).key).toBe('this_month')
  })

  it('falls back to this month for an unknown key', () => {
    expect(resolvePeriod('last_decade', undefined, undefined, NOW).key).toBe('this_month')
  })

  it('exports options in the order the picker should show them', () => {
    expect(PERIOD_OPTIONS.map((o) => o.key)).toEqual([
      'this_month', 'last_month', 'last_90', 'this_year', 'custom',
    ])
  })
})
```

- [ ] **Step 2: Run and watch it fail** → `npm test` → FAIL.

- [ ] **Step 3: Write it**

Create `src/lib/period.ts`:

```ts
import {
  endOfMonth, endOfYear, format, isValid, parseISO,
  startOfMonth, startOfYear, subDays, subMonths,
} from 'date-fns'

export type PeriodKey = 'this_month' | 'last_month' | 'last_90' | 'this_year' | 'custom'

export type Period = { key: PeriodKey; from: string; to: string }

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_90',    label: 'Last 90 days' },
  { key: 'this_year',  label: 'This year' },
  { key: 'custom',     label: 'Custom' },
]

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

export function resolvePeriod(
  key: string | undefined,
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): Period {
  if (key === 'last_month') {
    const m = subMonths(now, 1)
    return { key: 'last_month', from: iso(startOfMonth(m)), to: iso(endOfMonth(m)) }
  }
  if (key === 'last_90') {
    return { key: 'last_90', from: iso(subDays(now, 89)), to: iso(now) }
  }
  if (key === 'this_year') {
    return { key: 'this_year', from: iso(startOfYear(now)), to: iso(endOfYear(now)) }
  }
  if (key === 'custom' && from && to) {
    const a = parseISO(from)
    const b = parseISO(to)
    if (isValid(a) && isValid(b) && from <= to) {
      return { key: 'custom', from, to }
    }
  }
  return { key: 'this_month', from: iso(startOfMonth(now)), to: iso(endOfMonth(now)) }
}
```

`last_90` uses `subDays(now, 89)` so the range is 90 days **inclusive of today** — an off-by-one here quietly shifts every comparison.

- [ ] **Step 4: Run and watch it pass** → `npm test` → PASS.

- [ ] **Step 5: The queries**

Create `src/lib/queries/insights.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type CustomerSummary = Tables<'v_customer_summary'>

export type ProductPerformance = {
  product_id: string
  product_name: string
  units_sold: number
  revenue: number
  cost: number
  margin: number
  margin_pct: number | null
}

export type MonthlyRevenue = { month: string; revenue: number; order_count: number }
export type MonthlyCustomers = { month: string; new_customers: number }

export type OutreachEffectiveness = {
  channel: string
  interaction_count: number
  customers_touched: number
  customers_who_ordered: number
  conversion_pct: number | null
}

export async function listCustomerSummaries(): Promise<CustomerSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_customer_summary')
    .select('*')
    .is('archived_at', null)
    .order('lifetime_revenue', { ascending: false })

  if (error) throw new Error(`Could not load customer summaries: ${error.message}`)
  return data ?? []
}

/** The dashboard's "Needs attention" section. */
export async function listAtRiskCustomers(): Promise<CustomerSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_customer_summary')
    .select('*')
    .eq('risk_flag', true)
    .order('days_since_last_order', { ascending: false })

  if (error) throw new Error(`Could not load at-risk customers: ${error.message}`)
  return data ?? []
}

export async function getProductPerformance(
  from: string,
  to: string,
): Promise<ProductPerformance[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('f_product_performance', {
    p_from: from, p_to: to,
  })
  if (error) throw new Error(`Could not load product performance: ${error.message}`)
  return (data ?? []) as unknown as ProductPerformance[]
}

export async function getRevenueByMonth(months = 12): Promise<MonthlyRevenue[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('f_revenue_by_month', { p_months: months })
  if (error) throw new Error(`Could not load monthly revenue: ${error.message}`)
  return (data ?? []) as unknown as MonthlyRevenue[]
}

export async function getNewCustomersByMonth(months = 12): Promise<MonthlyCustomers[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('f_new_customers_by_month', { p_months: months })
  if (error) throw new Error(`Could not load new customers: ${error.message}`)
  return (data ?? []) as unknown as MonthlyCustomers[]
}

export async function getOutreachEffectiveness(
  from: string,
  to: string,
): Promise<OutreachEffectiveness[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('f_outreach_effectiveness', {
    p_from: from, p_to: to,
  })
  if (error) throw new Error(`Could not load outreach data: ${error.message}`)
  return (data ?? []) as unknown as OutreachEffectiveness[]
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/period.ts src/lib/period.test.ts src/lib/queries/insights.ts
git commit -m "feat(insights): period resolution and reporting queries"
```

---

## Task 6.3: The "Needs attention" dashboard section

Spec §7 Phase 6: *"This is the insight that justifies the whole application."* Build it carefully.

**Files:**
- Create: `src/components/app/at-risk-customers.tsx`
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: Build the component**

Create `src/components/app/at-risk-customers.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import type { CustomerSummary } from '@/lib/queries/insights'
import type { Contact } from '@/lib/queries/customers'
import { Money } from '@/components/app/money'
import { DateDisplay } from '@/components/app/date-display'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InteractionSheet } from '@/app/(app)/customers/[id]/interaction-sheet'

export function AtRiskCustomers({
  customers,
  contactsByCustomer,
}: {
  customers: CustomerSummary[]
  /** Pre-fetched so "Log outreach" opens instantly with the right contact. */
  contactsByCustomer: Record<string, Contact[]>
}) {
  const [loggingFor, setLoggingFor] = useState<string | null>(null)

  if (customers.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4" aria-hidden />
        Nobody has gone quiet. Everyone is ordering about as often as usual.
      </div>
    )
  }

  return (
    <>
      <ul className="space-y-2">
        {customers.map((c) => {
          const gap = c.avg_gap_days ? Math.round(Number(c.avg_gap_days)) : null
          return (
            <li
              key={c.customer_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/customers/${c.customer_id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <Badge variant="destructive">
                    {c.days_since_last_order} days quiet
                  </Badge>
                </div>
                {/* Say WHY it is flagged. A flag without a reason is noise
                    she will learn to ignore. */}
                <p className="text-sm text-muted-foreground">
                  Usually orders every {gap ?? '—'} days ·{' '}
                  {c.order_count} orders · <Money value={c.lifetime_revenue} /> lifetime
                  {c.last_contacted_at ? (
                    <> · last spoke <DateDisplay value={c.last_contacted_at} /></>
                  ) : (
                    <> · never contacted</>
                  )}
                </p>
              </div>

              {/* One click, per spec §7 Phase 6. Not a navigation. */}
              <Button
                variant="outline"
                className="h-11 shrink-0"
                onClick={() => setLoggingFor(c.customer_id)}
              >
                Log outreach
              </Button>
            </li>
          )
        })}
      </ul>

      {loggingFor ? (
        <InteractionSheet
          customerId={loggingFor}
          contacts={contactsByCustomer[loggingFor] ?? []}
          open
          onOpenChange={(open) => { if (!open) setLoggingFor(null) }}
        />
      ) : null}
    </>
  )
}
```

- [ ] **Step 2: A query for the contacts**

Append to `src/lib/queries/insights.ts`:

```ts
import type { Contact } from '@/lib/queries/customers'

/** One round trip for the contacts of every at-risk customer. */
export async function getContactsFor(
  customerIds: string[],
): Promise<Record<string, Contact[]>> {
  if (customerIds.length === 0) return {}

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .in('customer_id', customerIds)
    .order('is_primary', { ascending: false })

  if (error) throw new Error(`Could not load contacts: ${error.message}`)

  const out: Record<string, Contact[]> = {}
  for (const c of data ?? []) {
    ;(out[c.customer_id] ??= []).push(c)
  }
  return out
}
```

- [ ] **Step 3: Wire it into the dashboard**

Replace the Phase 6 placeholder in `src/app/(app)/page.tsx`:

```tsx
const atRisk = await listAtRiskCustomers()
const contactsByCustomer = await getContactsFor(atRisk.map((c) => c.customer_id!))
```

```tsx
      <DashboardSection
        title="Needs attention"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/insights">See all insights</Link>
          </Button>
        }
      >
        <AtRiskCustomers customers={atRisk} contactsByCustomer={contactsByCustomer} />
      </DashboardSection>
```

- [ ] **Step 4: Verify — this is a Phase 6 acceptance criterion**

Seed these four cases and check each:

```sql
-- A: 4 orders, roughly every 14 days, last one 60 days ago → MUST be flagged
-- B: 2 orders, last one 120 days ago                       → must NOT be flagged
-- C: 5 orders, last one 5 days ago                         → must NOT be flagged
-- D: 4 orders, last one 60 days ago, but archived          → must NOT be flagged
-- E: status 'lead', no orders                              → must NOT be flagged
```

Then confirm in SQL:

```sql
select name, order_count, days_since_last_order, round(avg_gap_days) as gap, risk_flag
from public.v_customer_summary order by risk_flag desc, name;
```

Expected: **only A** has `risk_flag = true`. ✅
*(spec: "flags a seeded customer whose last order is well past their usual gap, and does not flag a customer with fewer than three orders, an archived customer, or a lead")*

Then in the UI: A appears on the dashboard with a reason line. Click "Log outreach" → the interaction sheet opens **without navigating away**, pre-filled with their primary contact. Save → A's `last_contacted_at` updates, though it stays flagged, because logging a call is not an order. ✅

- [ ] **Step 5: Commit**

```bash
git add src/components/app/at-risk-customers.tsx src/lib/queries/insights.ts "src/app/(app)/page.tsx"
git commit -m "feat(dashboard): at-risk customers with reason line and one-click outreach"
```

---

## Task 6.4: Dashboard charts

**Files:**
- Create: `src/components/app/charts/revenue-chart.tsx`
- Create: `src/components/app/charts/product-mix-chart.tsx`
- Create: `src/components/app/charts/new-customers-chart.tsx`
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: Add the chart primitive**

```bash
npx shadcn@4.16.1 add chart
```

- [ ] **Step 2: The revenue chart**

Create `src/components/app/charts/revenue-chart.tsx`:

```tsx
'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { format, parseISO } from 'date-fns'
import type { MonthlyRevenue } from '@/lib/queries/insights'
import { formatMoney } from '@/lib/format'
import { useSettings } from '@/components/app/settings-provider'
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart'

const config = {
  revenue: { label: 'Revenue', color: 'var(--chart-1)' },
} satisfies ChartConfig

export function RevenueChart({ data }: { data: MonthlyRevenue[] }) {
  const settings = useSettings()

  const rows = data.map((d) => ({
    month: format(parseISO(d.month), 'MMM'),
    revenue: Number(d.revenue),
  }))

  return (
    // min-h is NOT optional. An unmeasured ChartContainer is the top cause
    // of a blank chart and of layout shift on first paint. Spec §7 Phase 6.
    <ChartContainer config={config} className="min-h-[300px] w-full">
      <BarChart data={rows} accessibilityLayer margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v: number) => formatMoney(v, settings)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => formatMoney(Number(value), settings)}
            />
          }
        />
        {/* Recharts 3 with shadcn: var(--chart-1), NOT hsl(var(--chart-1)). */}
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
```

- [ ] **Step 3: The other two charts**

Create `src/components/app/charts/product-mix-chart.tsx` following the same shape. Complete delta: takes `data: ProductPerformance[]`; maps to `{ name: product_name, units: Number(units_sold) }`; renders a **horizontal** `BarChart` (`layout="vertical"`, `<XAxis type="number" />`, `<YAxis dataKey="name" type="category" width={110} />`) because product names do not fit under vertical bars; `config` is `{ units: { label: 'Units', color: 'var(--chart-2)' } }`; the tooltip formats as a plain integer, not money.

Create `src/components/app/charts/new-customers-chart.tsx`. Complete delta: takes `data: MonthlyCustomers[]`; maps to `{ month: format(parseISO(d.month), 'MMM'), customers: d.new_customers }`; a vertical `BarChart` like the revenue chart; `config` is `{ customers: { label: 'New customers', color: 'var(--chart-3)' } }`; the Y axis formats as an integer with `allowDecimals={false}`.

All three: `className="min-h-[300px] w-full"` on the `ChartContainer`, and all three are `'use client'`.

- [ ] **Step 4: Wire them in**

In `src/app/(app)/page.tsx`, fetch:

```tsx
const [revenueSeries, productMix, newCustomers] = await Promise.all([
  getRevenueByMonth(12),
  getProductPerformance(format(subDays(new Date(), 89), 'yyyy-MM-dd'), format(new Date(), 'yyyy-MM-dd')),
  getNewCustomersByMonth(12),
])
```

Add a fourth section, **Trends**, below Needs attention, with three cards: "Revenue by month" (`RevenueChart`), "Product mix, last 90 days" (`ProductMixChart`), "New customers by month" (`NewCustomersChart`). Grid `md:grid-cols-2` with the revenue chart spanning both columns.

- [ ] **Step 5: Verify — a Phase 6 acceptance criterion**

1. All three charts render on **first paint**, with no blank frame and no layout shift as they measure. ✅ If one is blank, its `ChartContainer` is missing `min-h-[300px]`.
2. Y-axis money labels use the currency from Settings. ✅
3. Empty months show as zero bars, not gaps. ✅
4. Switch to dark mode → the chart colours are still legible and the axis text is readable. ✅
5. At 375px the charts are readable and do not overflow horizontally. ✅

- [ ] **Step 6: Commit**

```bash
git add src/components/app/charts "src/app/(app)/page.tsx" src/components/ui/chart.tsx
git commit -m "feat(dashboard): revenue, product-mix and new-customer charts"
```

---

## Task 6.5: The insights page

**Files:**
- Create: `src/app/(app)/insights/page.tsx`
- Create: `src/app/(app)/insights/period-picker.tsx`
- Create: `src/app/(app)/insights/revenue-by-customer.tsx`
- Create: `src/app/(app)/insights/product-performance-table.tsx`
- Create: `src/app/(app)/insights/order-cadence.tsx`
- Create: `src/app/(app)/insights/outreach-table.tsx`

- [ ] **Step 1: The page**

Create `src/app/(app)/insights/page.tsx`:

```tsx
import { resolvePeriod } from '@/lib/period'
import {
  getOutreachEffectiveness, getProductPerformance, listCustomerSummaries,
} from '@/lib/queries/insights'
import { formatDateRange } from '@/lib/format'
import { PeriodPicker } from './period-picker'
import { RevenueByCustomer } from './revenue-by-customer'
import { ProductPerformanceTable } from './product-performance-table'
import { OrderCadence } from './order-cadence'
import { OutreachTable } from './outreach-table'

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  const sp = await searchParams
  const period = resolvePeriod(sp.period, sp.from, sp.to)

  const [summaries, performance, outreach] = await Promise.all([
    listCustomerSummaries(),
    getProductPerformance(period.from, period.to),
    getOutreachEffectiveness(period.from, period.to),
  ])

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Insights</h1>
          <p className="text-sm text-muted-foreground">
            {formatDateRange(period.from, period.to)}
          </p>
        </div>
        <PeriodPicker period={period} />
      </div>

      <ProductPerformanceTable rows={performance} />
      <RevenueByCustomer rows={summaries} />
      <OrderCadence rows={summaries} />
      <OutreachTable rows={outreach} />
    </div>
  )
}
```

- [ ] **Step 2: The period picker**

Create `src/app/(app)/insights/period-picker.tsx`: a `'use client'` row of buttons over `PERIOD_OPTIONS`, writing `?period=` with `router.replace(..., { scroll: false })` — **persisted in the URL**, per spec §7 Phase 6. When `custom` is selected, reveal two `<input type="date">` fields writing `?from=` and `?to=`. Style the active option `variant="default"`, the rest `variant="outline"`, all `h-11`.

- [ ] **Step 3: Product performance**

Create `src/app/(app)/insights/product-performance-table.tsx` using the **Task 1.4 data table pattern**. Complete delta:

- **Data:** `ProductPerformance[]`
- **Columns:** `product_name` "Product" (`font-medium`); `units_sold` "Units" right-aligned; `revenue` "Revenue" right-aligned `<Money />`; `cost` "Cost" right-aligned `<Money />`; `margin` "Margin" right-aligned `<Money />`; `margin_pct` "Margin %" right-aligned
- **Highlight thin or negative margins** (spec §7 Phase 6): when `margin_pct === null` render `—`; when `< 0` render in `font-semibold text-destructive` with the word "Loss" appended; when `< 20` render in `text-amber-600 dark:text-amber-500`
- **No search, no pagination** — there are six products. Pass `pageSize={100}`
- **Initial sorting:** `[{ id: 'revenue', desc: true }]`
- **Mobile card:** product name; `{units_sold} units · <Money value={revenue} />`; the margin percentage with the same colour rules
- **`emptyState`:** `<NoDataYet title="No sales in this period" description="Pick a wider period, or record some orders." />` for both cases — there is no filter to clear here, so the two-empty-state rule collapses to one and that is correct

- [ ] **Step 4: Revenue by customer**

Create `src/app/(app)/insights/revenue-by-customer.tsx` using the **Task 1.4 data table pattern**. Complete delta:

- **Data:** `CustomerSummary[]`, filtered to `order_count > 0`
- **Columns:** `name` "Customer" (linking to `/customers/{customer_id}`); `order_count` "Orders" right-aligned; `lifetime_revenue` "Lifetime revenue" right-aligned `<Money />`; a computed `avg_order` = `lifetime_revenue / order_count` right-aligned `<Money />`; `last_order_date` "Last order" `<DateDisplay />`
- **Initial sorting:** `[{ id: 'lifetime_revenue', desc: true }]`
- **Note on the period picker:** lifetime revenue is by definition not period-scoped. Render a one-line caption saying so — *"Lifetime figures, not limited to the selected period."* — rather than silently ignoring the picker

- [ ] **Step 5: Order cadence**

Create `src/app/(app)/insights/order-cadence.tsx`. A table over `CustomerSummary[]` filtered to `order_count >= 2`, columns: Customer, `Math.round(avg_gap_days)` "Average gap (days)", `last_order_date`, `days_since_last_order`, and a **Trend** column reading `Overdue` in `text-destructive` when `risk_flag`, `Due soon` in amber when `days_since_last_order > avg_gap_days`, and `On track` otherwise. Sorted by `days_since_last_order` descending.

- [ ] **Step 6: Outreach effectiveness**

Create `src/app/(app)/insights/outreach-table.tsx`. A table over `OutreachEffectiveness[]`, columns: Channel (using `CHANNEL_LABELS`), Interactions, Customers reached, Went on to order, Conversion %. Sorted by conversion descending. Add a one-line explanation above it: *"Of the customers you contacted this way, how many placed an order afterwards. This is what tells you whether sample drops are worth the trip."*

- [ ] **Step 7: Verify**

1. Every figure on `/insights` is reproducible by hand from seed data. ✅
2. Change the period → every period-scoped table updates and the URL carries `?period=`. Refresh → the period survives. ✅
3. A custom range works, and a reversed one falls back to this month rather than erroring. ✅
4. A product sold below cost shows a red negative margin. ✅
5. At 375px everything is cards, no horizontal scroll. ✅

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/insights"
git commit -m "feat(insights): product performance, revenue by customer, cadence, outreach effectiveness"
```

---

## Task 6.6: Phase Exit — acceptance gate

- [ ] `npm run typecheck` → clean, no `any`, no `@ts-ignore`
- [ ] `npm test` → all pass, including the 8 period tests
- [ ] `npm run build` → succeeds
- [ ] `verify.sql` runs clean (through P6.6)
- [ ] Every dashboard number is reproducible by hand from seed data
- [ ] The at-risk list flags customer **A** (4 orders, well past their usual gap)
- [ ] It does **not** flag **B** (two orders), **D** (archived), or **E** (a lead)
- [ ] Each at-risk row states **why** it is flagged
- [ ] "Log outreach" opens the interaction sheet in place, without navigating
- [ ] Charts render on first paint with **no layout shift**
- [ ] Charts use `var(--chart-N)`, not `hsl(var(--chart-N))` — grep to confirm
- [ ] Every `ChartContainer` has `min-h-[300px]` — grep to confirm
- [ ] The `/insights` period picker is persisted in the URL and survives a refresh
- [ ] Genuinely useful at 375px — this is the screen she checks most often
- [ ] Open the PR: `gh pr create --title "Phase 6 — Dashboard and insights"`
