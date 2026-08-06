# Phase 0 — Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, authenticated Next.js shell backed by a Supabase project, with settings, currency formatting, error boundaries and an empty dashboard — ready for Phase 1 to add its first table without touching any infrastructure.

**Architecture:** Next.js 16 App Router with two route groups: `(auth)` for login, `(app)` for everything behind the session. A root `proxy.ts` refreshes the Supabase session and redirects unauthenticated traffic. Settings are read once per request in the `(app)` layout and pushed into a client context so `<Money />` works inside client-rendered tables.

**Tech Stack:** Next.js 16.3 · React 19.2 · TypeScript 5.9 · Tailwind 4.3 · shadcn/ui (Radix base) · `@supabase/ssr` 0.12 · Zod 4 · React Hook Form 7 · Vitest 4

---

## Prerequisites

- Node 24.13.1 (verified present; spec requires ≥ 20.9)
- A GitHub account and a Supabase account
- The Supabase MCP connector authorised in this session
- Working directory: `C:\Users\Vivaan\crm` (currently empty)

**Branch:** `git checkout -b phase-0-foundation` after Task 0.1 initialises the repo.

---

## Task 0.1: Scaffold the Next.js app and initialise git

**Files:**
- Create: the whole project tree via `create-next-app`
- Create: `.gitignore` (generated, then extended)

- [ ] **Step 1: Scaffold**

Run from `C:\Users\Vivaan`:

```bash
npx create-next-app@16.3.0 crm --typescript --app --tailwind --src-dir --import-alias "@/*" --eslint --turbopack --no-install
```

`crm/` already exists and is empty; `create-next-app` will populate it. `--no-install` is deliberate — Task 0.2 installs with exact pins so nothing resolves to a newer major.

- [ ] **Step 2: Verify the scaffold used the versions we expect**

Run: `node -e "const p=require('./package.json');console.log(p.dependencies.next,p.dependencies.react,p.devDependencies.typescript)"`

Expected: `next` is `16.3.0`. If `typescript` reads `^7` or `7.x`, that is the trap from spec §1 — Task 0.2 overwrites it.

- [ ] **Step 3: Initialise git and commit the untouched scaffold**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js 16.3 app router project"
git checkout -b phase-0-foundation
```

Committing the scaffold on its own means every later diff is *your* code, not framework noise.

---

## Task 0.2: Install pinned dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime dependencies at the pinned versions**

```bash
npm install next@16.3.0 react@19.2.8 react-dom@19.2.8 @supabase/supabase-js@^2.112.1 @supabase/ssr@^0.12.4 tailwindcss@^4.3.3 zod@^4.4.3 react-hook-form@^7.84.0 @hookform/resolvers@^5.7.1 @tanstack/react-table@8.21.3 recharts@^3.10.1 date-fns@^4.4.0 sonner@^2.0.7 cmdk@^1.1.1 next-themes@^0.4.6
```

`@tanstack/react-table@8.21.3` is written **without a caret**. A caret would still hold it inside v8, but an exact pin makes the intent unmissable to the next person, and v9.0.0 shipped two days ago.

- [ ] **Step 2: Install dev dependencies, forcing TypeScript back to 5**

```bash
npm install -D typescript@5.9.3 supabase@^2.111.0 vitest@^4.1.10 vite-tsconfig-paths@^6.1.1 @playwright/test@^1.62.1
```

`typescript@5.9.3` is exact for the same reason: `npm install typescript` today gives you 7.0.2.

- [ ] **Step 3: Verify no majors drifted**

Run:

```bash
npm ls typescript @tanstack/react-table next react zod --depth=0
```

Expected output contains `typescript@5.9.3`, `@tanstack/react-table@8.21.3`, `next@16.3.0`, `react@19.2.8`, `zod@4.4.3`. **If TypeScript reads 7.x, stop and fix it — the whole codebase will typecheck differently.**

- [ ] **Step 4: Install the Playwright browser**

```bash
npx playwright install chromium
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: pin dependencies; TS 5.9 and TanStack Table 8 held back deliberately"
```

---

## Task 0.3: Wire up scripts, Vitest, and the first passing test

This task exists before any app code so that from here on, *every* task has somewhere to put a test.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/format.ts`
- Create: `src/lib/format.test.ts`

- [ ] **Step 1: Write the scripts block**

Replace the `scripts` key in `package.json` with:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:new": "supabase migration new",
    "db:reset": "supabase db reset",
    "db:diff": "supabase db diff -f",
    "db:push": "supabase db push",
    "db:types": "supabase gen types typescript --local > src/lib/database.types.ts",
    "db:verify": "psql \"$LOCAL_DB_URL\" -v ON_ERROR_STOP=1 -f supabase/verify.sql"
  }
}
```

The `db:*` scripts that need Docker or psql are kept verbatim from spec Appendix B even though they cannot run on this machine. They are correct, and they become live the moment someone installs Docker. Tasks in this plan use the MCP equivalents instead and say so.

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Pure functions only. No jsdom, no Testing Library — component
    // behaviour is covered by Playwright at the journey level (Phase 8).
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Write the failing test**

Create `src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatMoney, type CurrencyFormat } from '@/lib/format'

const BHD: CurrencyFormat = {
  currency_symbol: 'BD',
  currency_decimals: 3,
}

const GBP: CurrencyFormat = {
  currency_symbol: '£',
  currency_decimals: 2,
}

describe('formatMoney', () => {
  it('renders BHD to three decimal places', () => {
    expect(formatMoney(1.5, BHD)).toBe('BD 1.500')
  })

  it('renders a two-decimal currency to two places', () => {
    expect(formatMoney(1.5, GBP)).toBe('£ 1.50')
  })

  it('accepts the numeric strings supabase-js returns for numeric columns', () => {
    // supabase-js returns numeric(12,3) as a string to avoid float loss.
    expect(formatMoney('12.250', BHD)).toBe('BD 12.250')
  })

  it('groups thousands', () => {
    expect(formatMoney(12345.6, BHD)).toBe('BD 12,345.600')
  })

  it('places the minus sign before the symbol, not after it', () => {
    expect(formatMoney(-1.5, BHD)).toBe('-BD 1.500')
  })

  it('renders zero rather than an em dash', () => {
    expect(formatMoney(0, BHD)).toBe('BD 0.000')
  })

  it('renders an em dash for null and undefined', () => {
    expect(formatMoney(null, BHD)).toBe('—')
    expect(formatMoney(undefined, BHD)).toBe('—')
  })

  it('renders an em dash rather than NaN for unparseable input', () => {
    expect(formatMoney('not a number', BHD)).toBe('—')
  })
})
```

The null/zero distinction matters: "no invoice yet" and "an invoice for nothing" must not look the same on the dashboard.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "@/lib/format"`.

- [ ] **Step 5: Write the implementation**

Create `src/lib/format.ts`:

