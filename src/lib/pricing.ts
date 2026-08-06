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
 * Throws on a resolved price of zero — a zero is far more likely a missing
 * setup than a genuine freebie, and writing it into an order snapshot means
 * an invoice for nothing that nobody spots until the month-end
 * reconciliation.
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
 * live figure a form shows while she types matches what the database
 * stores. If they ever disagree, the SQL is authoritative.
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
