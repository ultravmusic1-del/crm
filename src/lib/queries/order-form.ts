import { createClient } from '@/lib/supabase/server'

export type OrderFormCustomer = { id: string; name: string; price_tier: string }
export type OrderFormProduct = { id: string; name: string; unit: string }

/** Everything the order form needs, fetched in parallel: non-archived
 * customers and products, both name-ordered. */
export async function getOrderFormData(): Promise<{
  customers: OrderFormCustomer[]
  products: OrderFormProduct[]
}> {
  const supabase = await createClient()

  const [{ data: customers, error: cErr }, { data: products, error: pErr }] =
    await Promise.all([
      supabase
        .from('customers')
        .select('id, name, price_tier')
        .is('archived_at', null)
        .order('name'),
      supabase
        .from('products')
        .select('id, name, unit')
        .is('archived_at', null)
        .order('name'),
    ])

  if (cErr) throw new Error(`Could not load customers: ${cErr.message}`)
  if (pErr) throw new Error(`Could not load products: ${pErr.message}`)

  return { customers: customers ?? [], products: products ?? [] }
}

/** Live prices for the customer currently selected in the form. */
export async function getPricesForCustomer(customerId: string): Promise<
  { product_id: string; effective_price: number; price_source: string }[]
> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_effective_prices')
    .select('product_id, effective_price, price_source')
    .eq('customer_id', customerId)
    .is('product_archived_at', null)

  if (error) throw new Error(`Could not load prices: ${error.message}`)
  return (data ?? []) as { product_id: string; effective_price: number; price_source: string }[]
}