```ts
import { format, isValid, parseISO } from 'date-fns'

/**
 * The only place in this codebase allowed to turn a number into a money
 * string. Spec §8 step 4 greps for violations — keep it that way.
 */
export type CurrencyFormat = {
  currency_symbol: string
  currency_decimals: number
}

export function formatMoney(
  value: number | string | null | undefined,
  fmt: CurrencyFormat,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'

  const body = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: fmt.currency_decimals,
    maximumFractionDigits: fmt.currency_decimals,
  }).format(Math.abs(n))

  return `${n < 0 ? '-' : ''}${fmt.currency_symbol} ${body}`
}

/** Accepts a `date` or `timestamptz` string from Postgres, or a Date. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? parseISO(value) : value
  return isValid(d) ? format(d, 'd MMM yyyy') : '—'
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? parseISO(value) : value
  return isValid(d) ? format(d, 'd MMM yyyy, HH:mm') : '—'
}

export function formatDateRange(
  from: string | Date,
  to: string | Date,
): string {
  const a = typeof from === 'string' ? parseISO(from) : from
  const b = typeof to === 'string' ? parseISO(to) : to
  if (!isValid(a) || !isValid(b)) return '—'
  const sameYear = a.getFullYear() === b.getFullYear()
  const sameMonth = sameYear && a.getMonth() === b.getMonth()
  if (sameMonth) return `${format(a, 'd')}–${format(b, 'd MMM yyyy')}`
  if (sameYear) return `${format(a, 'd MMM')} – ${format(b, 'd MMM yyyy')}`
  return `${format(a, 'd MMM yyyy')} – ${format(b, 'd MMM yyyy')}`
}

/**
 * Store phone numbers as typed, minus decorative whitespace. Spec §6.2:
 * never reject a phone number for its format.
 */
export function normalisePhone(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json vitest.config.ts src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: money and date formatting with unit tests; add vitest"
```

---

## Task 0.4: Create the Supabase project and apply migration 0001

**Files:**
- Create: `supabase/migrations/0001_foundation.sql`
- Create: `supabase/.gitignore`

- [ ] **Step 1: Create the project via MCP**

Load the tools:

`ToolSearch` with query `select:mcp__2afd9097-28a2-4f7c-a799-f224f0122f0e__list_organizations,mcp__2afd9097-28a2-4f7c-a799-f224f0122f0e__create_project,mcp__2afd9097-28a2-4f7c-a799-f224f0122f0e__get_project,mcp__2afd9097-28a2-4f7c-a799-f224f0122f0e__apply_migration,mcp__2afd9097-28a2-4f7c-a799-f224f0122f0e__execute_sql,mcp__2afd9097-28a2-4f7c-a799-f224f0122f0e__generate_typescript_types,mcp__2afd9097-28a2-4f7c-a799-f224f0122f0e__get_project_url,mcp__2afd9097-28a2-4f7c-a799-f224f0122f0e__get_publishable_keys,mcp__2afd9097-28a2-4f7c-a799-f224f0122f0e__get_advisors`

Then `list_organizations`, and `create_project` with name `oat-bar-crm` in the region nearest Bahrain. **Show the user the cost confirmation before creating anything.** Poll `get_project` until status is `ACTIVE_HEALTHY`.

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/0001_foundation.sql`:

```sql
-- 0001_foundation.sql
-- Shared infrastructure, settings, profiles, and the invite-only signup gate.
-- Order matters: app_settings must exist before f_today() will compile.

create extension if not exists pgcrypto with schema extensions;

-- ────────────────────────────────────────────────────────────────────────
-- Shared updated_at trigger. Used by nearly every table.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.f_set_updated_at() from public, anon;

