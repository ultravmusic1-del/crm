# Oat Bar CRM — Implementation Plan (Index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a two-user CRM for a home bakery that tracks prospects and outreach, holds a product catalogue with per-customer pricing, records one-off and recurring orders, rolls them into weekly bake and shopping lists, issues invoices and tracks payment, and surfaces the customers who are going quiet.

**Architecture:** Next.js 16 App Router on Vercel, talking to Supabase Postgres through `supabase-js` with no ORM. Reads happen in Server Components via `lib/queries/*`; writes happen in Server Actions via `lib/actions/*` and end in `revalidatePath()`. All aggregation is SQL — views and `plpgsql` functions in versioned migrations, called with `.from()` and `.rpc()`. Every table and view is behind RLS. Invoices are a print-styled HTML route, not a PDF library.

**Tech Stack:** Next.js 16.3 · React 19.2 · TypeScript 5.9 · Supabase (Postgres + Auth) · Tailwind 4.3 · shadcn/ui on the **Radix** base · TanStack Table **8.21** · React Hook Form 7 + Zod 4 · Recharts 3 · date-fns 4 · sonner · Vitest 4 · Playwright 1.62

---

## How to read this plan

The source specification is [`docs/crm-build-plan.md`](../../../crm-build-plan.md). **Read it in full before starting.** This plan does not restate it; it turns it into ordered, bite-sized, individually-verifiable tasks and resolves the places where the spec is ambiguous, under-specified, or — in four cases — wrong.

| Phase | File | Ships |
|---|---|---|
| 0 | [`phase-0-foundation.md`](phase-0-foundation.md) | Deployed, authenticated shell + settings + dashboard skeleton |
| 1 | [`phase-1-customers.md`](phase-1-customers.md) | Customers, contacts, outreach log, follow-ups |
| 2 | [`phase-2-products-pricing.md`](phase-2-products-pricing.md) | Products, recipes, ingredients, per-customer pricing |
| 3 | [`phase-3-orders-schedules.md`](phase-3-orders-schedules.md) | Orders, order items, recurring schedules, generation |
| 4 | [`phase-4-production.md`](phase-4-production.md) | Weekly bake list, shopping list, delivery schedule, print |
| 5 | [`phase-5-invoices-payments.md`](phase-5-invoices-payments.md) | Invoices, payments, void, print route |
| 6 | [`phase-6-dashboard-insights.md`](phase-6-dashboard-insights.md) | Dashboard sections, at-risk customers, charts, `/insights` |
| 7 | [`phase-7-speed-robustness.md`](phase-7-speed-robustness.md) | Command palette, shortcuts, quick order, a11y, CSV, mobile pass |
| 8 | [`phase-8-verification.md`](phase-8-verification.md) | Seed data, `verify.sql`, RLS probes, advisors, cold-start walkthrough |

**Do not begin a phase until the previous phase's acceptance criteria pass.** Each phase ends with a `Phase Exit` task that runs the gate.

---

## Decisions taken before writing this plan

Three forks in the spec were resolved with the owner on 2026-08-06.

### 1. Database: remote-first via the Supabase MCP connector

This machine has **no Docker and no `psql`**, so `supabase start` and `psql -f verify.sql` — both assumed by the spec — cannot run. Rather than spend an afternoon on Docker Desktop, the plan uses the Supabase MCP connector, which is what the spec's own Appendix D anticipated.

What this changes:

