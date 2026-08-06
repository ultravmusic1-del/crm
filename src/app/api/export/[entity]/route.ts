import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toCsv, type CsvColumn } from '@/lib/csv'

const ENTITIES = {
  customers: {
    view: 'v_customer_summary',
    filename: 'customers',
    columns: [
      { key: 'name', header: 'Name' },
      { key: 'status', header: 'Status' },
      { key: 'type', header: 'Type' },
      { key: 'city', header: 'City' },
      { key: 'price_tier', header: 'Price tier' },
      { key: 'order_count', header: 'Orders' },
      { key: 'lifetime_revenue', header: 'Lifetime revenue' },
      { key: 'first_order_date', header: 'First order' },
      { key: 'last_order_date', header: 'Last order' },
      { key: 'days_since_last_order', header: 'Days since last order' },
    ],
  },
  orders: {
    view: 'v_order_list',
    filename: 'orders',
    columns: [
      { key: 'order_number', header: 'Order #' },
      { key: 'customer_name', header: 'Customer' },
      { key: 'ordered_on', header: 'Ordered' },
      { key: 'delivery_date', header: 'Delivery' },
      { key: 'status', header: 'Status' },
      { key: 'total_units', header: 'Units' },
      { key: 'subtotal', header: 'Total' },
      { key: 'total_cost', header: 'Cost' },
      { key: 'gross_margin', header: 'Margin' },
    ],
  },
  invoices: {
    view: 'v_invoice_list',
    filename: 'invoices',
    columns: [
      { key: 'invoice_number', header: 'Invoice #' },
      { key: 'customer_name', header: 'Customer' },
      { key: 'issued_on', header: 'Issued' },
      { key: 'due_on', header: 'Due' },
      { key: 'computed_status', header: 'Status' },
      { key: 'subtotal', header: 'Subtotal' },
      { key: 'delivery_charge', header: 'Delivery charge' },
      { key: 'discount_amount', header: 'Discount' },
      { key: 'total', header: 'Total' },
      { key: 'amount_paid', header: 'Paid' },
      { key: 'balance', header: 'Balance' },
    ],
  },
} as const

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ entity: string }> },
) {
  // Next 16: params is a Promise.
  const { entity } = await params

  const config = ENTITIES[entity as keyof typeof ENTITIES]
  if (!config) return NextResponse.json({ error: 'Unknown export' }, { status: 404 })

  // The proxy already gates this route, but a data-exfiltration endpoint
  // gets its own check. Cheap, and it survives a matcher edit.
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data, error } = await supabase.from(config.view).select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const csv = toCsv(
    (data ?? []) as Record<string, unknown>[],
    config.columns as unknown as CsvColumn<Record<string, unknown>>[],
  )

  const stamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(
    // A BOM, so Excel opens UTF-8 correctly and "Café" is not "CafÃ©".
    `﻿${csv}`,
    {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${config.filename}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    },
  )
}