-- ────────────────────────────────────────────────────────────────────────
-- app_settings — exactly one row, id fixed to 1.
-- ────────────────────────────────────────────────────────────────────────
create table public.app_settings (
  id                          int  primary key check (id = 1),
  business_name               text not null default 'Bakery',
  business_email              text,
  business_phone              text,
  address_line1               text,
  address_line2               text,
  city                        text,
  postcode                    text,
  country                     text,
  timezone                    text not null default 'Asia/Bahrain',
  currency_code               text not null default 'BHD',
  currency_symbol             text not null default 'BD',
  currency_decimals           int  not null default 3
                                   check (currency_decimals between 0 and 3),
  default_payment_terms_days  int  not null default 14
                                   check (default_payment_terms_days >= 0),
  invoice_prefix              text not null default 'INV-',
  next_invoice_number         int  not null default 1
                                   check (next_invoice_number >= 1),
  lapse_threshold_days        int  not null default 45
                                   check (lapse_threshold_days > 0),
  bank_name                   text,
  bank_account_name           text,
  bank_account_number         text,
  bank_iban                   text,
  bank_swift                  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

insert into public.app_settings (id) values (1);

create trigger trg_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.f_set_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- f_today() — the ONLY correct "today" in this database.
-- The server runs in UTC; the bakery is UTC+3. current_date is wrong for
-- three hours of every day, which silently drops or duplicates a day's
-- orders on the bake list. Never use current_date anywhere.
--
-- Failure mode, documented on purpose: if app_settings is unreadable this
-- returns null, and every not-null column defaulting to it raises. That is
-- loud, which is what we want — a silently wrong date is far worse.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.f_today()
returns date
language sql
stable
as $$
  select (now() at time zone (select timezone from public.app_settings where id = 1))::date;
$$;

revoke execute on function public.f_today() from public, anon;
grant  execute on function public.f_today() to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- profiles — one row per auth user. Existence of a row IS authorisation
-- (see the RLS policy below and on every later table).
-- ────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.f_set_updated_at();

-- CORRECTION C4 to spec §3 ("do not mark any of these security definer").
-- That rule is right for the reporting functions it was written about and
-- wrong here. This trigger fires inside GoTrue's transaction under a role
-- with no write access to public.profiles; as invoker it fails and user
-- creation rolls back. This is the ONLY security definer object in the
-- codebase. It takes no user-controlled input and writes exactly one row.
create or replace function public.f_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.f_handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.f_handle_new_user();

-- ────────────────────────────────────────────────────────────────────────
-- signup_allowlist — the second of the three auth layers in spec §4.
--
-- CORRECTION C1 to spec §3/§4 ("RLS enabled with ZERO policies").
-- supabase_auth_admin does NOT have BYPASSRLS. With RLS on and no policy,
-- the hook below reads nothing, returns its 403, and EVERY login fails.
-- The grant + role-scoped policy below are what Supabase's own auth-hook
-- documentation requires. anon and authenticated still get nothing, which
-- is the property the spec actually wanted.
-- ────────────────────────────────────────────────────────────────────────
create table public.signup_allowlist (
  email text primary key
);

alter table public.signup_allowlist enable row level security;

revoke all on table public.signup_allowlist from anon, authenticated, public;
grant select on table public.signup_allowlist to supabase_auth_admin;

create policy "auth admin may read the allowlist"
  on public.signup_allowlist
  for select
  to supabase_auth_admin
  using (true);

create or replace function public.hook_restrict_signup(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_email text;
begin
  v_email := lower(event -> 'user' ->> 'email');

  if exists (
    select 1 from public.signup_allowlist where lower(email) = v_email
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message',   'This application is invite-only.',
      'http_code', 403
    )
  );
end;
$$;

grant  execute on function public.hook_restrict_signup(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup(jsonb) from authenticated, anon, public;

-- ────────────────────────────────────────────────────────────────────────
-- RLS: profiles
--
-- CORRECTION C2 to spec §3.9 ("apply to every table").
-- The blanket policy's body reads public.profiles. Applied TO profiles it
-- raises 42P17 infinite recursion, and because every other table's policy
-- reads profiles, the entire app then errors on every query. profiles gets
-- self-referential policies instead. Every OTHER table uses the blanket
-- policy verbatim, and reading profiles from inside it works because the
-- row a user needs is their own.
-- ────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy "a user sees their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "a user may update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ────────────────────────────────────────────────────────────────────────
-- RLS: app_settings — the blanket policy from spec §3.9.
-- The outer (select ...) wrappers make these initPlans, evaluated once per
-- query rather than once per row.
-- ────────────────────────────────────────────────────────────────────────
alter table public.app_settings enable row level security;

create policy "app users have full access"
  on public.app_settings
  for all
  to authenticated
  using      ((select exists (select 1 from public.profiles where id = (select auth.uid()))))
  with check ((select exists (select 1 from public.profiles where id = (select auth.uid()))));
```

- [ ] **Step 3: Show the SQL to the user, then apply it**

Spec Appendix D requires showing each migration before applying. Then call MCP `apply_migration` with `name: "0001_foundation"` and this exact SQL.

- [ ] **Step 4: Verify the two corrections actually took**

This is the whole point of writing them down. Run via MCP `execute_sql`:

```sql
-- C1: the auth admin can read the allowlist, anon cannot.
select
  has_table_privilege('supabase_auth_admin', 'public.signup_allowlist', 'SELECT') as admin_can_select,
  has_table_privilege('anon',                'public.signup_allowlist', 'SELECT') as anon_can_select,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'signup_allowlist')              as policy_count;
```

Expected: `admin_can_select = true`, `anon_can_select = false`, `policy_count = 1`.

```sql
-- C2: reading profiles under RLS does not recurse.
set local role authenticated;
select count(*) from public.profiles;
reset role;
```

Expected: returns `0` without error. **If you see `42P17 infinite recursion detected in policy for relation "profiles"`, correction C2 was not applied — go back and fix it before writing a single line of app code.**

- [ ] **Step 5: Confirm f_today is timezone-correct**

```sql
select public.f_today() as bahrain_today, current_date as utc_today, now() as utc_now;
```

Expected: `bahrain_today` equals `utc_today` for 21 hours a day and is one day ahead between 21:00 and 24:00 UTC. Either way it must not be null.

- [ ] **Step 6: Add `supabase/.gitignore`**

Create `supabase/.gitignore`:

```
.branches
.temp
.env
```

- [ ] **Step 7: Commit**

```bash
git add supabase/
git commit -m "feat(db): migration 0001 — settings, profiles, signup gate, RLS

Corrects two spec bugs that would have broken the app outright:
- signup_allowlist needed a supabase_auth_admin grant + policy, or every
  login is rejected (it has no BYPASSRLS).
- the blanket RLS policy recurses when applied to profiles itself (42P17)."
```

---

## Task 0.5: Configure auth, environment variables, and generated types

**Files:**
- Create: `.env.local`
- Modify: `.gitignore`
- Create: `src/lib/database.types.ts` (generated)

- [ ] **Step 1: Lock down signups in the dashboard**

Spec §4 layer 1. In the Supabase dashboard:
- Authentication → Sign In / Providers → **turn off "Allow new users to sign up"**
- Authentication → Sessions → raise the JWT expiry so she is not logged out mid-week
- Authentication → Hooks → register `public.hook_restrict_signup` as the **Before User Created** hook

These are project settings, not schema. The §8 rule about never using the dashboard is about schema — this is the correct place for these.

- [ ] **Step 2: Seed the allowlist and create the two users**

Via MCP `execute_sql`:

```sql
insert into public.signup_allowlist (email) values
  ('vivaankavalani11@gmail.com')
on conflict (email) do nothing;
```

Add the owner's email as a second row once you have it. Then create both users by hand in Authentication → Users → Add user, with "Auto Confirm User" ticked.

- [ ] **Step 3: Verify the profile trigger fired**

```sql
select u.email, p.id is not null as has_profile
from auth.users u
left join public.profiles p on p.id = u.id;
```

Expected: `has_profile = true` for every row. **If false, `f_handle_new_user` is not `security definer` — see correction C4.**

- [ ] **Step 4: Write `.env.local`**

Get the values from MCP `get_project_url` and `get_publishable_keys`. Create `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

**Do not add `SUPABASE_SECRET_KEY` yet.** Nothing in this plan needs it. Add it only when an admin script does, and never with a `NEXT_PUBLIC_` prefix — one bad import puts it in the browser bundle.

- [ ] **Step 5: Confirm `.env.local` is ignored**

Run: `git check-ignore -v .env.local`
Expected: a line naming `.gitignore`. If nothing prints, add `.env*.local` to `.gitignore` immediately.

- [ ] **Step 6: Generate types**

Call MCP `generate_typescript_types` and write the result verbatim to `src/lib/database.types.ts`. Add this as the first line:

```ts
// GENERATED FILE — do not hand-edit. Regenerate after every migration.
```

- [ ] **Step 7: Verify the types compile and contain what they should**

Run: `npm run typecheck`
Expected: clean.

Run: `node -e "const s=require('fs').readFileSync('src/lib/database.types.ts','utf8');for(const t of ['app_settings','profiles','signup_allowlist'])if(!s.includes(t))throw new Error('missing '+t);console.log('ok')"`
Expected: `ok`

- [ ] **Step 8: Commit**

```bash
git add src/lib/database.types.ts .gitignore
git commit -m "feat(db): generated database types for migration 0001"
```

---

## Task 0.6: Supabase clients and the session proxy

The single most bug-prone file in the project. Spec §2 is emphatic; follow it exactly.

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/proxy.ts`
- Create: `proxy.ts` (repository root)

- [ ] **Step 1: Verify the `setAll` signature against the installed package**

Spec §2 states `setAll(cookiesToSet, headers)` takes two arguments in `@supabase/ssr` 0.12.x. **Verify rather than trust** — a wrong `setAll` produces intermittent logouts that look like anything but a cookie bug.

Run:

```bash
grep -rn "setAll" node_modules/@supabase/ssr/dist/main/types.d.ts
```

Expected: a signature for `setAll`. Read it and note the arity.
- **If it takes two arguments,** write the proxy exactly as in Step 4 below.
- **If it takes one,** delete the `headers` parameter and the `headers?.forEach` block from Step 4 and leave everything else unchanged.

Record which you found in the commit message.

- [ ] **Step 2: Browser client**

Create `src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'

/**
 * Spec §2: never hoist this into a module-level global. A new client per
 * call. The cost is negligible; the bugs from a shared one are not.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
```

- [ ] **Step 3: Server client**

Create `src/lib/supabase/server.ts`:

```ts
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'

/** One client per request. Next 16: cookies() is async and must be awaited. */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Thrown when called during a Server Component render, where
            // cookies are read-only. Safe to swallow: the proxy has already
            // refreshed the session for this request.
          }
        },
      },
    },
  )
}
```

- [ ] **Step 4: The session refresher**

Create `src/lib/supabase/proxy.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/database.types'

