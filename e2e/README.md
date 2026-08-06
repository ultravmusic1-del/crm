# End-to-end tests

Playwright drives the app the way a person would: through the browser, no
direct SQL, no calling Server Actions from the test. There are three tests
in `cold-start.spec.ts`:

1. **`a signed-out visitor is sent to the login page`** — needs no
   credentials. Runs on every clone with no setup.
2. **`cold start: customer to payment, entirely through the UI`** — the full
   journey: add a customer, log an interaction, add an ingredient and a
   product with a recipe, create an order, watch it reach the bake list and
   the shopping list, mark it delivered, invoice it, record a payment.
   Needs to sign in, so it needs a real password.
3. **`no screen scrolls horizontally on a phone`** — walks every main route
   and asserts nothing overflows sideways at phone width. Also needs to
   sign in.

Both projects (`desktop`, `mobile` — an iPhone 13 viewport) run every test,
because spec §6.6 gives phone and laptop equal weight.

## What you need to put in `.env.test.local`

Create `.env.test.local` in the project root (same folder as `package.json`)
with:

```
E2E_EMAIL=your-real-login-email@example.com
E2E_PASSWORD=your-real-login-password
```

This file is already covered by the `.env*` line in `.gitignore` — it will
never be committed. Confirm that yourself at any time with:

```
git check-ignore -v .env.test.local
```

A placeholder version of this file already exists in the repo with the real
email filled in and `E2E_PASSWORD` set to a placeholder you need to replace.
**Nobody but you should type the real password into it.**

## Before running the authenticated tests

The two tests that sign in assume an **empty** database — they create a
customer, product and ingredient named `E2E Test …` and expect the app's
empty-state prompts ("add your first ingredient", "create the first order",
etc.) to be visible. Running them against the seeded demo data will not
corrupt anything, but some of the "add your first…" locators only appear on
a genuinely empty list, so the walkthrough may not match what you see.

To reset to empty first, run the guard + `truncate` block from the top of
`supabase/seed.sql` (everything up to and including the
`update public.app_settings …` line) through the Supabase SQL editor or MCP
`execute_sql` — **without** running the rest of the file, which repopulates
it with demo data. To get the demo data back afterwards, run all of
`seed.sql`.

## Running

With the dev server already running, or letting Playwright start it for you:

```
npm run e2e
```

To run only the test that needs no credentials:

```
npx playwright test -g "signed-out visitor"
```

To run everything with a browser window visible, for watching it work:

```
npx playwright test --headed
```

If a test fails, Playwright writes a trace you can open with:

```
npx playwright show-trace test-results/<test-folder>/trace.zip
```

## A failing locator is a real finding

If a step like `getByRole('link', { name: /new customer/i })` cannot find
the button, that means that action is not discoverable from the UI alone —
which is exactly what spec §7 Phase 8 step 9 is checking for. Fix the app,
not the test.
