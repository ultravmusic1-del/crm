# Phase 1 — Customers, Contacts, Outreach — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The CRM core. Add a prospect in under ten seconds, log every touch, and never lose a follow-up.

**Architecture:** Three tables behind two views that do the aggregation in SQL. The customer list is a client-side TanStack Table v8 whose entire state lives in the URL. Editing happens in a right-hand non-modal sheet so the list stays visible. Interaction logging — the most repeated action in the app — gets a purpose-built sheet with quick-pick chips, not a generic form.

**Tech Stack:** TanStack Table 8.21 · React Hook Form 7 + Zod 4 · shadcn Field + Controller · sonner · date-fns 4

---

**Branch:** `git checkout main && git pull && git checkout -b phase-1-customers`

**This phase defines four reference patterns** used by every later phase. They are written out in full exactly once:

| Pattern | Task | File |
|---|---|---|
| URL-state data table | 1.4 | `src/components/app/data-table/*` |
| Two empty states in a list | 1.5 | inside `customers-table.tsx` |
| Field + Controller form | 1.6 | `src/components/app/form-fields.tsx` |
| Non-modal edit sheet | 1.9 | `src/components/app/record-sheet.tsx` |

Later phases say "use the pattern from Task 1.N" and then give their complete delta. If a delta ever leaves you guessing, that is a bug in this plan — report it rather than inventing.

---

## Task 1.1: Migration 0002 — customers, contacts, interactions

**Files:**
- Create: `supabase/migrations/0002_customers.sql`
- Modify: `src/lib/database.types.ts` (regenerated)
- Create: `supabase/verify.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0002_customers.sql`:

```sql
-- 0002_customers.sql
-- The CRM core: customers, the people at them, and every touch.

-- ────────────────────────────────────────────────────────────────────────
-- customers
-- ────────────────────────────────────────────────────────────────────────
create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  type           text not null default 'business'
                      check (type in ('business','individual')),
  status         text not null default 'lead'
                      check (status in ('lead','contacted','sampling','active','lapsed','lost')),
  email          text,
  phone          text,
  address_line1  text,
  address_line2  text,
  city           text,
  postcode       text,
  delivery_notes text,
  source         text,   -- free text by design; the UI suggests, never constrains
  price_tier     text not null default 'wholesale'
                      check (price_tier in ('wholesale','retail')),
  notes          text,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_customers_status      on public.customers (status);
create index idx_customers_name_lower  on public.customers (lower(name));
create index idx_customers_archived_at on public.customers (archived_at);

create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- contacts — people at a customer
-- ────────────────────────────────────────────────────────────────────────
create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name        text not null,
  role        text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_contacts_customer_id on public.contacts (customer_id);

-- At most one primary per customer.
create unique index idx_contacts_one_primary
  on public.contacts (customer_id) where is_primary;

-- The index above is not deferrable, so "make this one primary" would
-- collide with the existing primary if the app tried to order two
-- statements itself. Demote siblings in a trigger instead — then a Server
-- Action can do one naive UPDATE and always be correct.
create or replace function public.f_demote_other_primary_contacts()
returns trigger
language plpgsql
as $$
begin
  update public.contacts
     set is_primary = false
   where customer_id = new.customer_id
     and id <> new.id
     and is_primary;
  return new;
end;
$$;

revoke execute on function public.f_demote_other_primary_contacts() from public, anon;

-- WHEN (new.is_primary) is what stops this recursing: the demoting UPDATE
-- sets is_primary false, so the trigger does not re-fire for those rows.
create trigger trg_contacts_single_primary
  before insert or update of is_primary, customer_id on public.contacts
  for each row when (new.is_primary)
  execute function public.f_demote_other_primary_contacts();

create trigger trg_contacts_updated_at
  before update on public.contacts
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- interactions — the outreach log
-- ────────────────────────────────────────────────────────────────────────
create table public.interactions (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customers(id) on delete cascade,
  contact_id     uuid references public.contacts(id) on delete set null,
  occurred_at    timestamptz not null default now(),
  channel        text not null
                      check (channel in ('email','phone','whatsapp','in_person','sample_drop','other')),
  direction      text not null default 'outbound'
                      check (direction in ('outbound','inbound')),
  subject        text,
  notes          text,
  outcome        text
                      check (outcome in ('no_response','interested','not_interested','ordered','follow_up','other')),
  follow_up_on   date,
  follow_up_done boolean not null default false,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_interactions_customer_occurred
  on public.interactions (customer_id, occurred_at desc);

-- Powers "follow-ups due", which loads on every dashboard render.
-- Excluding nulls keeps the index to only the rows that can ever match.
create index idx_interactions_followup_open
  on public.interactions (follow_up_on)
  where not follow_up_done and follow_up_on is not null;

create trigger trg_interactions_updated_at
  before update on public.interactions
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- Views. security_invoker = on is mandatory: a view without it runs as its
-- owner and bypasses RLS on its base tables, publishing the entire dataset
-- to anyone with the publishable key.
-- ────────────────────────────────────────────────────────────────────────

-- Spec §8: aggregate in SQL, never in TypeScript. The list needs last
-- contact and next open follow-up per customer; both come from here.
create view public.v_customer_list
with (security_invoker = on) as
select
  c.*,
  agg.last_contacted_at,
  agg.open_follow_up_on
from public.customers c
left join lateral (
  select
    max(i.occurred_at)                                          as last_contacted_at,
    min(i.follow_up_on) filter (where not i.follow_up_done)     as open_follow_up_on
  from public.interactions i
  where i.customer_id = c.id
) agg on true;

revoke all on public.v_customer_list from anon;

create view public.v_follow_ups_due
with (security_invoker = on) as
select
  i.id,
  i.customer_id,
  c.name         as customer_name,
  i.follow_up_on,
  i.subject,
  i.notes,
  i.channel,
  i.outcome,
  (i.follow_up_on < public.f_today()) as is_overdue
from public.interactions i
join public.customers c on c.id = i.customer_id
where not i.follow_up_done
  and i.follow_up_on is not null
  and i.follow_up_on <= public.f_today()
  and c.archived_at is null;

revoke all on public.v_follow_ups_due from anon;

-- ────────────────────────────────────────────────────────────────────────
-- RLS — the blanket policy from spec §3.9, verbatim, on all three tables.
-- ────────────────────────────────────────────────────────────────────────
alter table public.customers    enable row level security;
alter table public.contacts     enable row level security;
alter table public.interactions enable row level security;

create policy "app users have full access" on public.customers
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));

create policy "app users have full access" on public.contacts
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));

create policy "app users have full access" on public.interactions
  for all to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));
```

- [ ] **Step 2: Show the SQL to the user, then apply**

MCP `apply_migration`, `name: "0002_customers"`.

- [ ] **Step 3: Start `supabase/verify.sql` with the assertions this phase owns**

Create `supabase/verify.sql`:

```sql
-- verify.sql — SQL assertions run against the seeded database.
-- Every block raises on failure. `psql -v ON_ERROR_STOP=1 -f` must exit 0.
-- Grown by every phase. Gated in Phase 8.

\set ON_ERROR_STOP on

-- ── Phase 1 ─────────────────────────────────────────────────────────────

do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from (
    select customer_id from public.contacts
    where is_primary group by customer_id having count(*) > 1
  ) t;
  if v_bad > 0 then
    raise exception 'P1.1 FAIL: % customers have more than one primary contact', v_bad;
  end if;
end $$;

do $$
declare v_missing int;
begin
  select count(*) into v_missing
  from pg_views v
  where v.schemaname = 'public'
    and v.viewname like 'v\_%'
    and not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v.viewname
        and c.reloptions::text like '%security_invoker=on%'
    );
  if v_missing > 0 then
    raise exception 'P1.2 FAIL: % view(s) are missing security_invoker = on', v_missing;
  end if;
end $$;

do $$
declare v_leaky text;
begin
  select string_agg(c.relname, ', ') into v_leaky
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and has_table_privilege('anon', c.oid, 'SELECT');
  if v_leaky is not null then
    raise exception 'P1.3 FAIL: anon can select from view(s): %', v_leaky;
  end if;
end $$;
```

P1.2 and P1.3 are the guardrails for spec §3's most dangerous rule. They run against **every** view in the schema, so they keep working as Phases 3–6 add more.

- [ ] **Step 4: Run verify.sql via MCP `execute_sql`**

Expected: no exception raised. (`\set` is a psql meta-command — strip that one line when pasting into `execute_sql`; keep it in the file.)

- [ ] **Step 5: Prove the primary-contact trigger works**

```sql
begin;
  insert into public.customers (name) values ('Trigger Test') returning id \gset
  insert into public.contacts (customer_id, name, is_primary) values (:'id', 'A', true);
  insert into public.contacts (customer_id, name, is_primary) values (:'id', 'B', true);
  select name, is_primary from public.contacts where customer_id = :'id' order by name;
rollback;
```

Expected: `A` is `false`, `B` is `true`. No unique-violation error. **If it errors, the trigger's `WHEN (new.is_primary)` clause is missing or wrong.**

- [ ] **Step 6: Regenerate types**

MCP `generate_typescript_types` → overwrite `src/lib/database.types.ts`, keeping the "GENERATED FILE" banner.

