# Phase 7 — Speed and Robustness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app fast for someone who uses it every day, and safe for someone using it on a phone in a kitchen with one hand.

**Architecture:** The command palette is an accelerator layered over the existing navigation — it never replaces a visible button. Search is a single Server Action over three tables. CSV export is a route handler with no new dependencies.

**Tech Stack:** Adds shadcn's `command` (installed in Phase 1) driven by `cmdk` 1.1. No new dependencies.

---

**Branch:** `git checkout main && git pull && git checkout -b phase-7-polish`

**Depends on:** Phase 6 complete. This phase adds no migrations.

---

# Phase 7a — Speed

## Task 7.1: Global search

**Files:**
- Create: `src/lib/actions/search.ts`

- [ ] **Step 1: The action**

Create `src/lib/actions/search.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'

export type SearchHit = {
  kind: 'customer' | 'order' | 'product'
  id: string
  title: string
  subtitle: string
  href: string
}

/**
 * One round trip across the three things she looks for. Deliberately
 * capped at 8 per kind — the palette is for finding a known record, not
 * for browsing. Browsing is what the list pages are for.
 */
export async function search(query: string): Promise<SearchHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const supabase = await createClient()
  const like = `%${q}%`
  const orderNumber = /^#?(\d+)$/.exec(q)?.[1]

  const [customers, products, orders] = await Promise.all([
    supabase
      .from('customers')
      .select('id, name, city, status')
      .is('archived_at', null)
      .or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like},city.ilike.${like}`)
      .limit(8),
    supabase
      .from('products')
      .select('id, name, sku')
      .is('archived_at', null)
      .or(`name.ilike.${like},sku.ilike.${like}`)
      .limit(8),
    orderNumber
      ? supabase
          .from('v_order_list')
          .select('order_id, order_number, customer_name, delivery_date')
          .eq('order_number', Number(orderNumber))
          .limit(8)
      : supabase
          .from('v_order_list')
          .select('order_id, order_number, customer_name, delivery_date')
          .ilike('customer_name', like)
          .order('delivery_date', { ascending: false })
          .limit(8),
  ])

  const hits: SearchHit[] = []

  for (const c of customers.data ?? []) {
    hits.push({
      kind: 'customer',
      id: c.id,
      title: c.name,
      subtitle: [c.city, c.status].filter(Boolean).join(' · '),
      href: `/customers/${c.id}`,
    })
  }

  for (const o of orders.data ?? []) {
    hits.push({
      kind: 'order',
      id: o.order_id!,
      title: `Order #${o.order_number}`,
      subtitle: `${o.customer_name} · ${o.delivery_date}`,
      href: `/orders/${o.order_id}`,
    })
  }

  for (const p of products.data ?? []) {
    hits.push({
      kind: 'product',
      id: p.id,
      title: p.name,
      subtitle: p.sku ?? 'No SKU',
      href: `/products/${p.id}`,
    })
  }

  return hits
}
```

- [ ] **Step 2: Verify**

Call it from a scratch route handler with `"caf"`, `"#3"`, and `"almond"`. Each returns the expected hits. Delete the scratch file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/search.ts
git commit -m "feat(search): one-round-trip search over customers, orders and products"
```

---

## Task 7.2: Command palette

**Files:**
- Create: `src/lib/aliases.ts`
- Create: `src/lib/aliases.test.ts`
- Create: `src/components/app/command-palette.tsx`
- Modify: `src/components/app/app-shell.tsx`

- [ ] **Step 1: Write the failing alias test**

Spec §6.5 requires forgiving matching — *"client" finds "customer"; "cafe" matches "café"*.

