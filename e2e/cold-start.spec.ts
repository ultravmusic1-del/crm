import { expect, test } from '@playwright/test'

/**
 * Spec §7 Phase 8 step 9: the full journey from an empty database, using
 * only the UI. Every step must be discoverable — if a locator here needs a
 * URL typed by hand, that step is not discoverable and it is a bug.
 *
 * Run this against a FRESH database (truncate via seed.sql's wipe block,
 * without the seed inserts), not against seeded data.
 */

const STAMP = process.env.E2E_STAMP ?? 'E2E'
const CUSTOMER = `${STAMP} Test Café`
const PRODUCT = `${STAMP} Test Bar`
const INGREDIENT = `${STAMP} Test Oats`

// Deliberately OUTSIDE the `authenticated journey` describe block below: a
// `test.beforeEach` that requests the `page` fixture runs before every test
// in its scope regardless of which fixtures that individual test asks for.
// Nesting the login-requiring tests in their own describe keeps this one
// runnable with no credentials at all — the plan's own promise that this
// specific test needs none.
test('a signed-out visitor is sent to the login page', async ({ browser }) => {
  const anon = await browser.newContext()
  const page = await anon.newPage()
  await page.goto('/customers')
  await expect(page).toHaveURL(/\/login/)
  await anon.close()
})

test.describe('authenticated journey', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(process.env.E2E_EMAIL!)
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).toHaveURL('/')
  })

  test('cold start: customer to payment, entirely through the UI', async ({ page }) => {
    // ── 1. Add a customer ────────────────────────────────────────────────
    await page.getByRole('link', { name: 'Customers' }).click()
    await page.getByRole('link', { name: /new customer/i }).click()
    await page.getByLabel('Name').fill(CUSTOMER)
    await page.getByRole('button', { name: /create customer/i }).click()
    await expect(page.getByRole('heading', { name: CUSTOMER })).toBeVisible()

    // ── 2. Log an interaction with a follow-up ───────────────────────────
    await page.getByRole('button', { name: /log interaction/i }).click()
    await page.getByRole('radio', { name: 'Phone' }).click()
    await page.getByLabel('What happened?').fill('Cold-start walkthrough call.')
    await page.getByRole('radio', { name: 'Interested' }).click()
    await page.getByRole('button', { name: 'In 3 days' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('tab', { name: /activity/i }).click()
    await expect(page.getByText('Cold-start walkthrough call.')).toBeVisible()

    // ── 3. Add an ingredient and a product with a recipe ─────────────────
    await page.getByRole('link', { name: 'Ingredients' }).click()
    await page.getByRole('button', { name: /new ingredient|add your first ingredient/i }).click()
    await page.getByLabel('Name').fill(INGREDIENT)
    await page.getByLabel('Unit').fill('g')
    await page.getByLabel('Pack size').fill('1000')
    await page.getByLabel('Pack cost').fill('2.400')
    await page.getByRole('button', { name: /add ingredient|save/i }).click()
    await expect(page.getByText(INGREDIENT)).toBeVisible()

    await page.getByRole('link', { name: 'Products' }).click()
    await page.getByRole('link', { name: /new product|add your first product/i }).click()
    await page.getByLabel('Name').fill(PRODUCT)
    await page.getByLabel('Cost per unit').fill('0.250')
    await page.getByLabel('Wholesale price').fill('0.500')
    // Margin must appear live, before saving.
    await expect(page.getByText('50.0%')).toBeVisible()
    await page.getByRole('button', { name: /create product/i }).click()
    await expect(page.getByRole('heading', { name: PRODUCT })).toBeVisible()

    await page.getByRole('button', { name: /add ingredient/i }).click()
    await page.getByRole('combobox', { name: /ingredient/i }).click()
    await page.getByRole('option', { name: new RegExp(INGREDIENT) }).click()
    await page.getByLabel(/quantity per/i).fill('40')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('0.096')).toBeVisible() // 40 × 2.400/1000

    // ── 4. Create an order ───────────────────────────────────────────────
    await page.getByRole('link', { name: 'Orders' }).click()
    await page.getByRole('link', { name: /new order|create the first order/i }).click()
    await page.getByRole('combobox', { name: /customer/i }).click()
    await page.getByRole('option', { name: CUSTOMER }).click()
    await page.getByRole('button', { name: /add product/i }).click()
    await page.getByRole('option', { name: new RegExp(PRODUCT) }).click()
    await page.getByRole('button', { name: /increase quantity/i }).click()
    await page.getByRole('button', { name: /create order/i }).click()
    await expect(page.getByRole('heading', { name: /order #/i })).toBeVisible()

    // ── 5. The order reaches the bake list ───────────────────────────────
    await page.getByRole('link', { name: 'Production' }).click()
    await expect(page.getByText(PRODUCT)).toBeVisible()
    // And so does the shopping list, through the recipe.
    await expect(page.getByText(INGREDIENT)).toBeVisible()

    // ── 6. Mark it delivered ─────────────────────────────────────────────
    await page.getByRole('link', { name: 'Orders' }).click()
    await page.getByRole('row', { name: new RegExp(CUSTOMER) }).click()
    await page.getByRole('combobox', { name: /status/i }).click()
    await page.getByRole('option', { name: 'Delivered' }).click()
    await expect(page.getByText('Delivered')).toBeVisible()

    // ── 7. Invoice it ────────────────────────────────────────────────────
    await page.getByRole('link', { name: 'Invoices' }).click()
    await page.getByRole('link', { name: /new invoice|create the first invoice/i }).click()
    await page.getByText(CUSTOMER).click()
    await page.getByRole('button', { name: /create invoice/i }).click()
    await expect(page.getByRole('heading', { name: /invoice inv-/i })).toBeVisible()

    // ── 8. Record the payment ────────────────────────────────────────────
    await page.getByRole('button', { name: /mark sent/i }).click()
    await page.getByRole('button', { name: /record payment/i }).click()
    await page.getByRole('button', { name: /save|record/i }).click()
    await expect(page.getByText('Paid')).toBeVisible()
  })

  test('no screen scrolls horizontally on a phone', async ({ page }) => {
    for (const path of [
      '/', '/customers', '/orders', '/schedules', '/production',
      '/invoices', '/products', '/ingredients', '/insights', '/settings',
    ]) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      )
      expect(overflows, `${path} scrolls horizontally`).toBe(false)
    }
  })
})