Run: `npm run typecheck` → clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0002_customers.sql supabase/verify.sql src/lib/database.types.ts
git commit -m "feat(db): migration 0002 — customers, contacts, interactions, views, RLS"
```

---

## Task 1.2: Add the shadcn components Phase 1 needs

**Files:**
- Create: `src/components/ui/*`

- [ ] **Step 1: Add them**

```bash
npx shadcn@4.16.1 add table checkbox popover calendar command dialog alert-dialog tooltip toggle-group scroll-area
```

Do **not** pass `-b`. The base is recorded in `components.json` and must stay radix.

- [ ] **Step 2: Reconcile the Calendar classNames against the installed react-day-picker**

Spec §2 warns that generated Calendars carry `classNames` keys that no longer exist. `react-day-picker` is at **10.0.1** here — new enough that the spec's own list of "current keys" may already be stale. **Check the installed package, not either document.**

Run:

```bash
grep -oE "^\s+[a-z_]+\??:" node_modules/react-day-picker/dist/esm/types/shared.d.ts | head -60
```

Then open `src/components/ui/calendar.tsx` and compare every key in its `classNames` object against what the installed types actually accept. Delete keys that no longer exist; add the current equivalents.

- [ ] **Step 3: Verify the calendar renders styled**

Add a temporary `<Calendar mode="single" />` to `/settings`, run `npm run dev`, and look at it. A calendar with dead `classNames` keys renders as **unstyled black-and-white text**, which is unmistakable. Fix until it looks like a calendar, then remove the temporary element.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui package.json
git commit -m "feat(ui): add table, calendar, command and dialog primitives; fix calendar classNames for react-day-picker 10"
```

---

## Task 1.3: Customer schemas and queries

**Files:**
- Create: `src/lib/schemas/customers.ts`
- Create: `src/lib/schemas/customers.test.ts`
- Create: `src/lib/queries/customers.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/schemas/customers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { customerSchema, CUSTOMER_STATUSES } from '@/lib/schemas/customers'

describe('customerSchema', () => {
  it('accepts a customer with nothing but a name', () => {
    // Spec §7 Phase 1: "only Name required" is an acceptance criterion,
    // so it is a test, not a comment.
    const r = customerSchema.safeParse({ name: 'Café Lila' })
    expect(r.success).toBe(true)
  })

  it('applies the documented defaults when fields are omitted', () => {
    const r = customerSchema.parse({ name: 'Café Lila' })
    expect(r.status).toBe('lead')
    expect(r.type).toBe('business')
    expect(r.price_tier).toBe('wholesale')
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(customerSchema.safeParse({ name: '' }).success).toBe(false)
    expect(customerSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('trims the name', () => {
    expect(customerSchema.parse({ name: '  Café Lila  ' }).name).toBe('Café Lila')
  })

  it('turns blank optional fields into null, not empty string', () => {
    const r = customerSchema.parse({ name: 'X', email: '', city: '  ' })
    expect(r.email).toBeNull()
    expect(r.city).toBeNull()
  })

  it('rejects a malformed email but allows a blank one', () => {
    expect(customerSchema.safeParse({ name: 'X', email: 'nope' }).success).toBe(false)
    expect(customerSchema.parse({ name: 'X', email: '' }).email).toBeNull()
  })

  it('accepts any phone format and only collapses whitespace', () => {
    // Spec §6.2 / Baymard: format-rejection causes real abandonment.
    for (const p of ['+973 3300 1122', '(973) 3300-1122', '33001122', '973.3300.1122']) {
      expect(customerSchema.safeParse({ name: 'X', phone: p }).success).toBe(true)
    }
    expect(customerSchema.parse({ name: 'X', phone: ' +973  3300 1122 ' }).phone)
      .toBe('+973 3300 1122')
  })

  it('rejects a status outside the enum', () => {
    expect(customerSchema.safeParse({ name: 'X', status: 'prospect' }).success).toBe(false)
  })

  it('exports the statuses in the order the UI should show them', () => {
    expect(CUSTOMER_STATUSES).toEqual([
      'lead', 'contacted', 'sampling', 'active', 'lapsed', 'lost',
    ])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test` → FAIL, cannot resolve `@/lib/schemas/customers`.

- [ ] **Step 3: Write the schema**

Create `src/lib/schemas/customers.ts`:

```ts
import * as z from 'zod'
import { optionalEmail, optionalText } from '@/lib/schemas/settings'
import { normalisePhone } from '@/lib/format'

/** Pipeline order, not alphabetical. The UI shows them in this order. */
export const CUSTOMER_STATUSES = [
  'lead', 'contacted', 'sampling', 'active', 'lapsed', 'lost',
] as const
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]

export const CUSTOMER_TYPES = ['business', 'individual'] as const
export const PRICE_TIERS = ['wholesale', 'retail'] as const

/** Suggested in a datalist, never enforced. Spec §3: source is free text. */
export const SOURCE_SUGGESTIONS = [
  'Walk-in', 'Instagram', 'Referral', 'Market stall',
  'Cold call', 'Sample drop', 'Event',
] as const

const optionalPhone = z
  .string()
  .transform((v) => normalisePhone(v))
  .nullable()

export const customerSchema = z.object({
  name: z.string().trim().min(1, { error: 'A name is required' }),
  type: z.enum(CUSTOMER_TYPES).default('business'),
  status: z.enum(CUSTOMER_STATUSES).default('lead'),
  email: optionalEmail.optional().default(''),
  phone: optionalPhone.optional().default(''),
  address_line1: optionalText.optional().default(''),
  address_line2: optionalText.optional().default(''),
  city: optionalText.optional().default(''),
  postcode: optionalText.optional().default(''),
  delivery_notes: optionalText.optional().default(''),
  source: optionalText.optional().default(''),
  price_tier: z.enum(PRICE_TIERS).default('wholesale'),
  notes: optionalText.optional().default(''),
})

export type CustomerInput = z.input<typeof customerSchema>
export type CustomerOutput = z.output<typeof customerSchema>

/** Inline status edit from the list and detail header. */
export const customerStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(CUSTOMER_STATUSES),
})

/** Autosaving notes field on the detail page. */
export const customerNotesSchema = z.object({
  id: z.uuid(),
  notes: optionalText,
})
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test` → PASS.

- [ ] **Step 5: Write the queries**

Create `src/lib/queries/customers.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type CustomerListRow = Tables<'v_customer_list'>
export type Customer = Tables<'customers'>
export type Contact = Tables<'contacts'>
export type Interaction = Tables<'interactions'>
export type FollowUpDue = Tables<'v_follow_ups_due'>

/**
 * Everything, unpaginated. Spec §6.3: sorting, filtering and pagination are
 * client-side, because this dataset stays in the low thousands for years
 * and server pagination would add latency for nothing. Do not "optimise"
 * this into server pagination without ALSO moving sort and filter — half a
 * migration sorts only the current page, which is worse than either.
 */
export async function listCustomers(): Promise<CustomerListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_customer_list')
    .select('*')
    .is('archived_at', null)
    .order('name', { ascending: true })

  if (error) throw new Error(`Could not load customers: ${error.message}`)
  return data ?? []
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Could not load customer: ${error.message}`)
  return data
}

export async function listContacts(customerId: string): Promise<Contact[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('customer_id', customerId)
    .order('is_primary', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw new Error(`Could not load contacts: ${error.message}`)
  return data ?? []
}

export type InteractionWithContact = Interaction & {
  contacts: Pick<Contact, 'id' | 'name'> | null
}

export async function listInteractions(
  customerId: string,
): Promise<InteractionWithContact[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('interactions')
    .select('*, contacts ( id, name )')
    .eq('customer_id', customerId)
    .order('occurred_at', { ascending: false })

  if (error) throw new Error(`Could not load interactions: ${error.message}`)
  return data ?? []
}

export async function listFollowUpsDue(): Promise<FollowUpDue[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_follow_ups_due')
    .select('*')
    .order('follow_up_on', { ascending: true })

  if (error) throw new Error(`Could not load follow-ups: ${error.message}`)
  return data ?? []
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/schemas/customers.ts src/lib/schemas/customers.test.ts src/lib/queries/customers.ts
git commit -m "feat(customers): schemas and typed read helpers"
```

---

## Task 1.4: The reference data table

Built once, used by customers, orders, products, invoices and insights.

**Files:**
- Create: `src/components/app/data-table/use-table-url-state.ts`
- Create: `src/components/app/data-table/column-header.tsx`
- Create: `src/components/app/data-table/pagination.tsx`
- Create: `src/components/app/data-table/filter-chips.tsx`
- Create: `src/components/app/data-table/data-table.tsx`

- [ ] **Step 1: URL state hook**

Create `src/components/app/data-table/use-table-url-state.ts`:

```ts
'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'

/**
 * Spec §5 rule 4: list state lives in the URL. Copying the address bar
 * reproduces the view, the back button works, a filtered list is shareable.
 * router.replace, not push — filtering should not fill the history stack.
 */
export function useTableUrlState() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString())

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') next.delete(key)
        else next.set(key, value)
      }

      // Changing any filter must reset paging, or you land on an empty page 7.
      if (!Object.hasOwn(updates, 'page')) next.delete('page')

      const qs = next.toString()
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router],
  )

  const clearAll = useCallback(() => {
    startTransition(() => router.replace(pathname, { scroll: false }))
  }, [pathname, router])

  return {
    params,
    setParams,
    clearAll,
    isPending,
    get: (key: string) => params.get(key) ?? '',
  }
}
```

- [ ] **Step 2: Sortable column header**

Create `src/components/app/data-table/column-header.tsx`:

```tsx
'use client'

import type { Column } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: {
  column: Column<TData, TValue>
  title: string
  className?: string
}) {
  if (!column.getCanSort()) {
    return <span className={cn('text-xs font-medium', className)}>{title}</span>
  }

  const sorted = column.getIsSorted()

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('-ml-2 h-8 gap-1 px-2 text-xs font-medium', className)}
      onClick={() => column.toggleSorting(sorted === 'asc')}
      aria-label={`Sort by ${title}, currently ${sorted || 'unsorted'}`}
    >
      {title}
      {sorted === 'asc' ? (
        <ArrowUp className="size-3" aria-hidden />
      ) : sorted === 'desc' ? (
        <ArrowDown className="size-3" aria-hidden />
      ) : (
        <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
      )}
    </Button>
  )
}
```

- [ ] **Step 3: Pagination**

Create `src/components/app/data-table/pagination.tsx`:

```tsx
'use client'

import type { Table } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'

/** Pagination, never infinite scroll. Spec §6.3: business data means
 *  finding a record and coming back to it. */
export function TablePagination<TData>({ table }: { table: Table<TData> }) {
  const { pageIndex, pageSize } = table.getState().pagination
  const total = table.getFilteredRowModel().rows.length
  const first = total === 0 ? 0 : pageIndex * pageSize + 1
  const last = Math.min((pageIndex + 1) * pageSize, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? 'No rows' : `${first}–${last} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline" size="sm" className="h-11 md:h-9"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">
          {table.getPageCount() === 0 ? 1 : pageIndex + 1} / {Math.max(table.getPageCount(), 1)}
        </span>
        <Button
          variant="outline" size="sm" className="h-11 md:h-9"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Active filter chips**

Create `src/components/app/data-table/filter-chips.tsx`:

```tsx
'use client'

import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export type ActiveFilter = { key: string; label: string }

/** Spec §6.3: filters must be visibly active, with one-click clear. */
export function FilterChips({
  filters,
  onRemove,
  onClearAll,
}: {
  filters: ActiveFilter[]
  onRemove: (key: string) => void
  onClearAll: () => void
}) {
  if (filters.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => (
        <Badge key={f.key} variant="secondary" className="gap-1 py-1 pl-2 pr-1">
          {f.label}
          <button
            type="button"
            onClick={() => onRemove(f.key)}
            aria-label={`Remove filter ${f.label}`}
            className="grid size-5 place-items-center rounded-sm hover:bg-background"
          >
            <X className="size-3" aria-hidden />
          </button>
        </Badge>
      ))}
      {filters.length > 1 ? (
        <Button variant="ghost" size="sm" onClick={onClearAll} className="h-7 text-xs">
          Clear all
        </Button>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 5: The table itself**

Create `src/components/app/data-table/data-table.tsx`:

```tsx
'use client'

import { type ReactNode, useMemo, useState } from 'react'
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { TablePagination } from './pagination'
import { cn } from '@/lib/utils'

