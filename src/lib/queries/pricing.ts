import { createClient } from '@/lib/supabase/server'
import { pickPrice, type ResolvedPrice } from '@/lib/pricing'
import type { Tables } from '@/lib/database.types'

export type EffectivePrice = Tables<'v_effective_prices'>

/**
 * THE price authority. When creating an order the client sends product_id
 * and quantity only; any unit_price arriving from the browser is ignored.
 * This is what actually writes the snapshot.
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
export async function listEffectivePrices(customerId: string): Promise<EffectivePrice[]> {
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