/** Everything else in the app requires a session. */
const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/confirm']

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          supabaseResponse = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options)
          }
          // @supabase/ssr 0.12 hands back response headers to forward.
          // Drop this block if Task 0.6 Step 1 found a one-argument setAll.
          headers?.forEach((value, key) => {
            supabaseResponse.headers.append(key, value)
          })
        },
      },
    },
  )

  // ══════════════════════════════════════════════════════════════════════
  // NO CODE BETWEEN createServerClient AND getClaims. Spec §2 documents
  // this specifically; anything inserted here causes random logouts that
  // are very hard to trace back to this file.
  // ══════════════════════════════════════════════════════════════════════
  const { data } = await supabase.auth.getClaims()
  // ══════════════════════════════════════════════════════════════════════

  const claims = data?.claims
  const { pathname } = request.nextUrl

  if (!claims && !isPublic(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (claims && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Must be the response the client built, cookies and all.
  return supabaseResponse
}
```

`getClaims()` and not `getUser()`: it verifies the JWT signature locally against a cached JWKS endpoint, so this runs on every request with no network round-trip. `getSession()` is never acceptable here — its user object comes from storage unverified.

- [ ] **Step 5: Root proxy**

Create `proxy.ts` at the repository root — **not** `src/`, **not** `middleware.ts`:

```ts
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

/**
 * Next 16 renamed middleware.ts to proxy.ts and the export to `proxy`.
 * middleware.ts still works but is deprecated — do not rename this back.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: clean.

Run: `npm run dev`, then visit `http://localhost:3000/settings`.
Expected: redirected to `http://localhost:3000/login?next=%2Fsettings`. (The login page does not exist yet — a 404 *at `/login`* is the correct result here. What matters is that the redirect happened.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase proxy.ts
git commit -m "feat(auth): supabase clients and session proxy

setAll verified as N-argument against the installed @supabase/ssr .d.ts."
```

*(Replace N with what Step 1 actually found.)*

---

## Task 0.7: Initialise shadcn/ui on the Radix base

**Files:**
- Create: `components.json`
- Create: `src/components/ui/*`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Init with the Radix base**

```bash
npx shadcn@4.16.1 init -b radix
```

Choose the default (neutral) base colour and CSS variables.

- [ ] **Step 2: Verify the base is recorded — do this before adding any component**

Run: `node -e "const c=require('./components.json');console.log(JSON.stringify(c,null,2))"`

Expected: the config records the **radix** base. **If it does not, stop.** Every `shadcn add` from here pulls Base UI components into a Radix project — they typecheck and render nothing, which is the worst possible failure mode. Delete `components.json` and re-run with `-b radix`.

- [ ] **Step 3: Add the components Phase 0 needs**

```bash
npx shadcn@4.16.1 add button input label card sheet dropdown-menu separator sonner skeleton badge field select textarea switch tabs avatar
```

Every future `shadcn add` in this project must also be run without changing the base. The base lives in `components.json` — do not pass `-b` again, and do not let a tool add it.

- [ ] **Step 4: Verify sonner, not the Base-UI toast, was installed**

Run: `ls src/components/ui/ | grep -iE "sonner|toast"`
Expected: `sonner.tsx` and **no** `toast.tsx`. Under the Radix base, `sonner` is the correct toast; the first-party `toast` component is Base-UI-only.

- [ ] **Step 5: Set the accent colour**

In `src/app/globals.css`, set `--primary` (and its dark-mode counterpart) to the bakery's brand colour. One accent, as spec §6.7 requires. Leave `--chart-1` … `--chart-5` at their defaults — Phase 6 uses them.

- [ ] **Step 6: Verify**

Run: `npm run typecheck` → clean. Run: `npm run build` → succeeds.

- [ ] **Step 7: Commit**

```bash
git add components.json src/components/ui src/app/globals.css package.json
git commit -m "feat(ui): init shadcn on the radix base with sonner toasts"
```

---

## Task 0.8: Settings query and the client settings context

`<Money />` has to work inside TanStack Table cells, which are client components. So settings are fetched once per request on the server and pushed down through a context.

**Files:**
- Create: `src/lib/queries/settings.ts`
- Create: `src/components/app/settings-provider.tsx`
- Create: `src/components/app/money.tsx`
- Create: `src/components/app/date-display.tsx`

- [ ] **Step 1: Server-side settings query**

Create `src/lib/queries/settings.ts`:

```ts
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type AppSettings = Tables<'app_settings'>

/**
 * React cache() deduplicates this across a single render pass, so a page
 * with twenty <Money /> instances still issues one query.
 */
export const getSettings = cache(async (): Promise<AppSettings> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) throw new Error(`Could not load app settings: ${error.message}`)
  return data
})
```

- [ ] **Step 2: Client context**

Create `src/components/app/settings-provider.tsx`:

```tsx
'use client'

import { createContext, useContext } from 'react'
import type { AppSettings } from '@/lib/queries/settings'

const SettingsContext = createContext<AppSettings | null>(null)

export function SettingsProvider({
  settings,
  children,
}: {
  settings: AppSettings
  children: React.ReactNode
}) {
  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): AppSettings {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings must be used inside the (app) layout')
  }
  return ctx
}
```

- [ ] **Step 3: The Money component**

Create `src/components/app/money.tsx`:

```tsx
'use client'

import { formatMoney } from '@/lib/format'
import { useSettings } from '@/components/app/settings-provider'
import { cn } from '@/lib/utils'

/**
 * Spec §5 rule 5: ALL money rendering goes through here. No ad-hoc
 * toFixed anywhere in the codebase — Phase 8 greps for it.
 */
export function Money({
  value,
  className,
}: {
  value: number | string | null | undefined
  className?: string
}) {
  const settings = useSettings()
  return (
    <span className={cn('tabular-nums', className)}>
      {formatMoney(value, settings)}
    </span>
  )
}
```

`formatMoney` takes `{ currency_symbol, currency_decimals }` and `AppSettings` has both, so the settings object is passed straight through with no adapter.

- [ ] **Step 4: The date component**

Create `src/components/app/date-display.tsx`:

```tsx
import { formatDate, formatDateTime } from '@/lib/format'

export function DateDisplay({
  value,
  withTime = false,
  className,
}: {
  value: string | Date | null | undefined
  withTime?: boolean
  className?: string
}) {
  const text = withTime ? formatDateTime(value) : formatDate(value)
  const iso = value
    ? typeof value === 'string'
      ? value
      : value.toISOString()
    : undefined
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  )
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/settings.ts src/components/app
git commit -m "feat: settings context, Money and DateDisplay components"
```

---

## Task 0.9: Login page and auth callback

**Files:**
- Create: `src/lib/schemas/auth.ts`
- Create: `src/lib/schemas/auth.test.ts`
- Create: `src/lib/actions/auth.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/login/login-form.tsx`
- Create: `src/app/(auth)/auth/callback/route.ts`
- Create: `src/app/layout.tsx` (modify the generated one)

- [ ] **Step 1: Write the failing schema test**

Create `src/lib/schemas/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loginSchema } from '@/lib/schemas/auth'