Create `src/lib/aliases.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fold, matchesAlias, NAV_ALIASES } from '@/lib/aliases'

describe('fold', () => {
  it('strips diacritics so cafe matches café', () => {
    expect(fold('Café Lila')).toBe('cafe lila')
  })

  it('lowercases and trims', () => {
    expect(fold('  Iron GYM ')).toBe('iron gym')
  })

  it('collapses internal whitespace', () => {
    expect(fold('Iron   Gym')).toBe('iron gym')
  })

  it('handles an empty string', () => {
    expect(fold('')).toBe('')
  })
})

describe('matchesAlias', () => {
  it('finds customers when you type client', () => {
    expect(matchesAlias('client', 'Customers', NAV_ALIASES.Customers)).toBe(true)
  })

  it('finds customers when you type the real word', () => {
    expect(matchesAlias('cust', 'Customers', NAV_ALIASES.Customers)).toBe(true)
  })

  it('finds production when you type bake', () => {
    expect(matchesAlias('bake', 'Production', NAV_ALIASES.Production)).toBe(true)
  })

  it('finds invoices when you type bill', () => {
    expect(matchesAlias('bill', 'Invoices', NAV_ALIASES.Invoices)).toBe(true)
  })

  it('finds schedules when you type recurring', () => {
    expect(matchesAlias('recurring', 'Schedules', NAV_ALIASES.Schedules)).toBe(true)
  })

  it('does not match an unrelated word', () => {
    expect(matchesAlias('zebra', 'Customers', NAV_ALIASES.Customers)).toBe(false)
  })

  it('matches everything on an empty query', () => {
    expect(matchesAlias('', 'Customers', NAV_ALIASES.Customers)).toBe(true)
  })
})
```

- [ ] **Step 2: Run and watch it fail** → `npm test` → FAIL.

- [ ] **Step 3: Write it**

Create `src/lib/aliases.ts`:

```ts
/** Diacritic-insensitive, case-insensitive, whitespace-normalised. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Spec §6.5: forgiving matching. She will not learn our vocabulary, and
 * she should not have to.
 */
export const NAV_ALIASES: Record<string, string[]> = {
  Dashboard:   ['home', 'today', 'overview', 'start'],
  Customers:   ['client', 'clients', 'cafe', 'account', 'accounts', 'contact', 'contacts', 'lead', 'leads'],
  Orders:      ['order', 'sale', 'sales', 'delivery', 'deliveries'],
  Schedules:   ['recurring', 'standing', 'repeat', 'weekly', 'subscription'],
  Production:  ['bake', 'baking', 'kitchen', 'shopping', 'ingredients needed', 'prep'],
  Invoices:    ['bill', 'billing', 'invoice', 'payment', 'payments', 'money owed'],
  Products:    ['bar', 'bars', 'catalogue', 'catalog', 'item', 'items', 'sku'],
  Ingredients: ['stock', 'supplies', 'oats', 'raw'],
  Insights:    ['report', 'reports', 'analytics', 'stats', 'numbers', 'revenue'],
  Settings:    ['config', 'preferences', 'currency', 'bank', 'business details'],
}

export function matchesAlias(
  query: string,
  label: string,
  aliases: string[] = [],
): boolean {
  const q = fold(query)
  if (q === '') return true
  if (fold(label).includes(q)) return true
  return aliases.some((a) => fold(a).includes(q))
}
```

- [ ] **Step 4: Run and watch it pass** → `npm test` → PASS.

- [ ] **Step 5: The palette**

Create `src/components/app/command-palette.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { NAV_LINKS } from '@/components/app/nav-links'
import { NAV_ALIASES, matchesAlias } from '@/lib/aliases'
import { search, type SearchHit } from '@/lib/actions/search'
import { Button } from '@/components/ui/button'
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from '@/components/ui/command'

const CREATE_ACTIONS = [
  { label: 'New customer',    href: '/customers/new', shortcut: 'N C' },
  { label: 'New order',       href: '/orders/new',    shortcut: 'N O' },
  { label: 'New invoice',     href: '/invoices/new',  shortcut: 'N I' },
  { label: 'New schedule',    href: '/schedules/new', shortcut: 'N S' },
  { label: "Today's follow-ups", href: '/customers?followup=due', shortcut: '' },
]

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [, startTransition] = useTransition()

  // Cmd/Ctrl+K opens AND closes, restoring focus. Spec §6.5.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (query.trim().length < 2) { setHits([]); return }
    const t = setTimeout(() => {
      startTransition(async () => setHits(await search(query)))
    }, 150)
    return () => clearTimeout(t)
  }, [query])

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      setQuery('')
      router.push(href)
    },
    [router],
  )

  const navMatches = NAV_LINKS.filter((l) =>
    matchesAlias(query, l.label, NAV_ALIASES[l.label]),
  )
  const createMatches = CREATE_ACTIONS.filter((a) => matchesAlias(query, a.label))

  return (
    <>
      {/* The palette is an ACCELERATOR. This visible trigger means a
          novice never has to know the shortcut exists. Spec §6.5. */}
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-11 w-full justify-start gap-2 text-muted-foreground sm:max-w-xs"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border px-1.5 text-xs sm:inline">⌘K</kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search and commands"
        description="Search customers, orders and products, or jump to a page."
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search, or type a page name…"
        />
        <CommandList>
          <CommandEmpty>Nothing found. Try a customer name or an order number.</CommandEmpty>

          {hits.length > 0 ? (
            <>
              <CommandGroup heading="Results">
                {hits.map((hit) => (
                  <CommandItem
                    key={`${hit.kind}-${hit.id}`}
                    value={`${hit.title} ${hit.subtitle}`}
                    onSelect={() => go(hit.href)}
                  >
                    <span className="font-medium">{hit.title}</span>
                    <span className="ml-2 truncate text-muted-foreground">{hit.subtitle}</span>
                    <CommandShortcut className="capitalize">{hit.kind}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          {createMatches.length > 0 ? (
            <CommandGroup heading="Create">
              {createMatches.map((a) => (
                <CommandItem key={a.href} value={a.label} onSelect={() => go(a.href)}>
                  {a.label}
                  {a.shortcut ? <CommandShortcut>{a.shortcut}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {navMatches.length > 0 ? (
            <CommandGroup heading="Go to">
              {navMatches.map((l) => (
                <CommandItem
                  key={l.href}
                  // Include the aliases in cmdk's own value so its internal
                  // filter agrees with ours.
                  value={`${l.label} ${(NAV_ALIASES[l.label] ?? []).join(' ')}`}
                  onSelect={() => go(l.href)}
                >
                  <l.icon className="size-4" aria-hidden />
                  {l.label}
                  {/* Displaying the shortcut is what TEACHES it. Spec §6.5. */}
                  {l.shortcut ? <CommandShortcut>G {l.shortcut.toUpperCase()}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  )
}
```