- Every migration is still authored as a numbered file in `supabase/migrations/` and committed. That file is the source of truth.
- It is applied with the MCP `apply_migration` tool (which writes to Supabase's real migration history), **not** by pasting SQL into the dashboard SQL editor. The §8 rule "never change the schema through the remote dashboard" still holds in full.
- `npm run db:types` is replaced by the MCP `generate_typescript_types` tool writing to `src/lib/database.types.ts`. The npm script stays in `package.json` for whoever installs Docker later.
- `npm run db:verify` is replaced by running `supabase/verify.sql` through MCP `execute_sql`. The file is still a plain `.sql` with `raise exception` assertions, so it runs unchanged under `psql` the day someone has it.

**Consequence you must accept:** there is one database, and it is the production one, until you create a Supabase branch. Phase 8 seeds it and then resets it. Do not seed a database that has real customer data in it.

### 2. Testing: Vitest + Playwright, as an approved deviation from §1

Spec §8 forbids dependencies not listed in §1, and names `verify.sql` + `tsc --noEmit` + `next build` as the whole suite. That guards the SQL arithmetic well and the TypeScript layer not at all — and the TypeScript layer is where price resolution, fortnightly recurrence parity and money rounding live. Those are exactly the bugs that are silent and expensive.

**Three devDependencies are added, deliberately and on the record:**

| Package | Version | Why |
|---|---|---|
| `vitest` | `^4.1` | Unit tests for pure functions: `pickPrice`, `formatMoney`, Zod schemas, recurrence date math, invoice balance |
| `vite-tsconfig-paths` | `^6.1` | So tests can import `@/lib/...` |
| `@playwright/test` | `^1.62` | The Phase 8 cold-start walkthrough, run as a real browser journey instead of by hand |

Note what is **not** added: no jsdom, no Testing Library, no `@vitejs/plugin-react`. Vitest runs in the `node` environment against pure functions only. Component behaviour is covered by Playwright at the journey level. This keeps the addition to three packages and keeps the test suite fast enough that nobody skips it.

### 3. MVP line: all of Phases 0–8

No re-cut. The spec is shipped as written. Phase 6's at-risk-customer list is the feature that turns a filing cabinet into something that tells her to act, and Phase 8 is what makes the numbers trustworthy enough to invoice from. Both stay inside the MVP.

---

## Four corrections to the specification

These are places where following the spec literally produces a broken app. Each is applied in the plan with an inline comment in the migration explaining why, so nobody "fixes" it back.

### C1 — `signup_allowlist` with zero policies locks out the auth hook (breaks all login)

Spec §3 and §4 say the table gets "RLS enabled with ZERO policies" so that "only the auth hook (running as `supabase_auth_admin`) may read it." But `supabase_auth_admin` does **not** have `BYPASSRLS`. RLS enabled with no policies denies that role too, so `hook_restrict_signup` finds no matching row, returns the 403, and **every** sign-in attempt is rejected.

**Fix (Phase 0, migration 0001):** keep RLS on and keep the revoke from `anon`/`authenticated`/`public`, but add the one grant and the one role-scoped policy that Supabase's own auth-hook documentation requires:

```sql
grant select on table public.signup_allowlist to supabase_auth_admin;

create policy "auth admin may read the allowlist"
  on public.signup_allowlist for select
  to supabase_auth_admin using (true);
```

The security property the spec wanted is preserved exactly: `anon` and `authenticated` still cannot read it.

### C2 — The blanket RLS policy causes infinite recursion when applied to `profiles`

Spec §3.9 says apply the policy to **every** table except `signup_allowlist`. Its body is `exists (select 1 from public.profiles where id = auth.uid())`. Applied to `profiles` itself, evaluating the policy requires reading `profiles`, which invokes the policy. Postgres raises `42P17: infinite recursion detected in policy for relation "profiles"`, and because every other table's policy reads `profiles`, **the entire app returns errors on every query.**

**Fix (Phase 0, migration 0001):** `profiles` gets self-referential policies instead:

```sql
create policy "a user sees their own profile"
  on public.profiles for select
  to authenticated using ((select auth.uid()) = id);
```

Every *other* table keeps the spec's blanket policy verbatim. Reading `profiles` from inside those policies works, because the row a user needs is their own.

### C3 — Functions are executable by `anon` by default; the spec only revokes on views

Spec §3 is emphatic about `security_invoker = on` and `revoke ... from anon` on every **view**, and Phase 8 step 6 correctly tests `/rest/v1/rpc/f_bake_list` unauthenticated. But nothing in the spec ever revokes execute on the functions. Postgres grants `EXECUTE` to `PUBLIC` on new functions by default, and PostgREST exposes them as RPC endpoints. `f_bake_list` is `security invoker`, so RLS *would* still return zero rows — but `f_create_invoice` and `f_void_invoice` are **writes**, and `f_generate_scheduled_orders` is a write. An unauthenticated caller reaching those is not acceptable even if RLS blunts it.

**Fix:** every migration that creates a function ends with an explicit revoke/grant pair:

```sql
revoke execute on function public.f_name(...) from public, anon;
grant  execute on function public.f_name(...) to authenticated;
```

### C4 — The `auth.users` trigger genuinely needs `security definer`

Spec §3 says "Every function is `security invoker` (the default) — do **not** mark any of these `security definer`." That rule is correct for the *reporting* functions it is written about. It is wrong for the `on auth.users insert` trigger the spec also asks for in Phase 0 step 6: that trigger fires inside the GoTrue service's transaction, under a role with no write access to `public.profiles`. As invoker it fails and user creation rolls back.

**Fix:** `public.f_handle_new_user()` is `security definer set search_path = ''`. It is the **only** `security definer` object in the codebase, it takes no user input, and it writes exactly one row. Every other function stays invoker.

---

## Three places the plan departs from §5's file listing

Small, deliberate, and each resolves a contradiction inside the spec itself.

- **Migration numbers are sequential, not phase-indexed.** Phase 3 needs two migrations (the tables, then the generation function, so a failure in one does not roll back the other), which shifts every later number by one. Phase 4 is `0006`, Phase 5 is `0007`, Phase 6 is `0008`.
- **`customers/[id]/edit/page.tsx` is not built.** §5 lists it, but §6.1 mandates a right-hand sheet for editing a record so the list behind stays visible, and gives full pages only to multi-section creation. The sheet wins; there is no edit route. Order editing is the one exception — it *is* multi-section, so it gets a sheet holding the full `OrderForm` rather than a stripped one (Phase 3 Task 3.8).
- **`quick-add-sheet.tsx` becomes `/quick-order`.** §5 names a sheet; §6.6 describes a two-tap flow with its own customer-picking step. A two-step flow is a route, not a sheet — a sheet that replaces its own contents is just a page with worse browser history.

## ⚠️ Correction that applies to EVERY remaining phase: never format a date with date-fns `format()`

Several code samples in these plan files render dates with `format(parseISO(x), '…')`. **For a `timestamptz` column that is a bug** and it was caught during the Phase 1 build.

`parseISO` on a string carrying an offset produces a correct instant; `date-fns format()` then renders it **in the host's local timezone**. Vercel runs UTC and the bakery is UTC+3, so a 22:30 Bahrain timestamp renders as the *previous day* on the server, and a client component's SSR pass renders differently from its hydrated pass.

**The rule:**

| Column type | Example | How to render |
|---|---|---|
| `timestamptz` (an instant) | `occurred_at`, `created_at` | `formatDateTime()` / `formatDate()` from `lib/format.ts`, or `Intl.DateTimeFormat` with an explicit `timeZone: BUSINESS_TIME_ZONE` |
| `date` (a calendar day) | `follow_up_on`, `delivery_date`, `issued_on` | `formatDate()` from `lib/format.ts` — it detects a plain `YYYY-MM-DD` and renders it identically in every timezone, with no conversion |

`lib/format.ts` already handles both correctly, and `formatDateTime()` deliberately **refuses** a plain date — a date column has no time of day and inventing midnight for it is a lie.

Uses of `format(parseISO(…))` on a plain `date` (the chart month labels in Phase 6, for instance) are self-consistent and not wrong, but prefer `formatDate()` anyway so there is one way to do this.

`parseISO` on its own is fine — it is only the `format()` that reads the ambient clock.

## Two smaller notes carried into the plan

- **`react-day-picker` is at 10.0.1.** Spec §2 warns that generated Calendar `classNames` maps drift from the installed react-day-picker. v10 is recent enough that the spec's own list of "current keys" may already be stale. Phase 1 Task 1.2 makes this an explicit check against the installed package's own types rather than against either document.
- **`@supabase/ssr` `setAll` arity.** Spec §2 states `setAll(cookiesToSet, headers)` takes two arguments in 0.12.x. Phase 0 Task 0.6 verifies this against the installed `.d.ts` before the proxy is written, and says what to do if it is one argument. Do not guess — a wrong `setAll` produces random logouts that look like anything but a cookie bug.

---

## Conventions used by every task in this plan

**Verification-first.** Every task states its check before its implementation, runs the check to watch it fail, implements, and runs it again. For pure functions that is a Vitest test. For SQL that is an assertion appended to `supabase/verify.sql`. For UI it is a named, unambiguous manual check with the exact URL and the exact expected result.

**Reference patterns, defined once.** Four UI patterns recur across dozens of screens: the URL-state data table, the Field+Controller form, the edit sheet, and the two empty states. Each is written out in full, as complete working code, exactly once — in Phase 1 Tasks 1.4, 1.6, 1.9 and 1.5. Later tasks that use a pattern name the pattern file and give their complete delta (exact columns, exact fields, exact Zod schema, exact action). This is DRY applied to the plan itself; it is not a placeholder. If a later task's delta is not enough to build the screen without guessing, that is a bug in this plan — say so.

**Commit granularity.** One commit per task, message given verbatim. One branch per phase (`phase-0-foundation`, `phase-1-customers`, …), one PR per phase.

**Before any task claims done:** `npm run typecheck` and `npm run test` pass. No `any`, no `@ts-ignore`, no `toFixed` on money outside `src/lib/format.ts`.

---

## Repository file structure

Created across the phases. Ownership of each file is listed so tasks do not collide.

```
crm/
├── CLAUDE.md                          # Phase 0 T0.14 — constraints that survive compaction
├── proxy.ts                           # Phase 0 T0.6 — root; exports `proxy`
├── vitest.config.ts                   # Phase 0 T0.3
├── playwright.config.ts               # Phase 8 T8.9
├── docs/
│   ├── crm-build-plan.md              # the spec (already present)
│   └── superpowers/plans/…            # this plan
├── e2e/
│   └── cold-start.spec.ts             # Phase 8 T8.9
├── supabase/
│   ├── migrations/                    # sequential, NOT phase-indexed
│   │   ├── 0001_foundation.sql        # Phase 0 T0.4
│   │   ├── 0002_customers.sql         # Phase 1 T1.1
│   │   ├── 0003_products.sql          # Phase 2 T2.1
│   │   ├── 0004_orders.sql            # Phase 3 T3.1
│   │   ├── 0005_generate_orders.sql   # Phase 3 T3.2
│   │   ├── 0006_production.sql        # Phase 4 T4.1
│   │   ├── 0007_invoices.sql          # Phase 5 T5.1
│   │   └── 0008_insights.sql          # Phase 6 T6.1
│   ├── seed.sql                       # Phase 8 T8.1
│   └── verify.sql                     # grown by every phase; gated Phase 8 T8.2
└── src/
    ├── app/
    │   ├── layout.tsx · globals.css                       # P0
    │   ├── (auth)/login/page.tsx                          # P0
    │   ├── (auth)/auth/callback/route.ts                  # P0
    │   └── (app)/
    │       ├── layout.tsx · page.tsx                      # P0 shell, P1/P3/P6 sections
    │       ├── error.tsx · not-found.tsx · loading.tsx    # P0, refined P7
    │       ├── customers/…                                # P1 (+ P2 pricing tab, P3 orders tab)
    │       ├── products/… · ingredients/…                 # P2
    │       ├── orders/… · schedules/…                     # P3
    │       ├── production/page.tsx                        # P4
    │       ├── invoices/…                                 # P5
    │       ├── insights/page.tsx                          # P6
    │       └── settings/page.tsx                          # P0
    ├── components/
    │   ├── ui/                        # shadcn output — never hand-edit past theme tokens
    │   └── app/
    │       ├── settings-provider.tsx · money.tsx          # P0
    │       ├── date-display.tsx · status-badge.tsx        # P0
    │       ├── empty-state.tsx · app-shell.tsx            # P0
    │       ├── data-table/                                # P1 — the reference table
    │       ├── customer-form.tsx · interaction-form.tsx   # P1
    │       ├── product-form.tsx · recipe-editor.tsx       # P2
    │       ├── order-form.tsx · quantity-stepper.tsx      # P3
    │       ├── invoice-builder.tsx · payment-form.tsx     # P5
    │       └── command-palette.tsx · quick-add-sheet.tsx  # P7
    └── lib/
        ├── supabase/{client,server,proxy}.ts              # P0
        ├── format.ts · format.test.ts                     # P0
        ├── database.types.ts                              # generated — never hand-edit
        ├── recurrence.ts · recurrence.test.ts             # P3
        ├── schemas/                                       # one file per domain
        ├── queries/                                       # typed reads for Server Components
        └── actions/                                       # 'use server', one file per domain
```

---

## Verified dependency versions

Resolved from the npm registry on 2026-08-06. The two deliberate pins were confirmed to be genuinely load-bearing: `typescript` latest is **7.0.2** and `@tanstack/react-table` latest is **9.0.0**, so both would have been silently upgraded by a plain `npm install`.

```
next 16.3.0 · react 19.2.8 · react-dom 19.2.8 · eslint-config-next 16.3.0
typescript 5.9.3            ← PINNED (latest is 7.0.2)
@tanstack/react-table 8.21.3 ← PINNED (latest is 9.0.0, breaks shadcn's guide)
@supabase/supabase-js 2.112.1 · @supabase/ssr 0.12.4 · supabase 2.111.0
tailwindcss 4.3.3 · @tailwindcss/postcss 4.3.3 · shadcn 4.16.1
zod 4.4.3 · react-hook-form 7.84.0 · @hookform/resolvers 5.7.1
recharts 3.10.1 · date-fns 4.4.0 · sonner 2.0.7 · cmdk 1.1.1 · next-themes 0.4.6
react-day-picker 10.0.1     ← check classNames keys against this, not against docs
vitest 4.1.10 · vite-tsconfig-paths 6.1.1 · @playwright/test 1.62.1
```