describe('loginSchema', () => {
  it('accepts a valid credential pair', () => {
    const r = loginSchema.safeParse({ email: 'a@b.com', password: 'hunter22' })
    expect(r.success).toBe(true)
  })

  it('rejects a malformed email with our own message', () => {
    const r = loginSchema.safeParse({ email: 'nope', password: 'hunter22' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Enter a valid email address')
  })

  it('rejects an empty password', () => {
    const r = loginSchema.safeParse({ email: 'a@b.com', password: '' })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.message).toBe('Enter your password')
  })

  it('lowercases and trims the email so login is case-insensitive', () => {
    const r = loginSchema.parse({ email: '  A@B.COM ', password: 'hunter22' })
    expect(r.email).toBe('a@b.com')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/schemas/auth`.

- [ ] **Step 3: Write the schema**

Create `src/lib/schemas/auth.ts`:

```ts
import * as z from 'zod'

/**
 * Zod 4: import is `* as z`; format helpers are top-level (z.email(), not
 * z.string().email()); customisation is the unified `error` key —
 * required_error / invalid_type_error / errorMap were removed.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter a valid email address' })),
  password: z.string().min(1, { error: 'Enter your password' }),
})

export type LoginInput = z.infer<typeof loginSchema>
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test`
Expected: PASS, 12 tests total across both files.

- [ ] **Step 5: The action-result type and the login action**

Create `src/lib/actions/auth.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { loginSchema } from '@/lib/schemas/auth'

/**
 * The return shape every Server Action in this app uses. Spec §5 rule 2.
 * Defined here because auth is the first action written; import it from
 * '@/lib/actions/auth' everywhere else.
 */
export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

export async function login(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  // Client-side Zod is a UX affordance. This is the boundary. Spec §8.
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the details below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Deliberately vague: never reveal whether the address has an account.
    return { ok: false, error: 'Those details did not work. Try again.' }
  }

  const next = String(formData.get('next') ?? '/')
  // Only ever redirect within this app — an open redirect here is free
  // credential phishing.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'

  revalidatePath('/', 'layout')
  redirect(safeNext)
}

export async function logout(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
```

Add `import * as z from 'zod'` to the top of this file for `z.flattenError`.

- [ ] **Step 6: The login form**

Create `src/app/(auth)/login/login-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { login, type ActionResult } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full h-11" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  )
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    login,
    null,
  )

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoFocus
          required
          aria-invalid={Boolean(state?.ok === false && state.fieldErrors?.email)}
          className="h-11"
        />
        {state?.ok === false && state.fieldErrors?.email ? (
          <p className="text-sm text-destructive">{state.fieldErrors.email[0]}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state?.ok === false && state.fieldErrors?.password)}
          className="h-11"
        />
        {state?.ok === false && state.fieldErrors?.password ? (
          <p className="text-sm text-destructive">
            {state.fieldErrors.password[0]}
          </p>
        ) : null}
      </div>

      {state?.ok === false && !state.fieldErrors ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  )
}
```

`h-11` on the inputs and button is 44px — the minimum touch target from spec §6.6, applied from the very first screen so it becomes the habit.

- [ ] **Step 7: The login page**

Create `src/app/(auth)/login/page.tsx`:

```tsx
import { LoginForm } from './login-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  // Next 16: searchParams is a Promise and must be awaited.
  const { next } = await searchParams

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Oat Bar CRM</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next ?? '/'} />
        </CardContent>
      </Card>
    </main>
  )
}
```

**No signup link and no signup page.** Spec §4: a signup form here is a liability with no user.

- [ ] **Step 8: The auth callback route**

Create `src/app/(auth)/auth/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Used by password-reset and magic links. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`)
  }

  return NextResponse.redirect(`${origin}/login?error=link_expired`)
}
```

- [ ] **Step 9: Root layout with theme provider and toaster**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'Oat Bar CRM',
  description: 'Customers, orders, production and invoicing',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors closeButton position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 10: Verify the whole auth loop by hand**

Run `npm run dev`, then:

1. Visit `/settings` → redirected to `/login?next=%2Fsettings`. ✅
2. Enter a wrong password → "Those details did not work. Try again." appears, and **the email field still contains what you typed**. ✅ (spec §6.2: never clear a form on error)
3. Enter correct credentials → lands on `/settings`. ✅
4. Hard-refresh → still signed in, no redirect to `/login`. ✅
5. Visit `/login` while signed in → redirected to `/`. ✅

- [ ] **Step 11: Verify signup really is rejected at the API**

This is a spec §7 Phase 0 acceptance criterion and it must be tested against the API, not the UI. Run:

```bash
curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/signup" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" -d '{"email":"stranger@example.com","password":"hunter2hunter2"}'
```

Expected: an error response, not a user. Signups are disabled at the project level *and* the hook would reject the address. **If this creates a user, both layer 1 and layer 2 of spec §4 have failed — stop and fix before deploying.**

- [ ] **Step 12: Commit**

```bash
git add src/app/layout.tsx "src/app/(auth)" src/lib/schemas src/lib/actions
git commit -m "feat(auth): login page, callback route, and signup verified rejected"
```

---

## Task 0.10: The app shell

**Files:**
- Create: `src/components/app/app-shell.tsx`
- Create: `src/components/app/nav-links.ts`
- Create: `src/components/app/theme-toggle.tsx`
- Create: `src/components/app/user-menu.tsx`
- Create: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Navigation definition, in one place**

Create `src/components/app/nav-links.ts`:

```ts
import {
  LayoutDashboard, Users, ShoppingCart, CalendarClock,
  ChefHat, FileText, Package, Carrot, TrendingUp, Settings,
} from 'lucide-react'

export type NavLink = {
  href: string
  label: string
  icon: typeof Users
  /** Phase 7 command palette: G-then-key. */
  shortcut?: string
}

export const NAV_LINKS: NavLink[] = [
  { href: '/',            label: 'Dashboard',  icon: LayoutDashboard, shortcut: 'd' },
  { href: '/customers',   label: 'Customers',  icon: Users,           shortcut: 'c' },
  { href: '/orders',      label: 'Orders',     icon: ShoppingCart,    shortcut: 'o' },
  { href: '/schedules',   label: 'Schedules',  icon: CalendarClock,   shortcut: 's' },
  { href: '/production',  label: 'Production', icon: ChefHat,         shortcut: 'p' },
  { href: '/invoices',    label: 'Invoices',   icon: FileText,        shortcut: 'i' },
  { href: '/products',    label: 'Products',   icon: Package },
  { href: '/ingredients', label: 'Ingredients', icon: Carrot },
  { href: '/insights',    label: 'Insights',   icon: TrendingUp },
  { href: '/settings',    label: 'Settings',   icon: Settings },
]
```

Every route exists as a link from Phase 0. Routes not built yet will 404 until their phase lands — that is deliberate and better than editing this list six times.

- [ ] **Step 2: The shell**

Create `src/components/app/app-shell.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Menu } from 'lucide-react'
import { NAV_LINKS } from '@/components/app/nav-links'
import { ThemeToggle } from '@/components/app/theme-toggle'
import { UserMenu } from '@/components/app/user-menu'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-1 p-2" aria-label="Main">
      {NAV_LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

export function AppShell({
  email,
  children,
}: {
  email: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-r md:block">
        <div className="flex h-14 items-center px-4 font-semibold">Oat Bar CRM</div>
        <NavList />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="size-11 md:hidden">
                <Menu className="size-5" />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="px-4 py-4 text-left">Oat Bar CRM</SheetTitle>
              <NavList onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* Phase 7 replaces this with the command palette trigger. */}
          <div className="flex-1" id="topbar-search-slot" />

          <ThemeToggle />
          <UserMenu email={email} />
        </header>

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
```

`asChild` on `SheetTrigger` is the Radix composition prop. If it is not accepted, you are on the Base UI build — revisit Task 0.7 Step 2.

- [ ] **Step 3: Theme toggle**

Create `src/components/app/theme-toggle.tsx`:

```tsx
'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="size-5 dark:hidden" aria-hidden />
      <Moon className="hidden size-5 dark:block" aria-hidden />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
```

Swapping icons with `dark:hidden` rather than reading `resolvedTheme` avoids the hydration mismatch that `next-themes` is famous for.

- [ ] **Step 4: User menu**

Create `src/components/app/user-menu.tsx`:

```tsx
'use client'

import { logout } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function UserMenu({ email }: { email: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11">
          <span aria-hidden className="text-sm font-medium">
            {email.slice(0, 1).toUpperCase()}
          </span>
          <span className="sr-only">Account menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <form action={logout}>
            <button type="submit" className="w-full text-left">Sign out</button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 5: The `(app)` layout**

Create `src/app/(app)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/queries/settings'
import { AppShell } from '@/components/app/app-shell'
import { SettingsProvider } from '@/components/app/settings-provider'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // Belt and braces behind the proxy: getClaims verifies the JWT locally.
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')

  const settings = await getSettings()
  const email = String(data.claims.email ?? '')

  return (
    <SettingsProvider settings={settings}>
      <AppShell email={email}>{children}</AppShell>
    </SettingsProvider>
  )
}
```

- [ ] **Step 6: Verify**

Run: `npm run dev`, sign in, and check:
- Sidebar visible at desktop width, hidden below `md`. ✅
- At 375px the hamburger opens a drawer, tapping a link closes it. ✅
- Theme toggle flips light/dark and survives a refresh. ✅
- Sign out returns you to `/login` and `/` then redirects back to login. ✅

- [ ] **Step 7: Commit**

```bash
git add src/components/app "src/app/(app)/layout.tsx"
git commit -m "feat(ui): app shell with responsive nav, theme toggle, user menu"
```

---

## Task 0.11: Error, loading and not-found boundaries

Built now, not retrofitted in Phase 7. Every route added from here inherits them.

**Files:**
- Create: `src/app/(app)/error.tsx`
- Create: `src/app/(app)/loading.tsx`
- Create: `src/app/(app)/not-found.tsx`
- Create: `src/app/global-error.tsx`
- Create: `src/components/app/empty-state.tsx`

- [ ] **Step 1: Error boundary**

Create `src/app/(app)/error.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 py-16">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        That page could not load. Trying again usually works. If it keeps
        happening, send this reference:{' '}
        <code className="rounded bg-muted px-1">{error.digest ?? 'none'}</code>
      </p>
      <Button onClick={reset} className="h-11">Try again</Button>
    </div>
  )
}
```

The digest, never the stack. Spec §7 Phase 7b: no raw stack trace ever reaches the screen.

- [ ] **Step 2: Loading skeleton**

Create `src/app/(app)/loading.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-full max-w-sm" />
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}
```

Skeletons, not spinners. Spec §6.7.

- [ ] **Step 3: Not found**

Create `src/app/(app)/not-found.tsx`:

```tsx
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 py-16">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        That record does not exist, or it was archived.
      </p>
      <Button asChild className="h-11"><Link href="/">Back to dashboard</Link></Button>
    </div>
  )
}
```

- [ ] **Step 4: Global error**

Create `src/app/global-error.tsx`:

```tsx
'use client'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', padding: '2rem' }}>
        <h1>Something went wrong</h1>
        <p>Reload the page. Reference: {error.digest ?? 'none'}</p>
      </body>
    </html>
  )
}
```

- [ ] **Step 5: The two empty states**

Create `src/components/app/empty-state.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Spec §6.3: "no data yet" and "no results for these filters" are two
 * different screens. Conflating them is the single most common internal-
 * tool mistake, so they are two exported components, not one with a flag.
 */
export function NoDataYet({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}

export function NoResults({
  activeFilters,
  onClear,
}: {
  activeFilters: string[]
  onClear: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <h2 className="text-base font-semibold">Nothing matches these filters</h2>
      {activeFilters.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Filtering by {activeFilters.join(', ')}.
        </p>
      ) : null}
      <Button variant="outline" onClick={onClear} className="h-11">
        Clear filters
      </Button>
    </div>
  )
}
```

- [ ] **Step 6: Verify the error boundary actually catches**

Temporarily add `throw new Error('boundary check')` at the top of `src/app/(app)/page.tsx`'s component, load `/`, confirm you see "Something went wrong" and **not** a stack trace, then remove the throw.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/error.tsx" "src/app/(app)/loading.tsx" "src/app/(app)/not-found.tsx" src/app/global-error.tsx src/components/app/empty-state.tsx
git commit -m "feat(ui): error, loading and not-found boundaries; two empty states"
```

---

## Task 0.12: Dashboard shell

Placeholders only. Phases 1, 3 and 6 fill their own sections. Building the page now means Phase 1 does not have to invent it.

**Files:**
- Create: `src/app/(app)/page.tsx`
- Create: `src/components/app/dashboard-section.tsx`

- [ ] **Step 1: Section wrapper**

Create `src/components/app/dashboard-section.tsx`:

```tsx
import type { ReactNode } from 'react'

export function DashboardSection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function SectionPlaceholder({ phase }: { phase: string }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      Arrives in {phase}.
    </div>
  )
}
```

- [ ] **Step 2: The dashboard**

Create `src/app/(app)/page.tsx`:

```tsx
import {
  DashboardSection,
  SectionPlaceholder,
} from '@/components/app/dashboard-section'

/**
 * Ordered as the answer to "what do I need to do today?" (spec §7 Phase 6).
 * Each section is filled by the phase named in its placeholder. Do not
 * reorder them — the order is the design.
 */
export default async function DashboardPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Today</h1>

      {/* Phase 1 fills follow-ups; Phase 3 adds deliveries due. */}
      <DashboardSection title="Today">
        <SectionPlaceholder phase="Phase 1" />
      </DashboardSection>

      <DashboardSection title="This week">
        <SectionPlaceholder phase="Phase 3" />
      </DashboardSection>

      <DashboardSection title="Money">
        <SectionPlaceholder phase="Phase 5" />
      </DashboardSection>

      <DashboardSection title="Needs attention">
        <SectionPlaceholder phase="Phase 6" />
      </DashboardSection>
    </div>
  )
}
```

- [ ] **Step 3: Verify**

Visit `/` signed in. Four sections render with their placeholders. Readable at 375px with no horizontal scroll.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/page.tsx" src/components/app/dashboard-section.tsx
git commit -m "feat(ui): dashboard shell with the four sections later phases fill"
```

---

## Task 0.13: Settings page

Needed now, because `<Money />` reads currency from it.

**Files:**
- Create: `src/lib/schemas/settings.ts`
- Create: `src/lib/schemas/settings.test.ts`
- Create: `src/lib/actions/settings.ts`
- Create: `src/app/(app)/settings/page.tsx`
- Create: `src/app/(app)/settings/settings-form.tsx`

- [ ] **Step 1: Write the failing schema test**

Create `src/lib/schemas/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { settingsSchema } from '@/lib/schemas/settings'

const valid = {
  business_name: 'Oat & Co',
  business_email: 'hello@oat.co',
  business_phone: '+973 3300 1122',
  address_line1: '12 Road 4',
  address_line2: '',
  city: 'Manama',
  postcode: '317',
  country: 'Bahrain',
  timezone: 'Asia/Bahrain',
  currency_code: 'BHD',
  currency_symbol: 'BD',
  currency_decimals: 3,
  default_payment_terms_days: 14,
  invoice_prefix: 'INV-',
  lapse_threshold_days: 45,
  bank_name: '',
  bank_account_name: '',
  bank_account_number: '',
  bank_iban: '',
  bank_swift: '',
}