/**
 * TanStack Table v8. In v9 `useReactTable` was renamed `useTable` and
 * features must be registered — if an upgrade ever lands, this import is
 * where it breaks first, which is exactly why v8 is pinned exactly.
 */
export function DataTable<TData>({
  columns,
  data,
  globalFilter,
  initialSorting = [],
  pageSize = 25,
  onRowClick,
  renderMobileCard,
  emptyState,
}: {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  globalFilter?: string
  initialSorting?: SortingState
  pageSize?: number
  onRowClick?: (row: TData) => void
  /** Spec §6.6: below md, tables become cards — never a scrolling table. */
  renderMobileCard: (row: TData) => ReactNode
  /** Rendered instead of rows when the filtered set is empty. */
  emptyState: ReactNode
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: globalFilter ?? '' },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  })

  const rows = table.getRowModel().rows
  const isEmpty = table.getFilteredRowModel().rows.length === 0

  const mobileRows = useMemo(() => rows.map((r) => r.original), [rows])

  if (isEmpty) return <>{emptyState}</>

  return (
    <div>
      {/* Cards below md */}
      <div className="space-y-2 md:hidden">
        {mobileRows.map((row, i) => (
          <div
            key={i}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              'rounded-lg border p-3',
              onRowClick && 'cursor-pointer active:bg-accent/50',
            )}
          >
            {renderMobileCard(row)}
          </div>
        ))}
      </div>

      {/* Table from md up */}
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader className="sticky top-14 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="h-12 hover:bg-transparent">
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'h-12',
                      header.column.columnDef.meta?.align === 'right' && 'text-right',
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn('h-12', onRowClick && 'cursor-pointer')}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      'h-12',
                      cell.column.columnDef.meta?.align === 'right' &&
                        'text-right tabular-nums',
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <TablePagination table={table} />
    </div>
  )
}
```

- [ ] **Step 6: Declare the `meta.align` type**

TanStack's `ColumnMeta` is an interface you augment. Create `src/components/app/data-table/table-meta.d.ts`:

```ts
import '@tanstack/react-table'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends unknown, TValue> {
    /** Right-align with tabular figures. Spec §6.3: numeric columns. */
    align?: 'left' | 'right'
  }
}
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck` → clean. **If `useReactTable` is not exported, you are on v9** — check `npm ls @tanstack/react-table` reads `8.21.3`.

- [ ] **Step 8: Commit**

```bash
git add src/components/app/data-table
git commit -m "feat(ui): reference data table with URL state, cards below md, sticky header"
```

---

## Task 1.5: Customer list page with both empty states

**Files:**
- Create: `src/app/(app)/customers/page.tsx`
- Create: `src/app/(app)/customers/customers-table.tsx`
- Create: `src/components/app/status-badge.tsx`

- [ ] **Step 1: Status badge**

Create `src/components/app/status-badge.tsx`:

```tsx
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Spec §6.7: status is communicated by SHAPE and LABEL; colour only
 * reinforces. Hence the leading dot and the always-present text — this
 * stays readable in greyscale and for colour-blind users.
 */
const TONE: Record<string, string> = {
  lead:        'bg-muted text-muted-foreground',
  contacted:   'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  sampling:    'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  active:      'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  lapsed:      'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  lost:        'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
}

const LABEL: Record<string, string> = {
  lead: 'Lead', contacted: 'Contacted', sampling: 'Sampling',
  active: 'Active', lapsed: 'Lapsed', lost: 'Lost',
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn('gap-1.5 font-medium', TONE[status] ?? TONE.lead, className)}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {LABEL[status] ?? status}
    </Badge>
  )
}
```

- [ ] **Step 2: The page**

Create `src/app/(app)/customers/page.tsx`:

```tsx
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { listCustomers } from '@/lib/queries/customers'
import { Button } from '@/components/ui/button'
import { CustomersTable } from './customers-table'

export default async function CustomersPage() {
  const customers = await listCustomers()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <Button asChild className="h-11">
          <Link href="/customers/new">
            <Plus className="size-4" aria-hidden />
            New customer
          </Link>
        </Button>
      </div>
      <CustomersTable customers={customers} />
    </div>
  )
}
```

Reads happen here, in a Server Component. No `useEffect` fetching anywhere in this app.

- [ ] **Step 3: The table client component**

Create `src/app/(app)/customers/customers-table.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Search, Users } from 'lucide-react'
import type { CustomerListRow } from '@/lib/queries/customers'
import { CUSTOMER_STATUSES } from '@/lib/schemas/customers'
import { DataTable } from '@/components/app/data-table/data-table'
import { ColumnHeader } from '@/components/app/data-table/column-header'
import { FilterChips, type ActiveFilter } from '@/components/app/data-table/filter-chips'
import { useTableUrlState } from '@/components/app/data-table/use-table-url-state'
import { StatusBadge } from '@/components/app/status-badge'
import { DateDisplay } from '@/components/app/date-display'
import { NoDataYet, NoResults } from '@/components/app/empty-state'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

const STATUS_LABEL: Record<string, string> = {
  lead: 'Lead', contacted: 'Contacted', sampling: 'Sampling',
  active: 'Active', lapsed: 'Lapsed', lost: 'Lost',
}

export function CustomersTable({ customers }: { customers: CustomerListRow[] }) {
  const router = useRouter()
  const { get, setParams, clearAll } = useTableUrlState()

  const q = get('q')
  const status = get('status')
  const followup = get('followup')

  // Filtering is client-side over the full set. Spec §6.3.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return customers.filter((c) => {
      if (status && c.status !== status) return false
      if (followup === 'due' && !c.open_follow_up_on) return false
      if (!needle) return true
      return (
        (c.name ?? '').toLowerCase().includes(needle) ||
        (c.email ?? '').toLowerCase().includes(needle) ||
        (c.phone ?? '').toLowerCase().includes(needle) ||
        (c.city ?? '').toLowerCase().includes(needle)
      )
    })
  }, [customers, q, status, followup])

  const columns = useMemo<ColumnDef<CustomerListRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        // Spec §6.3: first column is always a human-readable name.
        header: ({ column }) => <ColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <ColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status ?? 'lead'} />,
      },
      {
        accessorKey: 'type',
        header: ({ column }) => <ColumnHeader column={column} title="Type" />,
        cell: ({ row }) => (
          <span className="capitalize text-muted-foreground">{row.original.type}</span>
        ),
      },
      {
        accessorKey: 'city',
        header: ({ column }) => <ColumnHeader column={column} title="City" />,
        cell: ({ row }) => row.original.city ?? '—',
      },
      {
        accessorKey: 'last_contacted_at',
        header: ({ column }) => <ColumnHeader column={column} title="Last contact" />,
        cell: ({ row }) => <DateDisplay value={row.original.last_contacted_at} />,
      },
    ],
    [],
  )

  const activeFilters: ActiveFilter[] = [
    ...(status ? [{ key: 'status', label: `Status: ${STATUS_LABEL[status] ?? status}` }] : []),
    ...(followup === 'due' ? [{ key: 'followup', label: 'Follow-up due' }] : []),
    ...(q ? [{ key: 'q', label: `Search: ${q}` }] : []),
  ]

  // ── The two empty states. Spec §6.3: these are different screens. ──
  const emptyState =
    customers.length === 0 ? (
      <NoDataYet
        icon={<Users className="size-10" aria-hidden />}
        title="No customers yet"
        description="Add the first café, gym or deli you want to sell to. A name is all you need to start."
        action={
          <Button asChild className="h-11">
            <Link href="/customers/new">Add your first customer</Link>
          </Button>
        }
      />
    ) : (
      <NoResults
        activeFilters={activeFilters.map((f) => f.label)}
        onClear={clearAll}
      />
    )

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setParams({ q: e.target.value })}
            placeholder="Search name, email, phone, city"
            aria-label="Search customers"
            className="h-11 pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CUSTOMER_STATUSES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? 'default' : 'outline'}
              aria-pressed={status === s}
              onClick={() => setParams({ status: status === s ? null : s })}
              className="h-9"
            >
              {STATUS_LABEL[s]}
            </Button>
          ))}
        </div>
      </div>

      <FilterChips
        filters={activeFilters}
        onRemove={(key) => setParams({ [key]: null })}
        onClearAll={clearAll}
      />

      <DataTable
        columns={columns}
        data={rows}
        initialSorting={[{ id: 'name', desc: false }]}
        onRowClick={(c) => router.push(`/customers/${c.id}`)}
        emptyState={emptyState}
        renderMobileCard={(c) => (
          <div className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{c.name}</span>
              <StatusBadge status={c.status ?? 'lead'} />
            </div>
            <div className="text-sm text-muted-foreground">
              {c.city ?? 'No city'} · Last contact{' '}
              <DateDisplay value={c.last_contacted_at} />
            </div>
          </div>
        )}
      />
    </div>
  )
}
```

The mobile card shows name, status, city and last contact — the four things that satisfy the majority need. Not every column.

- [ ] **Step 4: Verify — with no data**

Visit `/customers` on an empty database.
Expected: the illustrated **"No customers yet"** state with an "Add your first customer" button. Not an empty table with headers.

- [ ] **Step 5: Verify — with data and filters**

Insert three customers via MCP `execute_sql`:

```sql
insert into public.customers (name, status, city, type) values
  ('Café Lila',    'active',    'Manama', 'business'),
  ('Iron Gym',     'lead',      'Riffa',  'business'),
  ('Sara Hassan',  'contacted', 'Manama', 'individual');
```

Then:
1. `/customers` shows three rows sorted by name. ✅
2. Click "Lead" → one row, URL becomes `?status=lead`, a chip reads "Status: Lead ×". ✅
3. **Refresh the page — the filter survives.** ✅
4. Type `zzz` in search → the **"Nothing matches these filters"** state, showing the active filters and a Clear button. This must be visibly different from step 4's screen. ✅
5. Click "Clear all" → back to three rows and a clean URL. ✅
6. Copy the URL with `?status=lead` into a new tab → same filtered view. ✅
7. Click a row → navigates to `/customers/<id>` (404 until Task 1.8). ✅

- [ ] **Step 6: Verify at 375px**

Resize to 375px. Rows are cards, not a scrolling table. Nothing overflows horizontally. Every button is at least 44px tall.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/customers" src/components/app/status-badge.tsx
git commit -m "feat(customers): list with URL-persisted filters and both empty states"
```

---

## Task 1.6: The reference form fields, and the new-customer form

**Files:**
- Create: `src/components/app/form-fields.tsx`
- Create: `src/lib/actions/customers.ts`
- Create: `src/components/app/customer-form.tsx`
- Create: `src/app/(app)/customers/new/page.tsx`

- [ ] **Step 1: Extract the reusable field components**

Create `src/components/app/form-fields.tsx`. This generalises the pattern from Phase 0 Task 0.13 so no later form repeats it.

