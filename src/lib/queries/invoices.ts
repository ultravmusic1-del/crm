import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'
import { parseMoney } from '@/lib/format'

export type InvoiceListRow = Tables<'v_invoice_list'>
export type InvoiceTotals = Tables<'v_invoice_totals'>
export type UninvoicedOrder = Tables<'v_uninvoiced_orders'>
export type Payment = Tables<'payments'>

export async function listInvoices(): Promise<InvoiceListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_invoice_list')
    .select('*')
    .order('issued_on', { ascending: false })

  if (error) throw new Error(`Could not load invoices: ${error.message}`)
  return data ?? []
}

export async function getInvoiceTotals(id: string): Promise<InvoiceTotals | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_invoice_totals').select('*').eq('invoice_id', id).maybeSingle()
  if (error) throw new Error(`Could not load the invoice: ${error.message}`)
  return data
}

export type InvoiceDetail = {
  invoice: Tables<'invoices'>
  customer: Tables<'customers'>
  totals: InvoiceTotals
  orders: (Tables<'orders'> & { order_items: Tables<'order_items'>[] })[]
  payments: Payment[]
}

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const supabase = await createClient()

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, customers ( * )')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Could not load the invoice: ${error.message}`)
  if (!invoice) return null

  const [totals, { data: joins }, { data: payments }] = await Promise.all([
    getInvoiceTotals(id),
    // The composite FK on (order_id, customer_id) means PostgREST sees two
    // relationships between invoice_orders and orders; the hint picks the
    // plain order_id one, or the embed is ambiguous and fails at request time.
    supabase
      .from('invoice_orders')
      .select('orders!invoice_orders_order_id_fkey ( *, order_items ( * ) )')
      .eq('invoice_id', id),
    supabase
      .from('payments')
      .select('*')
      .eq('invoice_id', id)
      .order('paid_on', { ascending: true }),
  ])

  const { customers, ...rest } = invoice as typeof invoice & {
    customers: Tables<'customers'>
  }

  return {
    invoice: rest as Tables<'invoices'>,
    customer: customers,
    totals: totals!,
    orders: (joins ?? [])
      .map((j) => j.orders)
      .filter(Boolean)
      .sort((a, b) => a!.delivery_date.localeCompare(b!.delivery_date)) as InvoiceDetail['orders'],
    payments: payments ?? [],
  }
}

export async function listUninvoicedOrders(
  customerId: string,
): Promise<UninvoicedOrder[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_uninvoiced_orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('delivery_date', { ascending: true })

  if (error) throw new Error(`Could not load uninvoiced orders: ${error.message}`)
  return data ?? []
}

/** Customers who have anything left to bill. Powers the create-invoice picker. */
export async function listCustomersWithUninvoicedOrders() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_uninvoiced_orders')
    .select('customer_id, customer_name, subtotal')

  if (error) throw new Error(`Could not load customers: ${error.message}`)

  const map = new Map<string, { id: string; name: string; count: number; value: number }>()
  for (const row of data ?? []) {
    const existing = map.get(row.customer_id!) ?? {
      id: row.customer_id!, name: row.customer_name ?? 'Unknown', count: 0, value: 0,
    }
    existing.count += 1
    existing.value += parseMoney(row.subtotal)
    map.set(row.customer_id!, existing)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}