describe('settingsSchema', () => {
  it('accepts a complete settings object', () => {
    expect(settingsSchema.safeParse(valid).success).toBe(true)
  })

  it('requires a business name', () => {
    const r = settingsSchema.safeParse({ ...valid, business_name: '  ' })
    expect(r.success).toBe(false)
  })

  it('rejects currency_decimals outside 0..3', () => {
    expect(settingsSchema.safeParse({ ...valid, currency_decimals: 4 }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...valid, currency_decimals: -1 }).success).toBe(false)
  })

  it('rejects a lapse threshold of zero — it would flag every customer', () => {
    expect(settingsSchema.safeParse({ ...valid, lapse_threshold_days: 0 }).success).toBe(false)
  })

  it('turns blank optional text into null so the column is null, not ""', () => {
    const r = settingsSchema.parse({ ...valid, bank_iban: '   ' })
    expect(r.bank_iban).toBeNull()
  })

  it('rejects a malformed business email but allows an empty one', () => {
    expect(settingsSchema.safeParse({ ...valid, business_email: 'nope' }).success).toBe(false)
    expect(settingsSchema.parse({ ...valid, business_email: '' }).business_email).toBeNull()
  })

  it('never lets the client set next_invoice_number', () => {
    const r = settingsSchema.parse({ ...valid, next_invoice_number: 9999 } as never)
    expect('next_invoice_number' in r).toBe(false)
  })
})
```

That last test is load-bearing. `next_invoice_number` is allocated atomically by `f_create_invoice` in Phase 5; a settings form that can write it is a lost-update race with a UI.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/schemas/settings`.

- [ ] **Step 3: Write the schema**

Create `src/lib/schemas/settings.ts`:

```ts
import * as z from 'zod'

/** Blank text inputs must become null, not empty strings. */
export const optionalText = z
  .string()
  .trim()
  .transform((v) => (v.length > 0 ? v : null))
  .nullable()

export const optionalEmail = z
  .string()
  .trim()
  .transform((v) => (v.length > 0 ? v.toLowerCase() : null))
  .nullable()
  .refine(
    (v) => v === null || z.email().safeParse(v).success,
    { error: 'Enter a valid email address' },
  )

export const settingsSchema = z.object({
  business_name: z.string().trim().min(1, { error: 'Required' }),
  business_email: optionalEmail,
  business_phone: optionalText,
  address_line1: optionalText,
  address_line2: optionalText,
  city: optionalText,
  postcode: optionalText,
  country: optionalText,
  timezone: z.string().trim().min(1, { error: 'Required' }),
  currency_code: z.string().trim().min(1, { error: 'Required' }),
  currency_symbol: z.string().trim().min(1, { error: 'Required' }),
  currency_decimals: z.coerce
    .number()
    .int()
    .min(0, { error: '0 to 3' })
    .max(3, { error: '0 to 3' }),
  default_payment_terms_days: z.coerce.number().int().min(0, { error: '0 or more' }),
  invoice_prefix: z.string().trim().min(1, { error: 'Required' }),
  lapse_threshold_days: z.coerce
    .number()
    .int()
    .min(1, { error: 'Must be at least 1 day' }),
  bank_name: optionalText,
  bank_account_name: optionalText,
  bank_account_number: optionalText,
  bank_iban: optionalText,
  bank_swift: optionalText,
})
// next_invoice_number is deliberately absent. f_create_invoice owns it.

export type SettingsInput = z.input<typeof settingsSchema>
export type SettingsOutput = z.output<typeof settingsSchema>
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: The action**

Create `src/lib/actions/settings.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { settingsSchema } from '@/lib/schemas/settings'
import type { ActionResult } from '@/lib/actions/auth'

export async function updateSettings(
  raw: unknown,
): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the fields below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('app_settings')
    .update(parsed.data)
    .eq('id', 1)

  if (error) return { ok: false, error: error.message }

  // Currency lives in the (app) layout, so revalidate the whole layout —
  // otherwise <Money /> keeps rendering the old symbol everywhere.
  revalidatePath('/', 'layout')
  return { ok: true }
}
```

Add `import * as z from 'zod'` at the top.

- [ ] **Step 6: The form**

Create `src/app/(app)/settings/settings-form.tsx`. This is the **reference Field + Controller form**; Phase 1 Task 1.6 generalises it.

```tsx
'use client'

import { useForm, Controller, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import * as z from 'zod'
import { settingsSchema } from '@/lib/schemas/settings'
import { updateSettings } from '@/lib/actions/settings'
import type { AppSettings } from '@/lib/queries/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type In = z.input<typeof settingsSchema>
type Out = z.output<typeof settingsSchema>

/**
 * shadcn has no <Form /> any more — it is the library-agnostic <Field />
 * primitive, and you wire <Controller /> yourself. Convention: data-invalid
 * on <Field>, aria-invalid on the control.
 */
function TextField({
  control,
  name,
  label,
  type = 'text',
  inputMode,
  autoComplete,
  className,
}: {
  control: Control<In, unknown, Out>
  name: keyof In
  label: string
  type?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel'
  autoComplete?: string
  className?: string
}) {
  return (
    <Controller
      control={control}
      name={name as never}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={className}>
          <FieldLabel htmlFor={name as string}>{label}</FieldLabel>
          <Input
            {...field}
            id={name as string}
            type={type}
            inputMode={inputMode}
            autoComplete={autoComplete}
            value={(field.value as string | number | null) ?? ''}
            aria-invalid={fieldState.invalid || undefined}
            className="h-11"
          />
          {fieldState.error ? (
            <FieldError>{fieldState.error.message}</FieldError>
          ) : null}
        </Field>
      )}
    />
  )
}

export function SettingsForm({ settings }: { settings: AppSettings }) {
  // Zod 4 + RHF: with any .transform()/.default() in the schema, either
  // omit the generic entirely or supply all three. Two is the type error
  // everyone hits.
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(settingsSchema),
    mode: 'onTouched', // validate on first blur, then live. Spec §6.2.
    defaultValues: {
      business_name: settings.business_name,
      business_email: settings.business_email ?? '',
      business_phone: settings.business_phone ?? '',
      address_line1: settings.address_line1 ?? '',
      address_line2: settings.address_line2 ?? '',
      city: settings.city ?? '',
      postcode: settings.postcode ?? '',
      country: settings.country ?? '',
      timezone: settings.timezone,
      currency_code: settings.currency_code,
      currency_symbol: settings.currency_symbol,
      currency_decimals: settings.currency_decimals,
      default_payment_terms_days: settings.default_payment_terms_days,
      invoice_prefix: settings.invoice_prefix,
      lapse_threshold_days: settings.lapse_threshold_days,
      bank_name: settings.bank_name ?? '',
      bank_account_name: settings.bank_account_name ?? '',
      bank_account_number: settings.bank_account_number ?? '',
      bank_iban: settings.bank_iban ?? '',
      bank_swift: settings.bank_swift ?? '',
    },
  })

  const { control, handleSubmit, formState, reset } = form

  async function onSubmit(values: Out) {
    const result = await updateSettings(values)
    if (result.ok) {
      toast.success('Settings saved')
      reset(values as unknown as In) // clears the dirty state
    } else {
      toast.error(result.error)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-xl space-y-6 pb-24">
      <Card>
        <CardHeader><CardTitle>Business</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <TextField control={control} name="business_name" label="Business name" />
          <TextField control={control} name="business_email" label="Email" type="email" inputMode="email" />
          <TextField control={control} name="business_phone" label="Phone" type="tel" inputMode="tel" />
          <TextField control={control} name="address_line1" label="Address line 1" />
          <TextField control={control} name="address_line2" label="Address line 2" />
          {/* The one permitted two-column group: short, logically paired. */}
          <div className="grid grid-cols-2 gap-3">
            <TextField control={control} name="city" label="City" />
            <TextField control={control} name="postcode" label="Postcode" />
          </div>
          <TextField control={control} name="country" label="Country" />
          <TextField control={control} name="timezone" label="Timezone" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Money</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField control={control} name="currency_code" label="Currency code" />
            <TextField control={control} name="currency_symbol" label="Symbol" />
          </div>
          <TextField control={control} name="currency_decimals" label="Decimal places" inputMode="numeric" className="max-w-28" />
          <TextField control={control} name="default_payment_terms_days" label="Payment terms (days)" inputMode="numeric" className="max-w-28" />
          <TextField control={control} name="invoice_prefix" label="Invoice prefix" className="max-w-40" />
          <TextField control={control} name="lapse_threshold_days" label="Flag a customer as quiet after (days)" inputMode="numeric" className="max-w-28" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Bank details for invoices</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <TextField control={control} name="bank_name" label="Bank" />
          <TextField control={control} name="bank_account_name" label="Account name" />
          <TextField control={control} name="bank_account_number" label="Account number" inputMode="numeric" />
          <TextField control={control} name="bank_iban" label="IBAN" />
          <TextField control={control} name="bank_swift" label="SWIFT / BIC" />
        </CardContent>
      </Card>

      {/* Bottom-anchored on mobile, within thumb reach. Spec §6.6. */}
      <div className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t bg-background p-3 md:static md:border-0 md:bg-transparent md:p-0">
        <Button type="submit" disabled={!formState.isDirty || formState.isSubmitting} className="h-11 flex-1 md:flex-none">
          {formState.isSubmitting ? 'Saving…' : 'Save changes'}
        </Button>
        {formState.isDirty ? (
          <span className="text-sm text-muted-foreground">Unsaved changes</span>
        ) : null}
      </div>
      {/* No Reset or Clear button. Spec §6.2. */}
    </form>
  )
}
```

Note the field widths: decimals and terms are `max-w-28`, not full width. Spec §6.2 — match the field to the expected input.

- [ ] **Step 7: The page**

Create `src/app/(app)/settings/page.tsx`:

```tsx
import { getSettings } from '@/lib/queries/settings'
import { SettingsForm } from './settings-form'