- [ ] **Step 6: Mount it**

In `src/components/app/app-shell.tsx`, replace `<div className="flex-1" id="topbar-search-slot" />` with:

```tsx
<div className="min-w-0 flex-1"><CommandPalette /></div>
```

and import it.

- [ ] **Step 7: Verify**

1. Cmd/Ctrl+K opens the palette; pressing it again closes it and focus returns to the page. ✅
2. Typing `client` finds Customers. Typing `cafe` finds "Café Lila". Typing `bake` finds Production. ✅
3. Typing `#3` finds order 3. ✅
4. Every navigation entry shows its `G` shortcut next to it. ✅
5. The visible Search button in the topbar opens the same palette on a phone, where there is no keyboard. ✅

- [ ] **Step 8: Commit**

```bash
git add src/lib/aliases.ts src/lib/aliases.test.ts src/components/app/command-palette.tsx src/components/app/app-shell.tsx
git commit -m "feat(speed): command palette with forgiving aliases and shortcut teaching"
```

---

## Task 7.3: Keyboard shortcuts and the help overlay

**Files:**
- Create: `src/components/app/keyboard-shortcuts.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Build it**

Create `src/components/app/keyboard-shortcuts.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NAV_LINKS } from '@/components/app/nav-links'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** Where "N" (new-in-context) goes, per section. */
const NEW_IN_CONTEXT: { prefix: string; href: string }[] = [
  { prefix: '/customers', href: '/customers/new' },
  { prefix: '/orders',    href: '/orders/new' },
  { prefix: '/schedules', href: '/schedules/new' },
  { prefix: '/invoices',  href: '/invoices/new' },
  { prefix: '/products',  href: '/products/new' },
]

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable ||
    el.getAttribute('role') === 'combobox'
  )
}

