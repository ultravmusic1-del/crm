import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type BakeListRow = {
  product_id: string
  product_name: string
  product_unit: string
  total_quantity: number
  contributors: {
    order_id: string
    order_number: number
    customer_name: string
    delivery_date: string
    quantity: number
  }[]
}

export type ShoppingListRow = {
  ingredient_id: string
  ingredient_name: string
  unit: string
  total_needed: number
  pack_size: number
  packs_to_buy: number
  estimated_cost: number
}

export type DeliveryRow = Tables<'v_delivery_schedule'>

export async function getBakeList(from: string, to: string): Promise<BakeListRow[]> {
  const supabase = await createClient()
  // Parameters are p_-prefixed because `from` and `to` are reserved words
  // in Postgres and cannot be function parameter names.
  const { data, error } = await supabase.rpc('f_bake_list', { p_from: from, p_to: to })
  if (error) throw new Error(`Could not build the bake list: ${error.message}`)
  return (data ?? []) as unknown as BakeListRow[]
}

export async function getShoppingList(from: string, to: string): Promise<ShoppingListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('f_shopping_list', { p_from: from, p_to: to })
  if (error) throw new Error(`Could not build the shopping list: ${error.message}`)
  return (data ?? []) as unknown as ShoppingListRow[]
}

export async function getDeliverySchedule(
  from: string,
  to: string,
): Promise<DeliveryRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_delivery_schedule')
    .select('*')
    .gte('delivery_date', from)
    .lte('delivery_date', to)
    .order('delivery_date', { ascending: true })
    .order('customer_name', { ascending: true })

  if (error) throw new Error(`Could not load deliveries: ${error.message}`)
  return data ?? []
}
