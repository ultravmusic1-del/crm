import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'
import type { Contact } from '@/lib/queries/customers'

export type CustomerSummary = Tables<'v_customer_summary'>

export type ProductPerformance = {
  product_id: string
  product_name: string
  units_sold: number
  revenue: number
  cost: number
  margin: number
  margin_pct: number | null
}

export type MonthlyRevenue = { month: string; revenue: number; order_count: number }
export type MonthlyCustomers = { month: string; new_customers: number }

export type OutreachEffectiveness = {
  channel: string
  interaction_count: number
  customers_touched: number
  customers_who_ordered: number
  conversion_pct: number | null
}

export async function listCustomerSummaries(): Promise<CustomerSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_customer_summary')
    .select('*')
    .is('archived_at', null)
    .order('lifetime_revenue', { ascending: false })

  if (error) throw new Error(`Could not load customer summaries: ${error.message}`)
  return data ?? []
}

/** The dashboard's "Needs attention" section. */
export async function listAtRiskCustomers(): Promise<CustomerSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_customer_summary')
    .select('*')
    .eq('risk_flag', true)
    .order('days_since_last_order', { ascending: false })

  if (error) throw new Error(`Could not load at-risk customers: ${error.message}`)
  return data ?? []
}

export async function getProductPerformance(
  from: string,
  to: string,
): Promise<ProductPerformance[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('f_product_performance', {
    p_from: from, p_to: to,
  })
  if (error) throw new Error(`Could not load product performance: ${error.message}`)
  return (data ?? []) as unknown as ProductPerformance[]
}

export async function getRevenueByMonth(months = 12): Promise<MonthlyRevenue[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('f_revenue_by_month', { p_months: months })
  if (error) throw new Error(`Could not load monthly revenue: ${error.message}`)
  return (data ?? []) as unknown as MonthlyRevenue[]
}

export async function getNewCustomersByMonth(months = 12): Promise<MonthlyCustomers[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('f_new_customers_by_month', { p_months: months })
  if (error) throw new Error(`Could not load new customers: ${error.message}`)
  return (data ?? []) as unknown as MonthlyCustomers[]
}

export async function getOutreachEffectiveness(
  from: string,
  to: string,
): Promise<OutreachEffectiveness[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('f_outreach_effectiveness', {
    p_from: from, p_to: to,
  })
  if (error) throw new Error(`Could not load outreach data: ${error.message}`)
  return (data ?? []) as unknown as OutreachEffectiveness[]
}

/** One round trip for the contacts of every at-risk customer. */
export async function getContactsFor(
  customerIds: string[],
): Promise<Record<string, Contact[]>> {
  if (customerIds.length === 0) return {}

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .in('customer_id', customerIds)
    .order('is_primary', { ascending: false })

  if (error) throw new Error(`Could not load contacts: ${error.message}`)

  const out: Record<string, Contact[]> = {}
  for (const c of data ?? []) {
    ;(out[c.customer_id] ??= []).push(c)
  }
  return out
}