export function KeyboardShortcuts() {
  const router = useRouter()
  const pathname = usePathname()
  const [helpOpen, setHelpOpen] = useState(false)
  const pendingG = useRef(false)
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never hijack a key while she is typing into something.
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // G then a key.
      if (pendingG.current) {
        pendingG.current = false
        if (gTimer.current) clearTimeout(gTimer.current)
        const link = NAV_LINKS.find((l) => l.shortcut === e.key.toLowerCase())
        if (link) { e.preventDefault(); router.push(link.href) }
        return
      }

      if (e.key.toLowerCase() === 'g') {
        pendingG.current = true
        // A chord that never times out is a trap: press G, wander off,
        // come back, press C, and you teleport.
        gTimer.current = setTimeout(() => { pendingG.current = false }, 1500)
        return
      }

      if (e.key.toLowerCase() === 'n') {
        const target = NEW_IN_CONTEXT.find((t) => pathname.startsWith(t.prefix))
        if (target) { e.preventDefault(); router.push(target.href) }
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        const search = document.querySelector<HTMLElement>('header button')
        search?.click()
        return
      }

      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (gTimer.current) clearTimeout(gTimer.current)
    }
  }, [pathname, router])

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? any time to see this again.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt><kbd className="rounded border px-1.5">⌘K</kbd></dt>
          <dd>Search and commands</dd>
          <dt><kbd className="rounded border px-1.5">/</kbd></dt>
          <dd>Focus search</dd>
          <dt><kbd className="rounded border px-1.5">N</kbd></dt>
          <dd>New, in whatever section you are in</dd>
          <dt><kbd className="rounded border px-1.5">Esc</kbd></dt>
          <dd>Close a panel or dialog</dd>
          {NAV_LINKS.filter((l) => l.shortcut).map((l) => (
            <div key={l.href} className="contents">
              <dt>
                <kbd className="rounded border px-1.5">G</kbd>{' '}
                <kbd className="rounded border px-1.5">{l.shortcut!.toUpperCase()}</kbd>
              </dt>
              <dd>{l.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Mount it** in `src/app/(app)/layout.tsx`, inside `<AppShell>` alongside `{children}`.

- [ ] **Step 3: Verify**

1. `G` then `C` goes to Customers; `G` then `O` to Orders; `G` then `P` to Production. ✅
2. On `/customers`, `N` opens the new-customer form. On `/orders`, it opens the new-order form. ✅
3. `/` opens the palette. `?` opens the help overlay. ✅
4. **Typing `g` into the customer name field does not navigate anywhere.** ✅ This is the bug that makes shortcut systems hated.
5. Press `G`, wait two seconds, press `C` → nothing happens. ✅
6. Escape closes the sheet, the dialog and the palette. ✅

- [ ] **Step 4: Commit**

```bash
git add src/components/app/keyboard-shortcuts.tsx "src/app/(app)/layout.tsx"
git commit -m "feat(speed): G-chord navigation, N-in-context, ? help overlay"
```

---

## Task 7.4: Quick order for mobile

Spec §6.6: two taps from the dashboard, usual items pre-filled, adjust with steppers, save.

**Files:**
- Create: `src/app/(app)/quick-order/page.tsx`
- Create: `src/app/(app)/quick-order/quick-order-client.tsx`
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: The page**

Create `src/app/(app)/quick-order/page.tsx`: a Server Component calling `getOrderFormData()` plus `listCustomerSummaries()` (to rank customers by recency), passing both to `<QuickOrderClient />`.

- [ ] **Step 2: The client**

Create `src/app/(app)/quick-order/quick-order-client.tsx`. Two screens in one component, driven by a `step` state:

- **Step 1 — pick customer.** A search input plus a list of large tap targets (`min-h-16`), **ordered by `last_order_date` descending** so the people she orders for most are at the top. Tapping one calls `fetchCustomerContext(id)` and moves to step 2.
- **Step 2 — adjust and save.** Lines pre-filled from `lastOrderItems` (falling back to an empty list with an "Add product" button). Each line is one row: product name, `<QuantityStepper step={5} />`, line total. A delivery-date chip row (`Tomorrow` / `This Friday` / `Next Tuesday`) with `Tomorrow` selected by default. A sticky bottom bar with the running total and one big `h-14` **Save order** button. A back button returns to step 1 **without losing the lines** if she returns to the same customer.
- **Submit** calls `createOrder` — the same action, so prices are still resolved server-side. On success, toast and `router.push('/orders/' + id)`.
- Reuse `QuantityStepper` and `Money`. Do **not** reuse `OrderForm` — its status field, notes field and product-source badges are exactly the things this flow strips out.

- [ ] **Step 3: Put it two taps from the dashboard**

At the top of `src/app/(app)/page.tsx`, above the Today section, add a mobile-only primary action:

```tsx
<Button asChild size="lg" className="h-14 w-full text-base md:hidden">
  <Link href="/quick-order">Quick order</Link>
</Button>
```

Dashboard → tap → pick customer → adjust → save. Two taps to the form, as specified.

- [ ] **Step 4: Verify at 375px**

1. Dashboard → Quick order → tap a customer → their usual items are already there. ✅
2. Adjust a quantity with `+` and save, **without ever opening the keyboard**. ✅
3. Every target is at least 44px; the Save button is 56px. ✅
4. A customer with no previous order gets an empty list and a working "Add product". ✅

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/quick-order" "src/app/(app)/page.tsx"
git commit -m "feat(mobile): quick-order flow, two taps from the dashboard"
```

---

# Phase 7b — Robustness

## Task 7.5: Per-segment error, loading and not-found boundaries

Phase 0 put sane defaults at the app-group root. This refines them.

**Files:**
- Create: `loading.tsx` in `customers`, `orders`, `invoices`, `products`, `production`, `insights`, `schedules`
- Create: `not-found.tsx` in `customers/[id]`, `orders/[id]`, `invoices/[id]`, `products/[id]`, `schedules/[id]`
- Create: `error.tsx` in `production` and `insights`

- [ ] **Step 1: List-page skeletons**

For each list route, create a `loading.tsx` whose skeleton **matches the real layout** — a title bar, a filter row, then rows. A skeleton that does not match the page it precedes causes exactly the layout shift it exists to prevent. Example for `src/app/(app)/orders/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-11 w-32" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-11 w-64" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  )
}
```

Adapt the widths per route. `/production` and `/insights` get chart-shaped skeletons (`h-[300px]`).

- [ ] **Step 2: Detail not-founds**

Each detail route's `not-found.tsx` names what was not found and links back to its own list. For example `src/app/(app)/invoices/[id]/not-found.tsx`:

```tsx
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 py-16">
      <h1 className="text-xl font-semibold">Invoice not found</h1>
      <p className="text-sm text-muted-foreground">
        That invoice does not exist. It may have been created on another
        device, or the link may be wrong.
      </p>
      <Button asChild className="h-11"><Link href="/invoices">All invoices</Link></Button>
    </div>
  )
}
```

- [ ] **Step 3: Error boundaries where a query can genuinely fail**

`/production` and `/insights` both call RPCs with user-supplied date ranges. Give each an `error.tsx` copying the Phase 0 pattern, with a domain-specific first line: *"The bake list could not be built."* / *"Those figures could not be loaded."* Show `error.digest`, **never** a stack.

- [ ] **Step 4: Verify — no raw stack trace, anywhere**

1. Visit `/customers/00000000-0000-4000-8000-000000000000` → the customers not-found page. ✅
2. Same for orders, invoices, products, schedules. ✅
3. Temporarily break a query (rename a column in `getBakeList`'s select) and load `/production` → the friendly error with a digest, **no stack trace**. Revert. ✅
4. Run `npm run build && npm start` and repeat step 3's check in production mode — Next hides stacks in production, and that is the mode that matters. ✅

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)"
git commit -m "feat(robustness): per-segment skeletons, not-found pages and error boundaries"
```