```tsx
'use client'

import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * shadcn removed <Form />. The replacement is <Field /> plus your own
 * <Controller />. Convention, applied by every component here:
 *   data-invalid on <Field>, aria-invalid on the control.
 */

type Base<T extends FieldValues> = {
  control: Control<T>
  name: Path<T>
  label: string
  description?: string
  className?: string
}

export function TextField<T extends FieldValues>({
  control, name, label, description, className,
  type = 'text', inputMode, autoComplete, placeholder, autoFocus, list,
}: Base<T> & {
  type?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel' | 'search'
  autoComplete?: string
  placeholder?: string
  autoFocus?: boolean
  list?: string
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={className}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            {...field}
            id={name}
            type={type}
            list={list}
            inputMode={inputMode}
            autoComplete={autoComplete}
            placeholder={placeholder}
            autoFocus={autoFocus}
            value={(field.value as string | number | null) ?? ''}
            aria-invalid={fieldState.invalid || undefined}
            aria-describedby={description ? `${name}-desc` : undefined}
            className="h-11"
          />
          {description ? (
            <p id={`${name}-desc`} className="text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
          {fieldState.error ? <FieldError>{fieldState.error.message}</FieldError> : null}
        </Field>
      )}
    />
  )
}

export function TextAreaField<T extends FieldValues>({
  control, name, label, description, className, rows = 4, autoFocus,
}: Base<T> & { rows?: number; autoFocus?: boolean }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={className}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Textarea
            {...field}
            id={name}
            rows={rows}
            autoFocus={autoFocus}
            value={(field.value as string | null) ?? ''}
            aria-invalid={fieldState.invalid || undefined}
          />
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
          {fieldState.error ? <FieldError>{fieldState.error.message}</FieldError> : null}
        </Field>
      )}
    />
  )
}

export function SelectField<T extends FieldValues>({
  control, name, label, options, className,
}: Base<T> & { options: readonly { value: string; label: string }[] }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={className}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Select value={(field.value as string) ?? ''} onValueChange={field.onChange}>
            <SelectTrigger id={name} aria-invalid={fieldState.invalid || undefined} className="h-11">
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldState.error ? <FieldError>{fieldState.error.message}</FieldError> : null}
        </Field>
      )}
    />
  )
}

/** Segmented buttons. Faster than a dropdown for 2–6 options on a phone. */
export function SegmentedField<T extends FieldValues>({
  control, name, label, options, className,
}: Base<T> & { options: readonly { value: string; label: string }[] }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={className}>
          <FieldLabel>{label}</FieldLabel>
          <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
            {options.map((o) => {
              const selected = field.value === o.value
              return (
                <Button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  variant={selected ? 'default' : 'outline'}
                  onClick={() => field.onChange(o.value)}
                  className={cn('h-11 flex-1 sm:flex-none', selected && 'font-semibold')}
                >
                  {o.label}
                </Button>
              )
            })}
          </div>
          {fieldState.error ? <FieldError>{fieldState.error.message}</FieldError> : null}
        </Field>
      )}
    />
  )
}
```

- [ ] **Step 2: The customer actions**

Create `src/lib/actions/customers.ts`:

```ts
'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  customerSchema, customerStatusSchema, customerNotesSchema,
} from '@/lib/schemas/customers'
import type { ActionResult } from '@/lib/actions/auth'

function fieldErrors(error: z.ZodError) {
  return z.flattenError(error).fieldErrors as Record<string, string[]>
}

export async function createCustomer(
  raw: unknown,
): Promise<ActionResult & { id?: string }> {
  const parsed = customerSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .insert(parsed.data)
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  revalidatePath('/customers')
  return { ok: true, id: data.id }
}

export async function updateCustomer(
  id: string,
  raw: unknown,
): Promise<ActionResult> {
  const parsed = customerSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('customers').update(parsed.data).eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
  return { ok: true }
}

/** Inline edit — single field, low risk, high frequency. Spec §6.1. */
export async function setCustomerStatus(raw: unknown): Promise<ActionResult> {
  const parsed = customerStatusSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Invalid status' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customers')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/customers')
  revalidatePath(`/customers/${parsed.data.id}`)
  return { ok: true }
}

/** The one field allowed to autosave. Spec §6.4. */
export async function saveCustomerNotes(raw: unknown): Promise<ActionResult> {
  const parsed = customerNotesSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Could not save notes' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customers')
    .update({ notes: parsed.data.notes })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/customers/${parsed.data.id}`)
  return { ok: true }
}

/** Reversible, so it gets an Undo toast rather than a confirm dialog. */
export async function archiveCustomer(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('customers')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/customers')
  return { ok: true }
}

export async function unarchiveCustomer(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('customers')
    .update({ archived_at: null })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/customers')
  return { ok: true }
}
```

- [ ] **Step 3: The customer form**

Create `src/components/app/customer-form.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import * as z from 'zod'
import {
  customerSchema, CUSTOMER_STATUSES, CUSTOMER_TYPES,
  PRICE_TIERS, SOURCE_SUGGESTIONS,
} from '@/lib/schemas/customers'
import type { Customer } from '@/lib/queries/customers'
import {
  TextField, TextAreaField, SegmentedField, SelectField,
} from '@/components/app/form-fields'
import { Button } from '@/components/ui/button'
import { ChevronDown } from 'lucide-react'

type In = z.input<typeof customerSchema>
type Out = z.output<typeof customerSchema>

const STATUS_OPTIONS = CUSTOMER_STATUSES.map((s) => ({
  value: s,
  label: s.charAt(0).toUpperCase() + s.slice(1),
}))

export function CustomerForm({
  customer,
  onSubmit,
  submitLabel,
}: {
  customer?: Customer
  onSubmit: (values: Out) => Promise<{ ok: boolean; error?: string }>
  submitLabel: string
}) {
  // Spec §6.2: "cut every field you can". A new customer needs a name.
  // Everything else lives behind this disclosure.
  const [showMore, setShowMore] = useState(Boolean(customer))

  // Zod 4 + RHF: schema has .default()/.transform(), so all three generics
  // or none. Two is the type error everyone hits.
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(customerSchema),
    mode: 'onTouched',
    defaultValues: {
      name: customer?.name ?? '',
      type: customer?.type ?? 'business',
      status: customer?.status ?? 'lead',
      email: customer?.email ?? '',
      phone: customer?.phone ?? '',
      address_line1: customer?.address_line1 ?? '',
      address_line2: customer?.address_line2 ?? '',
      city: customer?.city ?? '',
      postcode: customer?.postcode ?? '',
      delivery_notes: customer?.delivery_notes ?? '',
      source: customer?.source ?? '',
      price_tier: customer?.price_tier ?? 'wholesale',
      notes: customer?.notes ?? '',
    },
  })

  const { control, handleSubmit, formState } = form

  async function submit(values: Out) {
    const result = await onSubmit(values)
    // Note what does NOT happen on failure: the form is not cleared.
    if (!result.ok) toast.error(result.error ?? 'Could not save')
  }

  return (
    // Single column. Spec §6.2 — multi-column breaks vertical momentum.
    <form onSubmit={handleSubmit(submit)} className="max-w-xl space-y-5 pb-24">
      <TextField
        control={control}
        name="name"
        label="Name"
        autoFocus
        autoComplete="organization"
      />

      <SegmentedField
        control={control}
        name="type"
        label="Type"
        options={CUSTOMER_TYPES.map((t) => ({
          value: t,
          label: t === 'business' ? 'Business' : 'Individual',
        }))}
      />

      {!showMore ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowMore(true)}
          className="h-11 gap-1 px-0 text-muted-foreground"
        >
          <ChevronDown className="size-4" aria-hidden />
          Add contact details, address and pricing
        </Button>
      ) : (
        <div className="space-y-5">
          <SelectField control={control} name="status" label="Status" options={STATUS_OPTIONS} />

          <TextField control={control} name="email" label="Email" type="email" inputMode="email" autoComplete="email" />
          <TextField control={control} name="phone" label="Phone" type="tel" inputMode="tel" autoComplete="tel" />

          <TextField control={control} name="address_line1" label="Address line 1" autoComplete="address-line1" />
          <TextField control={control} name="address_line2" label="Address line 2" autoComplete="address-line2" />
          {/* The permitted two-column exception: short, logically grouped. */}
          <div className="grid grid-cols-2 gap-3">
            <TextField control={control} name="city" label="City" autoComplete="address-level2" />
            <TextField control={control} name="postcode" label="Postcode" autoComplete="postal-code" />
          </div>

          <TextAreaField
            control={control}
            name="delivery_notes"
            label="Delivery notes"
            rows={2}
            description="Back door, ask for Sam, before 9am — whatever you'd tell a driver."
          />

          <TextField
            control={control}
            name="source"
            label="How did you find them?"
            list="source-suggestions"
          />
          <datalist id="source-suggestions">
            {SOURCE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
          </datalist>

          <SegmentedField
            control={control}
            name="price_tier"
            label="Price tier"
            options={PRICE_TIERS.map((t) => ({
              value: t,
              label: t === 'wholesale' ? 'Wholesale' : 'Retail',
            }))}
          />

          <TextAreaField control={control} name="notes" label="Notes" rows={3} />
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background p-3 md:static md:border-0 md:bg-transparent md:p-0">
        <Button type="submit" disabled={formState.isSubmitting} className="h-11 w-full md:w-auto">
          {formState.isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
      {/* No Reset. No Clear. Spec §6.2. */}
    </form>
  )
}
```

The `source` field is a free-text input with a `datalist` — it suggests without constraining, exactly as spec §3 requires.

- [ ] **Step 4: The new-customer page**

Create `src/app/(app)/customers/new/page.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CustomerForm } from '@/components/app/customer-form'
import { createCustomer } from '@/lib/actions/customers'

export default function NewCustomerPage() {
  const router = useRouter()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New customer</h1>
      <CustomerForm
        submitLabel="Create customer"
        onSubmit={async (values) => {
          const result = await createCustomer(values)
          if (result.ok && result.id) {
            toast.success(`${values.name} added`)
            router.push(`/customers/${result.id}`)
          }
          return result
        }}
      />
    </div>
  )
}
```

- [ ] **Step 5: Verify — this is a Phase 1 acceptance criterion**

**Time yourself.** From `/customers`, click "New customer", type a name, hit the button.
Expected: under 10 seconds, and you land on the detail page (404 until Task 1.8 — the redirect is what's being tested here).

Then:
1. Submit with a blank name → inline error under the field, with text and not just colour. The form still holds anything else you typed. ✅
2. Enter `nope` as email, blur → error appears **on blur, not on every keystroke**. ✅
3. Type a phone as `(973) 3300-1122` → accepted, stored as typed. ✅
4. At 375px the submit button is pinned to the bottom of the viewport. ✅

- [ ] **Step 6: Commit**

```bash
git add src/components/app/form-fields.tsx src/components/app/customer-form.tsx src/lib/actions/customers.ts "src/app/(app)/customers/new"
git commit -m "feat(customers): reference form-field components and the new-customer form"
```

---

## Task 1.7: Contacts and interactions — schemas, actions, queries

**Files:**
- Create: `src/lib/schemas/contacts.ts`
- Create: `src/lib/schemas/interactions.ts`
- Create: `src/lib/schemas/interactions.test.ts`
- Create: `src/lib/actions/contacts.ts`
- Create: `src/lib/actions/interactions.ts`

- [ ] **Step 1: Write the failing interaction schema test**

Create `src/lib/schemas/interactions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { interactionSchema, followUpOffsetToDate } from '@/lib/schemas/interactions'

