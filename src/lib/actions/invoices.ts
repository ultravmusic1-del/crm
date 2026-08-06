'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  createInvoiceSchema, paymentSchema, adjustmentSchema,
} from '@/lib/schemas/invoices'
import { listUninvoicedOrders } from '@/lib/queries/invoices'
import { parseMoney } from '@/lib/format'
import type { ActionResult } from '@/lib/actions/auth'

function revalidateInvoiceSurfaces(id?: string) {
  revalidatePath('/invoices')
  revalidatePath('/orders')
  revalidatePath('/')
  if (id) revalidatePath(`/invoices/${id}`)
}

export async function createInvoice(
  raw: unknown,
): Promise<ActionResult & { id?: string }> {
  const parsed = createInvoiceSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the invoice below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()

  // One function call. Number allocation and both inserts happen inside a
  // single transaction, which supabase-js cannot open itself.
  const { data, error } = await supabase.rpc('f_create_invoice', {
    p_customer_id: parsed.data.customer_id,
    p_order_ids: parsed.data.order_ids,
    p_issued_on: parsed.data.issued_on,
    p_due_on: parsed.data.due_on,
  })

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'One of those orders is already on another invoice. Reload and try again.' }
    }
    return { ok: false, error: error.message }
  }

  revalidateInvoiceSurfaces(data as string)
  return { ok: true, id: data as string }
}

export async function markInvoiceSent(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('invoices').update({ status: 'sent' }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateInvoiceSurfaces(id)
  return { ok: true }
}

export async function recordPayment(raw: unknown): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the payment below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('payments').insert(parsed.data)
  if (error) return { ok: false, error: error.message }

  // `paid` is NOT written here. v_invoice_totals derives it from the
  // payments sum, so a partial payment correctly leaves the invoice `sent`
  // and a later top-up flips it to `paid` with no extra bookkeeping.
  revalidateInvoiceSurfaces(parsed.data.invoice_id)
  return { ok: true }
}

export async function deletePayment(
  id: string,
  invoiceId: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('payments').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidateInvoiceSurfaces(invoiceId)
  return { ok: true }
}

export async function setInvoiceAdjustment(raw: unknown): Promise<ActionResult> {
  const parsed = adjustmentSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Enter valid amounts.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('invoices')
    .update({
      discount_amount: parsed.data.discount_amount,
      delivery_charge: parsed.data.delivery_charge,
    })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }
  revalidateInvoiceSurfaces(parsed.data.id)
  return { ok: true }
}

/** Irreversible → the UI must confirm with a real modal, not an undo toast. */
export async function voidInvoice(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('f_void_invoice', { p_invoice_id: id })
  if (error) return { ok: false, error: error.message }
  revalidateInvoiceSurfaces(id)
  return { ok: true }
}

export async function fetchUninvoicedOrders(customerId: string) {
  const rows = await listUninvoicedOrders(customerId)
  return rows.map((r) => ({
    order_id: r.order_id!,
    order_number: r.order_number!,
    delivery_date: r.delivery_date!,
    status: r.status!,
    subtotal: parseMoney(r.subtotal),
    total_units: r.total_units ?? 0,
  }))
}