---

## Task 7.5b: Bulk-clear follow-ups

Spec §6.3 names three bulk actions the app needs: marking follow-ups done, marking orders delivered, and adding orders to an invoice. Phase 3 built the second, Phase 5 the third. This is the first.

**Files:**
- Modify: `src/lib/actions/interactions.ts`
- Modify: `src/components/app/follow-ups-due.tsx`

- [ ] **Step 1: The bulk action**

Append to `src/lib/actions/interactions.ts`:

```ts
export async function setFollowUpsDoneBulk(
  ids: string[],
): Promise<ActionResult & { count?: number }> {
  if (ids.length === 0) return { ok: false, error: 'Nothing selected' }

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('interactions')
    .update({ follow_up_done: true }, { count: 'exact' })
    .in('id', ids)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/customers')
  revalidatePath('/')
  return { ok: true, count: count ?? ids.length }
}
```

- [ ] **Step 2: Selection in the follow-ups list**

In `src/components/app/follow-ups-due.tsx`, add a `selected: Set<string>` state and a `<Checkbox>` at the start of each row. When `selected.size > 0`, render an action bar above the list: `{selected.size} selected` with a **Mark all done** button calling `setFollowUpsDoneBulk([...selected])`.

**Not optimistic** — it touches many objects at once, and spec §6.4 limits optimistic UI to single-object mutations. Keep the existing single-row "Done" button exactly as it is: it stays optimistic, with its Undo toast. Two different affordances with two different safety models, and that is correct.

After success, toast `Cleared {count} follow-ups`, clear the selection, and `router.refresh()`.

- [ ] **Step 3: Verify**