const base = {
  customer_id: '11111111-1111-4111-8111-111111111111',
  channel: 'phone',
  direction: 'outbound',
  occurred_at: '2026-08-06T09:00:00.000Z',
}

describe('interactionSchema', () => {
  it('accepts a minimal interaction', () => {
    expect(interactionSchema.safeParse(base).success).toBe(true)
  })

  it('requires a channel', () => {
    const { channel, ...rest } = base
    expect(interactionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a channel outside the enum', () => {
    expect(interactionSchema.safeParse({ ...base, channel: 'pigeon' }).success).toBe(false)
  })

  it('accepts every documented channel', () => {
    for (const c of ['email','phone','whatsapp','in_person','sample_drop','other']) {
      expect(interactionSchema.safeParse({ ...base, channel: c }).success).toBe(true)
    }
  })

  it('turns a blank contact_id into null rather than failing uuid parsing', () => {
    // The select renders "" when nobody is chosen.
    expect(interactionSchema.parse({ ...base, contact_id: '' }).contact_id).toBeNull()
  })

  it('turns a blank follow_up_on into null', () => {
    expect(interactionSchema.parse({ ...base, follow_up_on: '' }).follow_up_on).toBeNull()
  })

  it('rejects a follow-up date in the past', () => {
    const r = interactionSchema.safeParse({ ...base, follow_up_on: '2020-01-01' })
    expect(r.success).toBe(false)
  })
})

describe('followUpOffsetToDate', () => {
  const today = new Date('2026-08-06T12:00:00.000Z') // a Thursday

  it('resolves tomorrow', () => {
    expect(followUpOffsetToDate('tomorrow', today)).toBe('2026-08-07')
  })

  it('resolves in 3 days', () => {
    expect(followUpOffsetToDate('3d', today)).toBe('2026-08-09')
  })

  it('resolves next week', () => {
    expect(followUpOffsetToDate('1w', today)).toBe('2026-08-13')
  })

  it('resolves in 2 weeks', () => {
    expect(followUpOffsetToDate('2w', today)).toBe('2026-08-20')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test` → FAIL, cannot resolve `@/lib/schemas/interactions`.

- [ ] **Step 3: Write the contact schema**

Create `src/lib/schemas/contacts.ts`:

```ts
import * as z from 'zod'
import { optionalEmail, optionalText } from '@/lib/schemas/settings'
import { normalisePhone } from '@/lib/format'

export const contactSchema = z.object({
  customer_id: z.uuid(),
  name: z.string().trim().min(1, { error: 'A name is required' }),
  role: optionalText.optional().default(''),
  email: optionalEmail.optional().default(''),
  phone: z.string().transform((v) => normalisePhone(v)).nullable().optional().default(''),
  is_primary: z.boolean().default(false),
  notes: optionalText.optional().default(''),
})

export type ContactInput = z.input<typeof contactSchema>
export type ContactOutput = z.output<typeof contactSchema>
```

- [ ] **Step 4: Write the interaction schema**

Create `src/lib/schemas/interactions.ts`:

```ts
import * as z from 'zod'
import { addDays, addWeeks, format } from 'date-fns'
import { optionalText } from '@/lib/schemas/settings'

export const CHANNELS = [
  'email', 'phone', 'whatsapp', 'in_person', 'sample_drop', 'other',
] as const
export type Channel = (typeof CHANNELS)[number]

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email', phone: 'Phone', whatsapp: 'WhatsApp',
  in_person: 'In person', sample_drop: 'Sample drop', other: 'Other',
}

export const OUTCOMES = [
  'no_response', 'interested', 'not_interested', 'ordered', 'follow_up', 'other',
] as const
export type Outcome = (typeof OUTCOMES)[number]

export const OUTCOME_LABELS: Record<Outcome, string> = {
  no_response: 'No response', interested: 'Interested',
  not_interested: 'Not interested', ordered: 'Ordered',
  follow_up: 'Follow up', other: 'Other',
}

export const DIRECTIONS = ['outbound', 'inbound'] as const

/** Blank string → null, so an unset <select> or <input type=date> is valid. */
const blankToNullUuid = z
  .string()
  .transform((v) => (v.trim().length > 0 ? v.trim() : null))
  .nullable()
  .refine((v) => v === null || z.uuid().safeParse(v).success, { error: 'Invalid selection' })

const futureDateOrNull = z
  .string()
  .transform((v) => (v.trim().length > 0 ? v.trim() : null))
  .nullable()
  .refine(
    (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v),
    { error: 'Use YYYY-MM-DD' },
  )
  .refine(
    (v) => v === null || v >= format(new Date(), 'yyyy-MM-dd'),
    { error: 'Pick a date today or later' },
  )

export const interactionSchema = z.object({
  customer_id: z.uuid(),
  contact_id: blankToNullUuid.optional().default(''),
  occurred_at: z.string().min(1, { error: 'Required' }),
  channel: z.enum(CHANNELS, { error: 'Pick how you contacted them' }),
  direction: z.enum(DIRECTIONS).default('outbound'),
  subject: optionalText.optional().default(''),
  notes: optionalText.optional().default(''),
  outcome: z
    .string()
    .transform((v) => (v.trim().length > 0 ? v.trim() : null))
    .nullable()
    .refine((v) => v === null || (OUTCOMES as readonly string[]).includes(v), {
      error: 'Invalid outcome',
    })
    .optional()
    .default(''),
  follow_up_on: futureDateOrNull.optional().default(''),
})

export type InteractionInput = z.input<typeof interactionSchema>
export type InteractionOutput = z.output<typeof interactionSchema>

export const followUpDoneSchema = z.object({
  id: z.uuid(),
  done: z.boolean(),
})

/**
 * Quick-pick chips: Tomorrow · In 3 days · Next week · In 2 weeks.
 * Pure and injectable so it is testable without mocking the clock.
 */
export type FollowUpOffset = 'tomorrow' | '3d' | '1w' | '2w'

export const FOLLOW_UP_CHIPS: { value: FollowUpOffset; label: string }[] = [
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: '3d',       label: 'In 3 days' },
  { value: '1w',       label: 'Next week' },
  { value: '2w',       label: 'In 2 weeks' },
]

export function followUpOffsetToDate(
  offset: FollowUpOffset,
  from: Date = new Date(),
): string {
  const d =
    offset === 'tomorrow' ? addDays(from, 1)
    : offset === '3d'     ? addDays(from, 3)
    : offset === '1w'     ? addWeeks(from, 1)
    :                       addWeeks(from, 2)
  return format(d, 'yyyy-MM-dd')
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npm test` → PASS.

- [ ] **Step 6: Contact actions**

Create `src/lib/actions/contacts.ts`:

```ts
'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { contactSchema } from '@/lib/schemas/contacts'
import type { ActionResult } from '@/lib/actions/auth'

export async function createContact(raw: unknown): Promise<ActionResult> {
  const parsed = contactSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the fields below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  // One naive insert. The trg_contacts_single_primary trigger demotes any
  // existing primary before this row lands, so no ordering logic is needed
  // here — and cannot be got wrong here.
  const { error } = await supabase.from('contacts').insert(parsed.data)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/customers/${parsed.data.customer_id}`)
  return { ok: true }
}

export async function updateContact(id: string, raw: unknown): Promise<ActionResult> {
  const parsed = contactSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the fields below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('contacts').update(parsed.data).eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/customers/${parsed.data.customer_id}`)
  return { ok: true }
}

export async function deleteContact(
  id: string,
  customerId: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('contacts').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/customers/${customerId}`)
  return { ok: true }
}
```

- [ ] **Step 7: Interaction actions**

Create `src/lib/actions/interactions.ts`:

```ts
'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { interactionSchema, followUpDoneSchema } from '@/lib/schemas/interactions'
import type { ActionResult } from '@/lib/actions/auth'

export async function logInteraction(raw: unknown): Promise<ActionResult> {
  const parsed = interactionSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the fields below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const createdBy = claims?.claims?.sub as string | undefined

  const { error } = await supabase
    .from('interactions')
    .insert({ ...parsed.data, created_by: createdBy ?? null })

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/customers/${parsed.data.customer_id}`)
  revalidatePath('/customers')
  revalidatePath('/')
  return { ok: true }
}

/** Optimistic on the client: single object, reversible, idempotent. §6.4. */
export async function setFollowUpDone(raw: unknown): Promise<ActionResult> {
  const parsed = followUpDoneSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Invalid request' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('interactions')
    .update({ follow_up_done: parsed.data.done })
    .eq('id', parsed.data.id)
    .select('customer_id')
    .single()

  if (error) return { ok: false, error: error.message }

  revalidatePath(`/customers/${data.customer_id}`)
  revalidatePath('/customers')
  revalidatePath('/')
  return { ok: true }
}

export async function deleteInteraction(
  id: string,
  customerId: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('interactions').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/customers/${customerId}`)
  return { ok: true }
}
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/schemas/contacts.ts src/lib/schemas/interactions.ts src/lib/schemas/interactions.test.ts src/lib/actions/contacts.ts src/lib/actions/interactions.ts
git commit -m "feat(crm): contact and interaction schemas and actions"
```

---

## Task 1.8: Customer detail page with tabs

**Files:**
- Create: `src/app/(app)/customers/[id]/page.tsx`
- Create: `src/app/(app)/customers/[id]/customer-header.tsx`
- Create: `src/app/(app)/customers/[id]/overview-tab.tsx`
- Create: `src/app/(app)/customers/[id]/notes-field.tsx`
- Create: `src/app/(app)/customers/[id]/contacts-list.tsx`
- Create: `src/app/(app)/customers/[id]/activity-tab.tsx`
- Create: `src/app/(app)/customers/[id]/loading.tsx`

- [ ] **Step 1: The page**

Create `src/app/(app)/customers/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import {
  getCustomer, listContacts, listInteractions,
} from '@/lib/queries/customers'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CustomerHeader } from './customer-header'
import { OverviewTab } from './overview-tab'
import { ActivityTab } from './activity-tab'

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Next 16: params is a Promise.
  const { id } = await params

  const customer = await getCustomer(id)
  if (!customer) notFound()

  const [contacts, interactions] = await Promise.all([
    listContacts(id),
    listInteractions(id),
  ])

  return (
    <div className="space-y-6">
      <CustomerHeader customer={customer} contacts={contacts} />

      {/*
        Only Overview and Activity. Orders arrives in Phase 3, Pricing in
        Phase 2. Spec §7 Phase 1: omit the triggers entirely rather than
        stubbing disabled tabs — a disabled tab is a promise you have not
        kept, and she will click it every time.
      */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="min-h-11">Overview</TabsTrigger>
          <TabsTrigger value="activity" className="min-h-11">
            Activity
            {interactions.length > 0 ? (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {interactions.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4">
          <OverviewTab customer={customer} contacts={contacts} />
        </TabsContent>

        <TabsContent value="activity" className="pt-4">
          <ActivityTab
            customerId={customer.id}
            contacts={contacts}
            interactions={interactions}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 2: The header with inline status editing**

Create `src/app/(app)/customers/[id]/customer-header.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, Pencil, Plus } from 'lucide-react'
import type { Contact, Customer } from '@/lib/queries/customers'
import { CUSTOMER_STATUSES } from '@/lib/schemas/customers'
import { archiveCustomer, setCustomerStatus, unarchiveCustomer } from '@/lib/actions/customers'
import { StatusBadge } from '@/components/app/status-badge'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { CustomerEditSheet } from './customer-edit-sheet'
import { InteractionSheet } from './interaction-sheet'

const LABEL = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function CustomerHeader({
  customer,
  contacts,
}: {
  customer: Customer
  contacts: Contact[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [status, setStatus] = useState(customer.status)
  const [editing, setEditing] = useState(false)
  const [logging, setLogging] = useState(false)
  const [promptReason, setPromptReason] = useState(false)

  async function changeStatus(next: string) {
    const previous = status
    setStatus(next) // optimistic: single object, reversible. Spec §6.4.

    const result = await setCustomerStatus({ id: customer.id, status: next })

    if (!result.ok) {
      setStatus(previous)
      // Persistent, anchored near the control, with a retry. Spec §6.4.
      toast.error('Could not change status', {
        duration: Infinity,
        action: { label: 'Retry', onClick: () => void changeStatus(next) },
      })
      return
    }

    // Spec §7 Phase 1: moving to active or lost prompts — non-blocking —
    // to log an interaction explaining why.
    if (next === 'active' || next === 'lost') setPromptReason(true)
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-2xl font-semibold">{customer.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="capitalize">{customer.type}</span>
            {customer.city ? <span>· {customer.city}</span> : null}
            <span>· {customer.price_tier === 'retail' ? 'Retail' : 'Wholesale'} pricing</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Inline edit in a visibly different control, so an accidental
              change is obvious. Spec §6.1. */}
          <Select value={status} onValueChange={changeStatus}>
            <SelectTrigger className="h-11 w-40" aria-label="Customer status">
              <SelectValue>
                <StatusBadge status={status} />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{LABEL(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={() => setLogging(true)} className="h-11">
            <Plus className="size-4" aria-hidden />
            Log interaction
          </Button>

          <Button variant="outline" size="icon" className="size-11" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden />
            <span className="sr-only">Edit customer</span>
          </Button>

          {/* Reversible → Undo toast, not a confirm dialog. Spec §6.4. */}
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            onClick={async () => {
              const result = await archiveCustomer(customer.id)
              if (!result.ok) { toast.error(result.error); return }
              toast.success(`${customer.name} archived`, {
                action: {
                  label: 'Undo',
                  onClick: async () => {
                    await unarchiveCustomer(customer.id)
                    router.refresh()
                  },
                },
              })
              router.push('/customers')
            }}
          >
            <Archive className="size-4" aria-hidden />
            <span className="sr-only">Archive customer</span>
          </Button>
        </div>
      </div>

      <CustomerEditSheet
        customer={customer}
        open={editing}
        onOpenChange={setEditing}
      />

      <InteractionSheet
        customerId={customer.id}
        contacts={contacts}
        open={logging || promptReason}
        onOpenChange={(v) => { setLogging(v); setPromptReason(v) }}
        prefillSubject={
          promptReason
            ? status === 'active' ? 'Became a customer' : 'Marked as lost'
            : undefined
        }
      />
    </div>
  )
}
```

- [ ] **Step 3: The autosaving notes field**

Create `src/app/(app)/customers/[id]/notes-field.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { saveCustomerNotes } from '@/lib/actions/customers'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

/**
 * The ONLY autosaving field in the app. Spec §6.4 permits it for free-text
 * notes with a visible saved indicator, and forbids it everywhere else —
 * autosave must never trigger an irreversible side effect.
 */
export function NotesField({
  customerId,
  initial,
}: {
  customerId: string
  initial: string | null
}) {
  const [value, setValue] = useState(initial ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef(initial ?? '')

  useEffect(() => {
    if (value === lastSaved.current) return

    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setState('saving')
      const result = await saveCustomerNotes({ id: customerId, notes: value })
      if (result.ok) {
        lastSaved.current = value
        setState('saved')
        setTimeout(() => setState('idle'), 2000)
      } else {
        setState('idle')
      }
    }, 900)

    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [value, customerId])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="customer-notes">Notes</Label>
        <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {state === 'saving' ? (
            <><Loader2 className="size-3 animate-spin" aria-hidden /> Saving…</>
          ) : state === 'saved' ? (
            <><Check className="size-3" aria-hidden /> Saved</>
          ) : null}
        </span>
      </div>
      <Textarea
        id="customer-notes"
        rows={5}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Anything worth remembering — who decides, what they liked, when they're busy."
      />
    </div>
  )
}
```

- [ ] **Step 4: Overview tab and contacts list**

Create `src/app/(app)/customers/[id]/overview-tab.tsx`:

```tsx
import type { Contact, Customer } from '@/lib/queries/customers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NotesField } from './notes-field'
import { ContactsList } from './contacts-list'

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value?.trim() ? value : '—'}</dd>
    </div>
  )
}

export function OverviewTab({
  customer,
  contacts,
}: {
  customer: Customer
  contacts: Contact[]
}) {
  const address = [
    customer.address_line1, customer.address_line2,
    customer.city, customer.postcode,
  ].filter(Boolean).join(', ')

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4">
            <Detail label="Email" value={customer.email} />
            <Detail label="Phone" value={customer.phone} />
            <Detail label="Address" value={address || null} />
            <Detail label="Delivery notes" value={customer.delivery_notes} />
            <Detail label="Source" value={customer.source} />
            <Detail
              label="Price tier"
              value={customer.price_tier === 'retail' ? 'Retail' : 'Wholesale'}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Contacts</CardTitle></CardHeader>
        <CardContent>
          <ContactsList customerId={customer.id} contacts={contacts} />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardContent className="pt-6">
          <NotesField customerId={customer.id} initial={customer.notes} />
        </CardContent>
      </Card>
    </div>
  )
}
```

Create `src/app/(app)/customers/[id]/contacts-list.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import * as z from 'zod'
import { Plus, Star, Trash2 } from 'lucide-react'
import type { Contact } from '@/lib/queries/customers'
import { contactSchema } from '@/lib/schemas/contacts'
import { createContact, deleteContact, updateContact } from '@/lib/actions/contacts'
import { TextField } from '@/components/app/form-fields'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

