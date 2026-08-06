'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { orderSchema, orderStatusSchema, scheduleSchema } from '@/lib/schemas/orders'
import { resolvePrices } from '@/lib/queries/pricing'
import { getLastOrderItems } from '@/lib/queries/orders'
import { getPricesForCustomer } from '@/lib/queries/order-form'
import type { ActionResult } from '@/lib/actions/auth'

/**
 * Client-side Zod (in the order form) is a UX affordance. This
 * re-validation is the actual boundary.
 */
function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>
}

function revalidateOrderSurfaces(orderId?: string, customerId?: string) {
  revalidatePath('/orders')
  revalidatePath('/production')
  revalidatePath('/')
  if (orderId) revalidatePath(`/orders/${orderId}`)
  if (customerId) revalidatePath(`/customers/${customerId}`)
}

export async function createOrder(raw: unknown): Promise<ActionResult & { id?: string }> {
  const parsed = orderSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Check the order below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const { customer_id, delivery_date, status, notes, items } = parsed.data
  const supabase = await createClient()

  // Snapshot the address and delivery notes as they are TODAY, so a
  // customer moving next year does not rewrite this delivery sheet.
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('address_line1, address_line2, city, postcode, delivery_notes')
    .eq('id', customer_id)
    .single()

  if (custErr) return { ok: false, error: `Could not load the customer: ${custErr.message}` }

  const address =
    [customer.address_line1, customer.address_line2, customer.city, customer.postcode]
      .filter(Boolean)
      .join(', ') || null

  // THE price authority. Throws (naming the product) if anything resolves
  // to zero, which is exactly what we want — better a visible error than an
  // invoice for nothing.
  let priced: Awaited<ReturnType<typeof resolvePrices>>
  try {
    priced = await resolvePrices(customer_id, items.map((i) => i.product_id))
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      customer_id,
      delivery_date,
      status,
      notes,
      delivery_address: address,
      delivery_notes_snapshot: customer.delivery_notes,
    })
    .select('id')
    .single()

  if (orderErr) return { ok: false, error: orderErr.message }

  const { error: itemsErr } = await supabase.from('order_items').insert(
    items.map((i) => {
      const p = priced.get(i.product_id)!
      return {
        order_id: order.id,
        product_id: i.product_id,
        product_name: p.productName, // snapshot
        quantity: i.quantity,
        unit_price: p.unitPrice, // snapshot, resolved server-side
        unit_cost: p.unitCost, // snapshot, for historical margin
      }
    }),
  )

  if (itemsErr) {
    // supabase-js cannot open a multi-statement transaction, so clean up
    // rather than leaving a lineless order behind. Assertion P3.4 in
    // verify.sql catches it if this ever fails.
    await supabase.from('orders').delete().eq('id', order.id)
    return { ok: false, error: itemsErr.message }
  }

  revalidateOrderSurfaces(order.id, customer_id)
  return { ok: true, id: order.id }
}