1. With four follow-ups due, tick three → the bar reads "3 selected". ✅
2. "Mark all done" clears exactly those three; the fourth stays. ✅
3. The single-row "Done" button still works and still offers Undo. ✅
4. At 375px the checkboxes are at least 44px of tappable area. ✅

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/interactions.ts src/components/app/follow-ups-due.tsx
git commit -m "feat(speed): bulk-clear follow-ups from the dashboard"
```

---

## Task 7.6: CSV export

**Files:**
- Create: `src/lib/csv.ts`
- Create: `src/lib/csv.test.ts`
- Create: `src/app/api/export/[entity]/route.ts`
- Create: `src/components/app/export-button.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/lib/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toCsv } from '@/lib/csv'

describe('toCsv', () => {
  it('writes a header row from the column definitions', () => {
    const csv = toCsv([{ a: 1 }], [{ key: 'a', header: 'Alpha' }])
    expect(csv.split('\r\n')[0]).toBe('Alpha')
  })

  it('quotes a value containing a comma', () => {
    const csv = toCsv([{ a: 'Manama, Bahrain' }], [{ key: 'a', header: 'City' }])
    expect(csv).toContain('"Manama, Bahrain"')
  })

  it('doubles embedded quotes', () => {
    const csv = toCsv([{ a: 'The "Good" Café' }], [{ key: 'a', header: 'Name' }])
    expect(csv).toContain('"The ""Good"" Café"')
  })

  it('quotes a value containing a newline', () => {
    const csv = toCsv([{ a: 'line1\nline2' }], [{ key: 'a', header: 'Notes' }])
    expect(csv).toContain('"line1\nline2"')
  })

  it('renders null and undefined as an empty field, not "null"', () => {
    const csv = toCsv(
      [{ a: null, b: undefined }],
      [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }],
    )
    expect(csv.split('\r\n')[1]).toBe('')
  })

  it('neutralises a formula-injection payload', () => {
    // A cell starting with = + - or @ is executed by Excel and Sheets on
    // open. A customer named "=cmd|..." must not become a live formula in
    // a file she double-clicks.
    for (const payload of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      const csv = toCsv([{ a: payload }], [{ key: 'a', header: 'A' }])
      expect(csv.split('\r\n')[1]).toBe(`"'${payload}"`)
    }
  })

  it('uses CRLF line endings so Excel does not run the rows together', () => {
    const csv = toCsv([{ a: 1 }, { a: 2 }], [{ key: 'a', header: 'A' }])
    expect(csv).toBe('A\r\n1\r\n2')
  })

  it('returns just the header row for an empty dataset', () => {
    expect(toCsv([], [{ key: 'a', header: 'A' }])).toBe('A')
  })
})
```

- [ ] **Step 2: Run and watch it fail** → `npm test` → FAIL.

- [ ] **Step 3: Write it**

Create `src/lib/csv.ts`:

```ts
export type CsvColumn<T> = {
  key: keyof T & string
  header: string
  /** Optional transform, e.g. a date or a currency code. */
  format?: (value: unknown, row: T) => string
}

const NEEDS_QUOTES = /[",\r\n]/
const FORMULA_START = /^[=+\-@\t\r]/

function escapeCell(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  let value = String(raw)

  // Formula injection: Excel and Google Sheets execute a cell beginning
  // with = + - or @ the moment the file is opened. Prefixing an
  // apostrophe is the standard neutralisation and is invisible in the
  // spreadsheet.
  if (FORMULA_START.test(value)) value = `'${value}`

  if (NEEDS_QUOTES.test(value) || value.startsWith("'")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: CsvColumn<T>[],
): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(',')]

  for (const row of rows) {
    lines.push(
      columns
        .map((c) => escapeCell(c.format ? c.format(row[c.key], row) : row[c.key]))
        .join(','),
    )
  }

  // CRLF: Excel treats a bare LF as a continuation in some locales.
  return lines.join('\r\n')
}
```

- [ ] **Step 4: Run and watch it pass** → `npm test` → PASS, 8 CSV tests.

- [ ] **Step 5: The route handler**

Create `src/app/api/export/[entity]/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toCsv, type CsvColumn } from '@/lib/csv'