export default async function SettingsPage() {
  const settings = await getSettings()
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsForm settings={settings} />
    </div>
  )
}
```

- [ ] **Step 8: Verify — this is a Phase 0 acceptance criterion**

1. `/settings` loads with the seeded values. ✅
2. Change the currency symbol to `£` and decimals to `2`. Save. Toast appears, "Unsaved changes" disappears. ✅
3. Add a temporary `<Money value={1.5} />` to the dashboard. It renders `£ 1.50`. Change settings back to `BD` / `3`; it renders `BD 1.500`. Remove the temporary element. ✅ **This is spec §7 Phase 0's "Currency set in Settings changes how `<Money />` renders everywhere".**
4. Clear the business name and blur → inline error with text, not colour alone. Save is still clickable but the submit is blocked. ✅
5. At 375px the save bar is pinned to the bottom and reachable with a thumb. ✅

- [ ] **Step 9: Commit**

```bash
git add src/lib/schemas/settings.ts src/lib/schemas/settings.test.ts src/lib/actions/settings.ts "src/app/(app)/settings"
git commit -m "feat(settings): business, currency and bank settings with the reference form pattern"
```

---

## Task 0.14: `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Write it**

Create `CLAUDE.md` with the content from spec Appendix A verbatim, then append this section — the four corrections must survive context compaction or someone will "fix" them back:

```markdown
## Corrections applied to the spec (do NOT revert these)
- signup_allowlist has RLS + ONE policy scoped to supabase_auth_admin, plus
  a grant. Spec said "zero policies" — that role has no BYPASSRLS, so zero
  policies rejects every login.
- profiles uses self-referential RLS (auth.uid() = id). The blanket policy
  from spec §3.9 recurses (42P17) when applied to profiles itself.
- Every function gets `revoke execute ... from public, anon` +
  `grant execute ... to authenticated`. Postgres grants EXECUTE to PUBLIC
  by default and PostgREST exposes functions as RPC.
- f_handle_new_user IS security definer, and is the only such object. The
  auth.users trigger runs under a role with no write access to public.

## Testing (approved deviation from spec §1)
vitest + vite-tsconfig-paths + @playwright/test are installed on purpose.
Vitest runs node-environment tests over pure functions only (no jsdom, no
Testing Library). Playwright covers the Phase 8 cold-start journey.
Run `npm test` and `npm run typecheck` before declaring anything done.

## This machine has no Docker and no psql
Migrations are authored in supabase/migrations/ and applied with the
Supabase MCP apply_migration tool. Types come from MCP
generate_typescript_types. verify.sql runs through MCP execute_sql.
The npm db:* scripts are correct and become live once Docker is installed.
NEVER apply schema through the dashboard SQL editor.
```

- [ ] **Step 2: Verify it references a file that exists**

Run: `ls docs/crm-build-plan.md`
Expected: the file listed. (`CLAUDE.md` points at it.)

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md with pinned constraints and the four spec corrections"
```

---

## Task 0.15: Deploy to GitHub and Vercel

**Files:** none

- [ ] **Step 1: Create the repo and push**

```bash
gh repo create oat-bar-crm --private --source=. --remote=origin
git push -u origin phase-0-foundation
```

- [ ] **Step 2: Deploy**

Import the repo in Vercel. Set both environment variables from `.env.local` for Production, Preview and Development. Deploy from `phase-0-foundation`.

- [ ] **Step 3: Add the deployed URL to Supabase**

Dashboard → Authentication → URL Configuration: set Site URL to the Vercel production URL and add `<url>/auth/callback` to Redirect URLs. Without this, password reset silently redirects to localhost.

- [ ] **Step 4: Verify in production**

On the deployed URL:
1. `/` redirects to `/login`. ✅
2. Sign in works. ✅
3. Refresh keeps you signed in. ✅
4. `/settings` loads real data. ✅
5. At 375px in a real phone browser, the drawer works. ✅

- [ ] **Step 5: Run the advisors early**

Call MCP `get_advisors` for `security` and for `performance`. Note every finding. Fix anything about RLS immediately; carry the rest into Phase 8 step 7.

Expect a security finding about `f_handle_new_user` being `security definer` — that one is intentional (correction C4). Record it as accepted, with the reason, so Phase 8 does not re-litigate it.

- [ ] **Step 6: Commit and open the PR**

```bash
git push
gh pr create --title "Phase 0 — Foundation" --body "Deployed authenticated shell, settings, dashboard skeleton, migration 0001. Includes four documented corrections to the spec; see docs/superpowers/plans/2026-08-06-oat-bar-crm/README.md."
```

---

## Task 0.16: Phase Exit — acceptance gate

Do not start Phase 1 until every line here passes. Tick them one at a time.

- [ ] `npm run typecheck` → clean, no `any`, no `@ts-ignore`
- [ ] `npm test` → all pass
- [ ] `npm run build` → succeeds
- [ ] Any `/(app)` route while logged out redirects to `/login`
- [ ] Login lands on the dashboard; a hard refresh does not log you out
- [ ] Signing up through the API is rejected (Task 0.9 Step 11)
- [ ] `src/lib/database.types.ts` is generated, with the "do not hand-edit" banner
- [ ] Changing the currency in Settings changes what `<Money />` renders
- [ ] The deployed Vercel URL is functional
- [ ] `components.json` records the **radix** base and `src/components/ui/sonner.tsx` exists
- [ ] `select count(*) from public.profiles` under `role authenticated` returns without 42P17
- [ ] `has_table_privilege('supabase_auth_admin','public.signup_allowlist','SELECT')` is true
- [ ] Every section of the dashboard renders at 375px with no horizontal scroll
- [ ] Security Advisor findings are either fixed or recorded as accepted with a reason
