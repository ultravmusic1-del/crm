import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type OrderListRow = Tables<'v_order_list'>
export type Order = Tables<'orders'>
export type OrderItem = Tables<'order_items'>
export type RecurringOrder = Tables<'recurring_orders'>

/** Statuses that count toward revenue, margin and the bake list. Every
 * caller filters explicitly — 'draft' and 'cancelled' never count. */
export const COUNTED_STATUSES = ['confirmed', 'in_production', 'delivered'] as const

export async function listOrders(): Promise<OrderListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_order_list')
    .select('*')
    .order('delivery_date', { ascending: true })
    .order('order_number', { ascending: true })

  if (error) throw new Error(`Could not load orders: ${error.message}`)
  return data ?? []
}

export async function listOrdersForCustomer(
  customerId: string,
): Promise<OrderListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_order_list')
    .select('*')
    .eq('customer_id', customerId)
    .order('delivery_date', { ascending: false })

  if (error) throw new Error(`Could not load orders: ${error.message}`)
  return data ?? []
}

export type OrderWithItems = Order & {
  order_items: OrderItem[]
  customers: { id: string; name: string; price_tier: string } | null
}

export async function getOrder(id: string): Promise<OrderWithItems | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items ( * ), customers ( id, name, price_tier )')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Could not load order: ${error.message}`)
  return data as OrderWithItems | null
}

export async function getOrderTotals(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_order_totals')
    .select('*')
    .eq('order_id', id)
    .maybeSingle()

  if (error) throw new Error(`Could not load order totals: ${error.message}`)
  return data
}

/**
 * Powers "Repeat last order". Only counted statuses — repeating a
 * cancelled order is never what she means.
 */
export async function getLastOrderItems(
  customerId: string,
): Promise<{ product_id: string; quantity: number }[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('orders')
    .select('id, delivery_date, order_items ( product_id, quantity )')
    .eq('customer_id', customerId)
    .in('status', COUNTED_STATUSES as unknown as string[])
    .order('delivery_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Could not load the last order: ${error.message}`)
  return (data?.order_items ?? []).map((i) => ({
    product_id: i.product_id,
    quantity: i.quantity,
  }))
}

export type ScheduleWithItems = RecurringOrder & {
  recurring_order_items: (Tables<'recurring_order_items'> & {
    products: { id: string; name: string; archived_at: string | null } | null
  })[]
  customers: { id: string; name: string } | null
}

export async function listSchedules(): Promise<ScheduleWithItems[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('recurring_orders')
    .select(`*,
      recurring_order_items ( *, products ( id, name, archived_at ) ),
      customers ( id, name )`)
    .order('active', { ascending: false })

  if (error) throw new Error(`Could not load schedules: ${error.message}`)
  return (data ?? []) as ScheduleWithItems[]
}

export async function getSchedule(id: string): Promise<ScheduleWithItems | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('recurring_orders')
    .select(`*,
      recurring_order_items ( *, products ( id, name, archived_at ) ),
      customers ( id, name )`)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Could not load schedule: ${error.message}`)
  return data as ScheduleWithItems | null
}