const ENTITIES = {
  customers: {
    view: 'v_customer_summary',
    filename: 'customers',
    columns: [
      { key: 'name', header: 'Name' },
      { key: 'status', header: 'Status' },
      { key: 'type', header: 'Type' },
      { key: 'city', header: 'City' },
      { key: 'price_tier', header: 'Price tier' },
      { key: 'order_count', header: 'Orders' },
      { key: 'lifetime_revenue', header: 'Lifetime revenue' },
      { key: 'first_order_date', header: 'First order' },
      { key: 'last_order_date', header: 'Last order' },
      { key: 'days_since_last_order', header: 'Days since last order' },
    ],
  },
  orders: {
    view: 'v_order_list',
    filename: 'orders',
    columns: [
      { key: 'order_number', header: 'Order #' },
      { key: 'customer_name', header: 'Customer' },
      { key: 'ordered_on', header: 'Ordered' },
      { key: 'delivery_date', header: 'Delivery' },
      { key: 'status', header: 'Status' },
      { key: 'total_units', header: 'Units' },
      { key: 'subtotal', header: 'Total' },
      { key: 'total_cost', header: 'Cost' },
      { key: 'gross_margin', header: 'Margin' },
    ],
  },
  invoices: {
    view: 'v_invoice_list',
    filename: 'invoices',
    columns: [
      { key: 'invoice_number', header: 'Invoice #' },
      { key: 'customer_name', header: 'Customer' },
      { key: 'issued_on', header: 'Issued' },
      { key: 'due_on', header: 'Due' },
      { key: 'computed_status', header: 'Status' },
      { key: 'subtotal', header: 'Subtotal' },
      { key: 'delivery_charge', header: 'Delivery charge' },
      { key: 'discount_amount', header: 'Discount' },
      { key: 'total', header: 'Total' },
      { key: 'amount_paid', header: 'Paid' },
      { key: 'balance', header: 'Balance' },
    ],
  },
} as const

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ entity: string }> },
) {
  // Next 16: params is a Promise.
  const { entity } = await params

  const config = ENTITIES[entity as keyof typeof ENTITIES]
  if (!config) return NextResponse.json({ error: 'Unknown export' }, { status: 404 })

  // The proxy already gates this route, but a data-exfiltration endpoint
  // gets its own check. Cheap, and it survives a matcher edit.
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data, error } = await supabase.from(config.view).select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const csv = toCsv(
    (data ?? []) as Record<string, unknown>[],
    config.columns as unknown as CsvColumn<Record<string, unknown>>[],
  )

  const stamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(
    // A BOM, so Excel opens UTF-8 correctly and "Café" is not "CafÃ©".
    `﻿${csv}`,
    {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${config.filename}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    },
  )
}
```

- [ ] **Step 6: The button**

Create `src/components/app/export-button.tsx`: a `<Button asChild variant="outline" className="h-11">` wrapping `<a href={'/api/export/' + entity} download>` with a `<Download />` icon and the label "Export CSV". Add it to the header row of `/customers`, `/orders` and `/invoices`.

- [ ] **Step 7: Verify**

1. Click Export on `/customers` → a file downloads named `customers-2026-08-06.csv`. ✅
2. Open it in Excel → `Café Lila` renders correctly, not `CafÃ© Lila`. ✅
3. Create a customer named `=1+1`, export, open in Excel → the cell shows the literal text, **not `2`**. ✅
4. A customer whose notes contain a comma and a newline exports as one intact field. ✅
5. Sign out and request `/api/export/customers` directly → 401 or a redirect, **never a CSV**. ✅

- [ ] **Step 8: Commit**

```bash
git add src/lib/csv.ts src/lib/csv.test.ts src/app/api/export src/components/app/export-button.tsx
git commit -m "feat(export): CSV export for customers, orders and invoices with formula-injection guard"
```

---

## Task 7.7: Accessibility pass

**Files:** touches many; changes are small and local.

- [ ] **Step 1: Keyboard-navigate every flow with no mouse**

Unplug the mouse. Complete each of these using only Tab, Shift+Tab, Enter, Space, arrows and Escape:

- [ ] Log in
- [ ] Add a customer
- [ ] Log an interaction with a follow-up
- [ ] Add a product and a recipe line
- [ ] Create an order with two lines
- [ ] Create an invoice and record a payment
- [ ] Change the production week and print

Anything unreachable is a bug. Write it down and fix it.

- [ ] **Step 2: Focus visibility**

Every focusable element must show a visible ring. Add to `src/app/globals.css` if any do not:

```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Focus trapping in sheets and dialogs**

- [ ] The `AlertDialog` on void **traps** focus (it is a real modal — correct)
- [ ] The `RecordSheet` does **not** trap focus, because it is `modal={false}` and that is deliberate. Confirm Tab moves from the sheet into the page behind, and that Escape still closes it. Both are correct behaviour for a non-modal panel

- [ ] **Step 4: Every icon-only button has an accessible name**

