import { getOrderFormData } from '@/lib/queries/order-form'
import { listCustomerSummaries } from '@/lib/queries/insights'
import { QuickOrderClient } from './quick-order-client'

/**
 * Two taps from the dashboard: pick a customer, adjust quantities, save.
 * Customers are ranked by recency (v_customer_summary.last_order_date) so
 * the people she orders for most are at the top of the list.
 */
export default async function QuickOrderPage() {
  const [{ customers, products }, summaries] = await Promise.all([
    getOrderFormData(),
    listCustomerSummaries(),
  ])

  const lastOrderByCustomer = new Map(
    summaries
      .filter((s): s is typeof s & { customer_id: string } => s.customer_id !== null)
      .map((s) => [s.customer_id, s.last_order_date ?? '']),
  )

  const rankedCustomers = [...customers].sort((a, b) => {
    const dateA = lastOrderByCustomer.get(a.id) ?? ''
    const dateB = lastOrderByCustomer.get(b.id) ?? ''
    return dateB.localeCompare(dateA)
  })

  return <QuickOrderClient customers={rankedCustomers} products={products} />
}
