'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  customerSchema,
  customerStatusSchema,
  customerNotesSchema,
} from '@/lib/schemas/customers'
import type { ActionResult } from '@/lib/actions/auth'

/**
 * Client-side Zod (in customer-form.tsx) is a UX affordance. This
 * re-validation is the actual boundary.
 */
function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>
}

export async function createCustomer(raw: unknown): Promise<ActionResult & { id?: string }> {
  const parsed = customerSchema.safeParse(raw)

  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers')
    .insert(parsed.data)
    .select('id')
    .single()

  if (error) {
    return { ok: false, error: 'Could not create customer. Try again.' }
  }

  revalidatePath('/customers')
  return { ok: true, id: data.id }
}

export async function updateCustomer(id: string, raw: unknown): Promise<ActionResult> {
  const parsed = customerSchema.safeParse(raw)

  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('customers').update(parsed.data).eq('id', id)

  if (error) {
    return { ok: false, error: 'Could not save customer. Try again.' }
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
  return { ok: true }
}

export async function setCustomerStatus(raw: unknown): Promise<ActionResult> {
  const parsed = customerStatusSchema.safeParse(raw)

  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customers')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.id)

  if (error) {
    return { ok: false, error: 'Could not update status. Try again.' }
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${parsed.data.id}`)
  return { ok: true }
}

export async function saveCustomerNotes(raw: unknown): Promise<ActionResult> {
  const parsed = customerNotesSchema.safeParse(raw)

  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customers')
    .update({ notes: parsed.data.notes })
    .eq('id', parsed.data.id)

  if (error) {
    return { ok: false, error: 'Could not save notes. Try again.' }
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${parsed.data.id}`)
  return { ok: true }
}

export async function archiveCustomer(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('customers')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    return { ok: false, error: 'Could not archive customer. Try again.' }
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
  return { ok: true }
}

export async function unarchiveCustomer(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('customers')
    .update({ archived_at: null })
    .eq('id', id)

  if (error) {
    return { ok: false, error: 'Could not unarchive customer. Try again.' }
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
  return { ok: true }
}