Run this in the browser console on each page:

```js
[...document.querySelectorAll('button, a')]
  .filter(el => !el.textContent.trim() && !el.getAttribute('aria-label') && !el.querySelector('.sr-only'))
  .map(el => el.outerHTML)
```

Expected: an empty array on every page. Every icon-only control in this plan already carries an `<span className="sr-only">`; this catches anything added since.

- [ ] **Step 5: Contrast**

Run Lighthouse's accessibility audit on `/`, `/customers`, `/orders`, `/production`, `/invoices`, `/insights` — in **both** light and dark mode. Fix every contrast failure. The status-badge tone maps in `status-badge.tsx`, `order-status-badge.tsx` and `invoice-status-badge.tsx` are the likely offenders.

- [ ] **Step 6: Status is never colour alone**

Screenshot each list page and convert to greyscale. Every status must still be readable — each badge carries its label, and `void` also carries a strikethrough. ✅

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(a11y): focus visibility, accessible names, contrast in both themes"
```

---

## Task 7.8: Mobile pass

- [ ] **Step 1: Walk every screen at exactly 375px**

In DevTools at 375×812, visit and scroll each of: `/`, `/customers`, a customer detail (all four tabs), `/customers/new`, `/orders`, `/orders/new`, an order detail, `/schedules`, a schedule detail, `/production`, `/invoices`, `/invoices/new`, an invoice detail, `/products`, a product detail, `/ingredients`, `/insights`, `/settings`, `/quick-order`.

For each: **no horizontal scroll**, no clipped text, no target under 44px.

- [ ] **Step 2: Catch horizontal overflow programmatically**

Run on each page:

```js
document.documentElement.scrollWidth > document.documentElement.clientWidth
```

Expected: `false` everywhere. If `true`, find the culprit with:

```js
[...document.querySelectorAll('*')].filter(el => el.scrollWidth > document.documentElement.clientWidth).slice(0, 5)
```

Wide tables and long charts belong in an `overflow-x-auto` container, not the body.

- [ ] **Step 3: Catch small targets programmatically**

```js
[...document.querySelectorAll('button, a, input, select, [role="checkbox"], [role="radio"]')]
  .filter(el => { const r = el.getBoundingClientRect(); return r.height > 0 && (r.height < 44 || r.width < 24) })
  .map(el => el.outerHTML.slice(0, 120))
```

Expected: empty. Inline text links inside a paragraph are the one acceptable exception — note them and move on.

- [ ] **Step 4: The keyboard per field**

On a real phone or in device emulation, confirm:
- [ ] Quantity fields open the **numeric** keypad
- [ ] Money fields open the **decimal** keypad
- [ ] Phone fields open the **phone** keypad
- [ ] Email fields open the **email** keypad with `@`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(mobile): overflow, target sizes and input modes at 375px"
```

---

## Task 7.9: Phase Exit — acceptance gate

- [ ] `npm run typecheck` → clean, no `any`, no `@ts-ignore`
- [ ] `npm test` → all pass, including 7 alias tests and 8 CSV tests
- [ ] `npm run build` → succeeds
- [ ] `verify.sql` runs clean
- [ ] Cmd/Ctrl+K opens and closes the palette, restoring focus
- [ ] `client` → Customers, `cafe` → Café Lila, `bake` → Production
- [ ] Every palette navigation entry displays its shortcut
- [ ] `G C`, `G O`, `G P` navigate; `N` creates in context; `/` searches; `?` helps
- [ ] Typing a `g` into a text field does **not** navigate
- [ ] Quick order works in two taps from the dashboard with no keyboard
- [ ] All three bulk actions from spec §6.3 exist: follow-ups done (7.5b), orders delivered (Phase 3), orders onto an invoice (Phase 5)
- [ ] No unhandled server error shows a raw stack trace **in a production build**
- [ ] Every list has both empty states, and they are visibly different screens
- [ ] CSV exports open correctly in Excel, with accented characters intact
- [ ] A cell beginning `=` exports neutralised
- [ ] `/api/export/customers` returns 401 when signed out
- [ ] Every flow is completable with no mouse
- [ ] Focus is visible everywhere and correctly trapped in the void dialog
- [ ] Every icon-only button has an accessible name — the console check returns `[]`
- [ ] No horizontal scroll at 375px on any screen — the console check returns `false`
- [ ] Open the PR: `gh pr create --title "Phase 7 — Speed and robustness"`
