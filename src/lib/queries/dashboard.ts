import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { resolveWeek } from '@/lib/week'
import { COUNTED_STATUSES } from '@/lib/queries/orders'
import { BUSINESS_TIME_ZONE, parseMoney } from '@/lib/format'

export type WeekSummary = {
  from: string
  to: string
  orderCount: number
  orderValue: number
  unitCount: number
  deliveriesToday: {
    order_id: string
    customer_id: string
    customer_name: string
    total_units: number
  }[]
}

/** "Today" as the bakery experiences it, not the server's clock — same
 * reasoning as lib/format.ts and the orders list's date chips. */
function todayInBusinessTimeZone(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Monday–Sunday, the same week the production page shows (weekStartsOn: 1
 * everywhere in this app). Statuses are spelled out via COUNTED_STATUSES —
 * draft and cancelled never count toward revenue or the bake list.
 */
export async function getWeekSummary(): Promise<WeekSummary> {
  const { from, to } = resolveWeek(undefined)
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('v_order_list')
    .select('order_id, customer_id, customer_name, delivery_date, subtotal, total_units')
    .gte('delivery_date', from)
    .lte('delivery_date', to)
    .in('status', COUNTED_STATUSES as unknown as string[])

  if (error) throw new Error(`Could not load this week's summary: ${error.message}`)

  const rows = data ?? []
  const today = todayInBusinessTimeZone()

  return {
    from,
    to,
    orderCount: rows.length,
    // parseMoney is the only sanctioned way to turn a numeric(12,3) string
    // into a number outside lib/format.ts itself.
    orderValue: rows.reduce((sum, r) => sum + parseMoney(r.subtotal), 0),
    unitCount: rows.reduce((sum, r) => sum + (r.total_units ?? 0), 0),
    deliveriesToday: rows
      .filter((r) => r.delivery_date === today && r.order_id && r.customer_id)
      .map((r) => ({
        order_id: r.order_id as string,
        customer_id: r.customer_id as string,
        customer_name: r.customer_name ?? '',
        total_units: r.total_units ?? 0,
      })),
  }
}

export type MoneySummary = {
  revenueThisMonth: number
  revenueLastMonth: number
  outstanding: number
  outstandingCount: number
  overdue: number
  overdueCount: number
  unbilledDeliveredValue: number
  unbilledDeliveredCount: number
}

export async function getMoneySummary(): Promise<MoneySummary> {
  const supabase = await createClient()

  const now = new Date()
  const thisFrom = format(startOfMonth(now), 'yyyy-MM-dd')
  const thisTo   = format(endOfMonth(now), 'yyyy-MM-dd')
  const lastFrom = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
  const lastTo   = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')

  const [thisMonth, lastMonth, invoices, unbilled] = await Promise.all([
    supabase.from('v_order_totals').select('subtotal')
      .gte('delivery_date', thisFrom).lte('delivery_date', thisTo)
      .in('status', COUNTED_STATUSES as unknown as string[]),
    supabase.from('v_order_totals').select('subtotal')
      .gte('delivery_date', lastFrom).lte('delivery_date', lastTo)
      .in('status', COUNTED_STATUSES as unknown as string[]),
    supabase.from('v_invoice_totals').select('balance, computed_status'),
    supabase.from('v_uninvoiced_orders').select('subtotal').eq('status', 'delivered'),
  ])

  if (thisMonth.error) throw new Error(`Could not load this month's revenue: ${thisMonth.error.message}`)
  if (lastMonth.error) throw new Error(`Could not load last month's revenue: ${lastMonth.error.message}`)
  if (invoices.error) throw new Error(`Could not load invoice totals: ${invoices.error.message}`)
  if (unbilled.error) throw new Error(`Could not load unbilled orders: ${unbilled.error.message}`)

  // parseMoney is the only sanctioned way to turn a numeric(12,3) string
  // into a number outside lib/format.ts itself.
  const sum = (rows: { subtotal: number | string | null }[] | null) =>
    (rows ?? []).reduce((s, r) => s + parseMoney(r.subtotal), 0)

  const invoiceRows = invoices.data ?? []
  const open = invoiceRows.filter(
    (i) => i.computed_status !== 'paid' && i.computed_status !== 'void',
  )
  const late = invoiceRows.filter((i) => i.computed_status === 'overdue')

  return {
    revenueThisMonth: sum(thisMonth.data),
    revenueLastMonth: sum(lastMonth.data),
    outstanding: open.reduce((s, i) => s + parseMoney(i.balance), 0),
    outstandingCount: open.length,
    overdue: late.reduce((s, i) => s + parseMoney(i.balance), 0),
    overdueCount: late.length,
    unbilledDeliveredValue: sum(unbilled.data),
    unbilledDeliveredCount: (unbilled.data ?? []).length,
  }
}