export async function updateOrder(
  id: string,
  raw: unknown,
): Promise<ActionResult & { detachedFromSchedule?: boolean }> {
  const parsed = orderSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Check the order below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const { customer_id, delivery_date, status, notes, items } = parsed.data
  const supabase = await createClient()

  const { data: existing, error: readErr } = await supabase
    .from('orders')
    .select('delivery_date, recurring_order_id')
    .eq('id', id)
    .single()

  if (readErr) return { ok: false, error: readErr.message }

  // This is a SERVER ACTION rule, not a database one: if a generated
  // order's delivery date moves, detach it from its schedule. Otherwise the
  // next generation run recreates an order on the original date and she has
  // two.
  const detach =
    existing.recurring_order_id !== null && existing.delivery_date !== delivery_date

  let priced: Awaited<ReturnType<typeof resolvePrices>>
  try {
    priced = await resolvePrices(customer_id, items.map((i) => i.product_id))
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  const { error: updErr } = await supabase
    .from('orders')
    .update({
      delivery_date,
      status,
      notes,
      ...(detach ? { recurring_order_id: null } : {}),
    })
    .eq('id', id)

  if (updErr) return { ok: false, error: updErr.message }

  // Replace the lines wholesale. Prices are re-resolved and re-snapshotted,
  // which is correct: editing an order means "what it is now".
  const { error: delErr } = await supabase.from('order_items').delete().eq('order_id', id)
  if (delErr) return { ok: false, error: delErr.message }

  const { error: itemsErr } = await supabase.from('order_items').insert(
    items.map((i) => {
      const p = priced.get(i.product_id)!
      return {
        order_id: id,
        product_id: i.product_id,
        product_name: p.productName,
        quantity: i.quantity,
        unit_price: p.unitPrice,
        unit_cost: p.unitCost,
      }
    }),
  )

  if (itemsErr) return { ok: false, error: itemsErr.message }

  revalidateOrderSurfaces(id, customer_id)
  return { ok: true, detachedFromSchedule: detach }
}

/** Optimistic on the client: single object, reversible. */
export async function setOrderStatus(raw: unknown): Promise<ActionResult> {
  const parsed = orderStatusSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Invalid status' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('orders')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.id)
    .select('customer_id')
    .single()

  if (error) return { ok: false, error: error.message }

  revalidateOrderSurfaces(parsed.data.id, data.customer_id)
  return { ok: true }
}

/** Bulk status change, e.g. "mark this day's orders as in production" or
 * "mark delivered" from the orders list. */
export async function setOrderStatusBulk(
  ids: string[],
  status: string,
): Promise<ActionResult & { count?: number }> {
  const parsedStatus = orderStatusSchema.shape.status.safeParse(status)
  if (!parsedStatus.success || ids.length === 0) {
    return { ok: false, error: 'Nothing to update' }
  }

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('orders')
    .update({ status: parsedStatus.data }, { count: 'exact' })
    .in('id', ids)

  if (error) return { ok: false, error: error.message }

  revalidateOrderSurfaces()
  return { ok: true, count: count ?? ids.length }
}

// ── Schedules ───────────────────────────────────────────────────────────

export async function upsertSchedule(
  id: string | null,
  raw: unknown,
): Promise<ActionResult & { id?: string }> {
  const parsed = scheduleSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Check the schedule below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const { items, ...schedule } = parsed.data
  const supabase = await createClient()

  const payload = {
    ...schedule,
    // Null out whichever day column this frequency does not use, so a
    // frequency change cannot leave a stale value behind.
    day_of_week: schedule.frequency === 'monthly' ? null : schedule.day_of_week,
    day_of_month: schedule.frequency === 'monthly' ? schedule.day_of_month : null,
  }

  const { data, error } = id
    ? await supabase.from('recurring_orders').update(payload).eq('id', id).select('id').single()
    : await supabase.from('recurring_orders').insert(payload).select('id').single()

  if (error) return { ok: false, error: error.message }

  const { error: delErr } = await supabase
    .from('recurring_order_items')
    .delete()
    .eq('recurring_order_id', data.id)
  if (delErr) return { ok: false, error: delErr.message }

  const { error: itemsErr } = await supabase.from('recurring_order_items').insert(
    items.map((i) => ({
      recurring_order_id: data.id,
      product_id: i.product_id,
      quantity: i.quantity,
    })),
  )

  if (itemsErr) return { ok: false, error: itemsErr.message }

  revalidatePath('/schedules')
  revalidatePath(`/schedules/${data.id}`)
  return { ok: true, id: data.id }
}

export async function setScheduleActive(
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('recurring_orders').update({ active }).eq('id', id)
  if (error) return { ok: false, error: error.message }

  // Deactivating stops FUTURE generation. Already-generated orders are left
  // alone on purpose — she may still be delivering them this week.
  revalidatePath('/schedules')
  revalidatePath(`/schedules/${id}`)
  return { ok: true }
}

export type GenerationResult = {
  created_count: number
  skipped_count: number
  warnings: string[]
}

/**
 * Called from a VISIBLE BUTTON on /schedules. Never from a render — Next 16
 * forbids writes during a render and prefetch would race it.
 */
export async function generateScheduledOrders(
  horizonDays = 21,
): Promise<ActionResult & { result?: GenerationResult }> {
  const supabase = await createClient()

  const until = new Date()
  until.setDate(until.getDate() + horizonDays)
  const p_until = until.toISOString().slice(0, 10)

  const { data, error } = await supabase.rpc('f_generate_scheduled_orders', { p_until })
  if (error) return { ok: false, error: error.message }

  const row = Array.isArray(data) ? data[0] : data

  revalidatePath('/schedules')
  revalidateOrderSurfaces()

  return {
    ok: true,
    result: {
      created_count: row?.created_count ?? 0,
      skipped_count: row?.skipped_count ?? 0,
      warnings: row?.warnings ?? [],
    },
  }
}

/** Prices are never sent from the browser — the form ASKS for them. */
export async function fetchCustomerContext(customerId: string): Promise<{
  prices: { product_id: string; effective_price: number; price_source: string }[]
  lastOrderItems: { product_id: string; quantity: number }[]
}> {
  const [prices, lastOrderItems] = await Promise.all([
    getPricesForCustomer(customerId),
    getLastOrderItems(customerId),
  ])
  return { prices, lastOrderItems }
}