type In = z.input<typeof contactSchema>
type Out = z.output<typeof contactSchema>

function ContactForm({
  customerId,
  contact,
  onDone,
}: {
  customerId: string
  contact?: Contact
  onDone: () => void
}) {
  const router = useRouter()
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(contactSchema),
    mode: 'onTouched',
    defaultValues: {
      customer_id: customerId,
      name: contact?.name ?? '',
      role: contact?.role ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      is_primary: contact?.is_primary ?? false,
      notes: contact?.notes ?? '',
    },
  })

  const { control, handleSubmit, formState, watch, setValue } = form
  const isPrimary = watch('is_primary')

  return (
    <form
      className="space-y-4 rounded-lg border p-3"
      onSubmit={handleSubmit(async (values) => {
        const result = contact
          ? await updateContact(contact.id, values)
          : await createContact(values)
        if (!result.ok) { toast.error(result.error); return }
        toast.success(contact ? 'Contact updated' : 'Contact added')
        onDone()
        router.refresh()
      })}
    >
      <TextField control={control} name="name" label="Name" autoFocus autoComplete="name" />
      <TextField control={control} name="role" label="Role" placeholder="Owner, manager, buyer…" />
      <TextField control={control} name="email" label="Email" type="email" inputMode="email" />
      <TextField control={control} name="phone" label="Phone" type="tel" inputMode="tel" />

      <div className="flex items-center gap-3">
        <Switch
          id="is_primary"
          checked={Boolean(isPrimary)}
          onCheckedChange={(v) => setValue('is_primary', v, { shouldDirty: true })}
        />
        <Label htmlFor="is_primary">Main contact</Label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={formState.isSubmitting} className="h-11">
          {contact ? 'Save contact' : 'Add contact'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} className="h-11">
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function ContactsList({
  customerId,
  contacts,
}: {
  customerId: string
  contacts: Contact[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      {contacts.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">
          No contacts yet. Add the person you actually talk to.
        </p>
      ) : null}

      {contacts.map((c) =>
        editingId === c.id ? (
          <ContactForm
            key={c.id}
            customerId={customerId}
            contact={c}
            onDone={() => setEditingId(null)}
          />
        ) : (
          <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg border p-3">
            <button
              type="button"
              onClick={() => setEditingId(c.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                {c.is_primary ? (
                  <Badge variant="secondary" className="gap-1">
                    <Star className="size-3" aria-hidden /> Main
                  </Badge>
                ) : null}
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {[c.role, c.email, c.phone].filter(Boolean).join(' · ') || 'No details'}
              </div>
            </button>
            <Button
              variant="ghost" size="icon" className="size-11 shrink-0"
              onClick={async () => {
                const result = await deleteContact(c.id, customerId)
                if (!result.ok) { toast.error(result.error); return }
                toast.success(`${c.name} removed`)
                router.refresh()
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Remove {c.name}</span>
            </Button>
          </div>
        ),
      )}

      {adding ? (
        <ContactForm customerId={customerId} onDone={() => setAdding(false)} />
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)} className="h-11 w-full">
          <Plus className="size-4" aria-hidden /> Add contact
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Loading skeleton for the detail route**

Create `src/app/(app)/customers/[id]/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-10 w-56" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Verify**

Visit a customer's detail page.
1. Two tabs only — Overview and Activity. **No greyed-out Orders or Pricing tab.** ✅
2. Change status in the header → badge updates immediately; refresh confirms it persisted. ✅
3. Change status to `active` → the interaction sheet opens on its own, pre-filled. Dismissing it does not undo the status change. ✅
4. Add a contact, mark it Main. Add a second, mark that Main too. **Both saves succeed and only the second shows the Main badge.** ✅ (the trigger, from the UI)
5. Type in Notes, wait a second → "Saving…" then "Saved". Refresh → text persisted. ✅
6. Archive → toast with Undo, redirected to the list, customer gone. Click Undo → it comes back. ✅

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/customers/[id]"
git commit -m "feat(customers): detail page with overview, contacts, autosaving notes"
```

---

## Task 1.9: The reference edit sheet

**Files:**
- Create: `src/components/app/record-sheet.tsx`
- Create: `src/app/(app)/customers/[id]/customer-edit-sheet.tsx`

- [ ] **Step 1: The generic sheet**

Create `src/components/app/record-sheet.tsx`:

```tsx
'use client'

import type { ReactNode } from 'react'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'

/**
 * Spec §6.1: a right-hand NON-MODAL sheet, so the list behind stays visible
 * and readable. NN/g's data-tables research found users routinely refer to
 * other records while editing one — a modal covers exactly the rows they
 * need. modal={false} is the whole point of this component; do not remove
 * it "to fix" the focus behaviour.
 *
 * Full pages are for multi-section creation (a new order with line items).
 * Real modals are ONLY for irreversible confirmation.
 */
export function RecordSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="px-4 pt-4">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="flex-1 px-4 pb-4 pt-2">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
```

`onInteractOutside` is prevented deliberately: a non-modal sheet that closes when you click the list behind it destroys the very workflow it exists for. Escape and the close button still work, so it is not a trap.

- [ ] **Step 2: The customer edit sheet**

Create `src/app/(app)/customers/[id]/customer-edit-sheet.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { Customer } from '@/lib/queries/customers'
import { updateCustomer } from '@/lib/actions/customers'
import { CustomerForm } from '@/components/app/customer-form'
import { RecordSheet } from '@/components/app/record-sheet'

export function CustomerEditSheet({
  customer,
  open,
  onOpenChange,
}: {
  customer: Customer
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  return (
    <RecordSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${customer.name}`}
    >
      <CustomerForm
        customer={customer}
        submitLabel="Save changes"
        onSubmit={async (values) => {
          const result = await updateCustomer(customer.id, values)
          if (result.ok) {
            toast.success('Customer updated')
            onOpenChange(false)
            router.refresh()
          }
          return result
        }}
      />
    </RecordSheet>
  )
}
```

- [ ] **Step 3: Verify**

Open the edit sheet from a customer's detail page.
1. It slides in from the right; the page behind is still readable and scrollable. ✅
2. Clicking the page behind does **not** close it. Escape does. ✅
3. Editing and saving closes it and updates the header. ✅
4. At 375px it takes the full width. ✅

- [ ] **Step 4: Commit**

```bash
git add src/components/app/record-sheet.tsx "src/app/(app)/customers/[id]/customer-edit-sheet.tsx"
git commit -m "feat(ui): reference non-modal edit sheet"
```

---

## Task 1.10: Interaction logging sheet — optimise this hard

Spec §7 Phase 1: this is the most-repeated action in the app. The acceptance bar is **under 20 seconds on a phone**.

**Files:**
- Create: `src/app/(app)/customers/[id]/interaction-sheet.tsx`
- Create: `src/components/app/channel-picker.tsx`

- [ ] **Step 1: Channel picker as icon toggles, not a dropdown**

Create `src/components/app/channel-picker.tsx`:

```tsx
'use client'

import {
  Handshake, Mail, MessageCircle, MoreHorizontal, Package, Phone,
} from 'lucide-react'
import { CHANNELS, CHANNEL_LABELS, type Channel } from '@/lib/schemas/interactions'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ICONS: Record<Channel, typeof Mail> = {
  email: Mail,
  phone: Phone,
  whatsapp: MessageCircle,
  in_person: Handshake,
  sample_drop: Package,
  other: MoreHorizontal,
}

/** Spec §7 Phase 1: a row of icon toggle buttons, never a dropdown. One
 *  tap instead of open-scan-select. */
export function ChannelPicker({
  value,
  onChange,
  invalid,
}: {
  value: Channel | ''
  onChange: (c: Channel) => void
  invalid?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label="How did you contact them?"
      aria-invalid={invalid || undefined}
      className="grid grid-cols-3 gap-2"
    >
      {CHANNELS.map((c) => {
        const Icon = ICONS[c]
        const selected = value === c
        return (
          <Button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            variant={selected ? 'default' : 'outline'}
            onClick={() => onChange(c)}
            className={cn('h-16 flex-col gap-1 px-1', selected && 'font-semibold')}
          >
            <Icon className="size-5" aria-hidden />
            <span className="text-xs leading-none">{CHANNEL_LABELS[c]}</span>
          </Button>
        )
      })}
    </div>
  )
}
```

64px tall, well past the 44px minimum — these get tapped standing in a kitchen.

- [ ] **Step 2: The sheet**

Create `src/app/(app)/customers/[id]/interaction-sheet.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import * as z from 'zod'
import { format } from 'date-fns'
import type { Contact } from '@/lib/queries/customers'
import {
  interactionSchema, OUTCOMES, OUTCOME_LABELS,
  FOLLOW_UP_CHIPS, followUpOffsetToDate, type Channel,
} from '@/lib/schemas/interactions'
import { logInteraction } from '@/lib/actions/interactions'
import { RecordSheet } from '@/components/app/record-sheet'
import { ChannelPicker } from '@/components/app/channel-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type In = z.input<typeof interactionSchema>
type Out = z.output<typeof interactionSchema>

export function InteractionSheet({
  customerId,
  contacts,
  open,
  onOpenChange,
  prefillSubject,
}: {
  customerId: string
  contacts: Contact[]
  open: boolean
  onOpenChange: (open: boolean) => void
  prefillSubject?: string
}) {
  const router = useRouter()
  const primary = contacts.find((c) => c.is_primary) ?? contacts[0]

  function blank(): In {
    return {
      customer_id: customerId,
      // Pre-filled with today and the primary contact. Spec §7 Phase 1.
      occurred_at: new Date().toISOString(),
      contact_id: primary?.id ?? '',
      channel: '' as unknown as Channel,
      direction: 'outbound',
      subject: prefillSubject ?? '',
      notes: '',
      outcome: '',
      follow_up_on: '',
    }
  }

  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(interactionSchema),
    mode: 'onTouched',
    defaultValues: blank(),
  })

  const { control, handleSubmit, formState, watch, setValue, reset } = form

  useEffect(() => {
    if (open) reset(blank())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefillSubject])

  const channel = watch('channel') as Channel | ''
  const outcome = watch('outcome') as string
  const followUpOn = watch('follow_up_on') as string
  const occurredAt = watch('occurred_at') as string

  async function save(values: Out, andAnother: boolean) {
    const result = await logInteraction(values)
    if (!result.ok) { toast.error(result.error); return }

    toast.success('Logged')
    router.refresh()

    if (andAnother) {
      // Keep the customer and the channel; clear what changes each time.
      reset({ ...blank(), channel: values.channel })
    } else {
      onOpenChange(false)
    }
  }

  return (
    <RecordSheet open={open} onOpenChange={onOpenChange} title="Log interaction">
      <form className="space-y-5" onSubmit={handleSubmit((v) => save(v, false))}>
        <div className="space-y-2">
          <Label>How did you contact them?</Label>
          <ChannelPicker
            value={channel}
            onChange={(c) => setValue('channel', c, { shouldValidate: true })}
            invalid={Boolean(formState.errors.channel)}
          />
          {formState.errors.channel ? (
            <p className="text-sm text-destructive">
              {formState.errors.channel.message as string}
            </p>
          ) : null}
        </div>

        {contacts.length > 0 ? (
          <div className="space-y-2">
            <Label htmlFor="contact_id">Who did you speak to?</Label>
            <Select
              value={(watch('contact_id') as string) ?? ''}
              onValueChange={(v) => setValue('contact_id', v)}
            >
              <SelectTrigger id="contact_id" className="h-11">
                <SelectValue placeholder="Nobody in particular" />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.is_primary ? ' (main)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="notes">What happened?</Label>
          {/* Autofocused. Spec §7 Phase 1 — it is what she came here to type. */}
          <Textarea
            id="notes"
            rows={4}
            autoFocus
            value={(watch('notes') as string) ?? ''}
            onChange={(e) => setValue('notes', e.target.value)}
            placeholder="Dropped two samples with Sam. Wants a price list."
          />
        </div>

        <div className="space-y-2">
          <Label>Outcome</Label>
          {/* Segmented buttons, not a dropdown. Spec §7 Phase 1. */}
          <div role="radiogroup" aria-label="Outcome" className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => {
              const selected = outcome === o
              return (
                <Button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  variant={selected ? 'default' : 'outline'}
                  onClick={() => setValue('outcome', selected ? '' : o)}
                  className="h-11"
                >
                  {OUTCOME_LABELS[o]}
                </Button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="follow_up_on">Follow up on</Label>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOW_UP_CHIPS.map((chip) => {
              const chipDate = followUpOffsetToDate(chip.value)
              const selected = followUpOn === chipDate
              return (
                <Button
                  key={chip.value}
                  type="button"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  onClick={() => setValue('follow_up_on', selected ? '' : chipDate)}
                  className="h-11"
                >
                  {chip.label}
                </Button>
              )
            })}
          </div>
          {/* Typing a date must also work. A native date input is a
              segmented field on every platform — never calendar-click-only.
              Spec §7 Phase 1. */}
          <Input
            id="follow_up_on"
            type="date"
            min={format(new Date(), 'yyyy-MM-dd')}
            value={followUpOn ?? ''}
            onChange={(e) => setValue('follow_up_on', e.target.value, { shouldValidate: true })}
            className={cn('h-11 max-w-48', formState.errors.follow_up_on && 'border-destructive')}
          />
          {formState.errors.follow_up_on ? (
            <p className="text-sm text-destructive">
              {formState.errors.follow_up_on.message as string}
            </p>
          ) : null}
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer py-2 text-muted-foreground">
            Change the date or add a subject
          </summary>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="occurred_at">When</Label>
              <Input
                id="occurred_at"
                type="datetime-local"
                value={occurredAt ? format(new Date(occurredAt), "yyyy-MM-dd'T'HH:mm") : ''}
                onChange={(e) =>
                  setValue('occurred_at', new Date(e.target.value).toISOString())
                }
                className="h-11 max-w-60"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={(watch('subject') as string) ?? ''}
                onChange={(e) => setValue('subject', e.target.value)}
                className="h-11"
              />
            </div>
          </div>
        </details>

        <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background py-3 sm:flex-row">
          <Button type="submit" disabled={formState.isSubmitting} className="h-11 flex-1">
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={formState.isSubmitting}
            onClick={handleSubmit((v) => save(v, true))}
            className="h-11 flex-1"
          >
            Save and log another
          </Button>
        </div>
      </form>
    </RecordSheet>
  )
}
```

- [ ] **Step 3: Verify — this is a Phase 1 acceptance criterion**

At **375px width**, on a customer detail page. **Time yourself.** Tap "Log interaction", tap Phone, type a sentence, tap Interested, tap "In 3 days", tap Save.
Expected: **under 20 seconds.** If it is not, the bottleneck is a bug — find it.

Then:
1. Save with no channel → error on the channel group, nothing lost. ✅
2. "Save and log another" → the sheet stays open, notes clear, channel is kept. ✅
3. Type a follow-up date directly into the date field → accepted. ✅
4. Try a follow-up date in the past → rejected with a message. ✅
5. The saved interaction appears on the Activity tab. ✅

- [ ] **Step 4: Commit**

```bash
git add src/components/app/channel-picker.tsx "src/app/(app)/customers/[id]/interaction-sheet.tsx"
git commit -m "feat(crm): interaction logging sheet — icon channels, segmented outcomes, quick-pick follow-ups"
```

---

## Task 1.11: Activity timeline

**Files:**
- Create: `src/app/(app)/customers/[id]/activity-tab.tsx`

- [ ] **Step 1: Build it**

Create `src/app/(app)/customers/[id]/activity-tab.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import {
  Handshake, Mail, MessageCircle, MoreHorizontal, Package, Phone, Plus,
} from 'lucide-react'
import type { Contact, InteractionWithContact } from '@/lib/queries/customers'
import {
  CHANNEL_LABELS, OUTCOME_LABELS, type Channel, type Outcome,
} from '@/lib/schemas/interactions'
import { setFollowUpDone } from '@/lib/actions/interactions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { NoDataYet } from '@/components/app/empty-state'
import { InteractionSheet } from './interaction-sheet'

const ICONS: Record<Channel, typeof Mail> = {
  email: Mail, phone: Phone, whatsapp: MessageCircle,
  in_person: Handshake, sample_drop: Package, other: MoreHorizontal,
}

export function ActivityTab({
  customerId,
  contacts,
  interactions,
}: {
  customerId: string
  contacts: Contact[]
  interactions: InteractionWithContact[]
}) {
  const router = useRouter()
  const [logging, setLogging] = useState(false)
  const [done, setDone] = useState<Record<string, boolean>>({})

  // Reverse chronological, grouped by month. Spec §7 Phase 1.
  const groups = useMemo(() => {
    const map = new Map<string, InteractionWithContact[]>()
    for (const i of interactions) {
      const key = format(parseISO(i.occurred_at), 'MMMM yyyy')
      const list = map.get(key)
      if (list) list.push(i)
      else map.set(key, [i])
    }
    return [...map.entries()]
  }, [interactions])

  async function toggleDone(id: string, next: boolean) {
    setDone((d) => ({ ...d, [id]: next })) // optimistic
    const result = await setFollowUpDone({ id, done: next })
    if (!result.ok) {
      setDone((d) => ({ ...d, [id]: !next }))
      toast.error('Could not update the follow-up', {
        duration: Infinity,
        action: { label: 'Retry', onClick: () => void toggleDone(id, next) },
      })
      return
    }
    router.refresh()
  }

  if (interactions.length === 0) {
    return (
      <>
        <NoDataYet
          icon={<Phone className="size-10" aria-hidden />}
          title="No outreach logged yet"
          description="Every call, email and sample drop goes here. It is what turns this from a contact list into a CRM."
          action={
            <Button onClick={() => setLogging(true)} className="h-11">
              <Plus className="size-4" aria-hidden /> Log the first interaction
            </Button>
          }
        />
        <InteractionSheet
          customerId={customerId}
          contacts={contacts}
          open={logging}
          onOpenChange={setLogging}
        />
      </>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map(([month, items]) => (
        <section key={month} className="space-y-2">
          <h3 className="sticky top-14 z-10 bg-background py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {month}
          </h3>

          <ol className="space-y-2">
            {items.map((i) => {
              const Icon = ICONS[i.channel as Channel] ?? MoreHorizontal
              const isDone = done[i.id] ?? i.follow_up_done
              const overdue =
                i.follow_up_on && !isDone &&
                i.follow_up_on < format(new Date(), 'yyyy-MM-dd')

              return (
                <li key={i.id} className="flex gap-3 rounded-lg border p-3">
                  <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted">
                    <Icon className="size-4" aria-hidden />
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">
                        {CHANNEL_LABELS[i.channel as Channel] ?? i.channel}
                      </span>
                      <span className="text-muted-foreground">
                        {format(parseISO(i.occurred_at), 'd MMM, HH:mm')}
                      </span>
                      {i.contacts?.name ? (
                        <span className="text-muted-foreground">· {i.contacts.name}</span>
                      ) : null}
                      {i.direction === 'inbound' ? (
                        <Badge variant="outline">They contacted us</Badge>
                      ) : null}
                      {i.outcome ? (
                        <Badge variant="secondary">
                          {OUTCOME_LABELS[i.outcome as Outcome] ?? i.outcome}
                        </Badge>
                      ) : null}
                    </div>

                    {i.subject ? <p className="text-sm font-medium">{i.subject}</p> : null}
                    {i.notes ? (
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {i.notes}
                      </p>
                    ) : null}

                    {i.follow_up_on ? (
                      <label className="flex items-center gap-2 pt-1 text-sm">
                        <Checkbox
                          checked={isDone}
                          onCheckedChange={(v) => toggleDone(i.id, v === true)}
                          aria-label="Follow-up done"
                        />
                        <span className={overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                          {isDone ? 'Followed up' : overdue ? 'Overdue since' : 'Follow up on'}{' '}
                          {format(parseISO(i.follow_up_on), 'd MMM')}
                        </span>
                      </label>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}

      <InteractionSheet
        customerId={customerId}
        contacts={contacts}
        open={logging}
        onOpenChange={setLogging}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify**

1. Log three interactions across two months → two month headings, newest first. ✅
2. A channel icon and outcome badge appear on each. ✅
3. An overdue follow-up is visually distinct (red, and the word "Overdue"). ✅
4. Ticking the checkbox updates instantly; refresh confirms it persisted. ✅
5. On a customer with no interactions, the "No outreach logged yet" state appears with a working CTA. ✅

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/customers/[id]/activity-tab.tsx"
git commit -m "feat(crm): activity timeline grouped by month with optimistic follow-up toggle"
```

---

## Task 1.12: Follow-ups due on the dashboard

Fills the "Today" section of the Phase 0 shell.

**Files:**
- Create: `src/components/app/follow-ups-due.tsx`
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: The component**

Create `src/components/app/follow-ups-due.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { CheckCircle2 } from 'lucide-react'
import type { FollowUpDue } from '@/lib/queries/customers'
import { setFollowUpDone } from '@/lib/actions/interactions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function FollowUpsDue({ items }: { items: FollowUpDue[] }) {
  const router = useRouter()
  const [cleared, setCleared] = useState<Set<string>>(new Set())

  const visible = items.filter((i) => i.id && !cleared.has(i.id))

  if (visible.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4" aria-hidden />
        No follow-ups due. Nice.
      </div>
    )
  }

  async function markDone(item: FollowUpDue) {
    const id = item.id!
    setCleared((s) => new Set(s).add(id)) // optimistic

    const result = await setFollowUpDone({ id, done: true })
    if (!result.ok) {
      setCleared((s) => { const n = new Set(s); n.delete(id); return n })
      toast.error('Could not mark that done', {
        duration: Infinity,
        action: { label: 'Retry', onClick: () => void markDone(item) },
      })
      return
    }

    // Reversible → Undo, not confirm. Spec §6.4.
    toast.success(`Follow-up with ${item.customer_name} cleared`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          await setFollowUpDone({ id, done: false })
          setCleared((s) => { const n = new Set(s); n.delete(id); return n })
          router.refresh()
        },
      },
    })
    router.refresh()
  }

  return (
    <ul className="space-y-2">
      {visible.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between gap-3 rounded-lg border p-3"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/customers/${item.customer_id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {item.customer_name}
              </Link>
              {item.is_overdue ? (
                <Badge variant="destructive">
                  Overdue · {format(parseISO(item.follow_up_on!), 'd MMM')}
                </Badge>
              ) : (
                <Badge variant="secondary">Today</Badge>
              )}
            </div>
            {item.notes ? (
              <p className="truncate text-sm text-muted-foreground">{item.notes}</p>
            ) : null}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => markDone(item)}
            className="h-11 shrink-0"
          >
            Done
          </Button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Wire it into the dashboard**

In `src/app/(app)/page.tsx`, replace the Phase 1 placeholder. Add the imports:

```tsx
import { listFollowUpsDue } from '@/lib/queries/customers'
import { FollowUpsDue } from '@/components/app/follow-ups-due'
```

Make the component fetch:

```tsx
export default async function DashboardPage() {
  const followUps = await listFollowUpsDue()
  // …
```

And replace the first section's body:

```tsx
      <DashboardSection
        title="Today"
        action={
          followUps.length > 0 ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/customers?followup=due">See all</Link>
            </Button>
          ) : null
        }
      >
        <FollowUpsDue items={followUps} />
      </DashboardSection>
```

Add `import Link from 'next/link'` and `import { Button } from '@/components/ui/button'` at the top.

- [ ] **Step 3: Verify — Phase 1 acceptance criteria**

1. Log an interaction with a follow-up dated today → it appears in the dashboard's Today section. ✅
2. Tap "Done" → it disappears immediately, with an Undo toast. ✅
3. Tap Undo → it comes back. ✅
4. Backdate a follow-up via SQL (`update interactions set follow_up_on = f_today() - 3 where id = '…'`) → it shows as **Overdue**, visually distinct. ✅
5. "See all" goes to `/customers?followup=due` and the list is filtered. ✅
6. With no follow-ups → "No follow-ups due. Nice." ✅

- [ ] **Step 4: Commit**

```bash
git add src/components/app/follow-ups-due.tsx "src/app/(app)/page.tsx"
git commit -m "feat(dashboard): follow-ups due with optimistic clear and undo"
```

---

## Task 1.13: Phase Exit — acceptance gate

- [ ] `npm run typecheck` → clean, no `any`, no `@ts-ignore`
- [ ] `npm test` → all pass
- [ ] `npm run build` → succeeds
- [ ] `verify.sql` runs clean via MCP `execute_sql`
- [ ] Add a customer with only a name in **under 10 seconds** (timed)
- [ ] Log an interaction with a follow-up in **under 20 seconds on a phone** (timed at 375px)
- [ ] Follow-ups due today appear on the dashboard and clear in one tap
- [ ] Filters persist across refresh and are shareable by URL
- [ ] Both empty states exist on `/customers` and are visibly different screens
- [ ] Two contacts both marked primary → the second wins, no error
- [ ] The edit sheet does not close when you click the page behind it
- [ ] Customer detail shows exactly two tabs — no stubbed Orders or Pricing
- [ ] Fully usable at 375px: no horizontal scroll, every target ≥ 44px
- [ ] `npx playwright test` is not required yet — Phase 8 adds the journey
- [ ] Open the PR: `gh pr create --title "Phase 1 — Customers, contacts, outreach"`
