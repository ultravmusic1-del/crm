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
