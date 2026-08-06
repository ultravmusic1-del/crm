'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { contactSchema } from '@/lib/schemas/contacts'
import type { ActionResult } from '@/lib/actions/auth'

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>
}

/**
 * One naive insert. `trg_contacts_single_primary` (0002_customers.sql)
 * already demotes any existing primary contact before this row lands, so
 * there is no "first unset the other primary" step to write here — adding
 * one would be redundant and would race the trigger.
 */
export async function createContact(raw: unknown): Promise<ActionResult> {
  const parsed = contactSchema.safeParse(raw)

  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('contacts').insert(parsed.data)

  if (error) {
    return { ok: false, error: 'Could not add contact. Try again.' }
  }

  revalidatePath(`/customers/${parsed.data.customer_id}`)
  return { ok: true }
}

export async function updateContact(id: string, raw: unknown): Promise<ActionResult> {
  const parsed = contactSchema.safeParse(raw)

  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('contacts').update(parsed.data).eq('id', id)

  if (error) {
    return { ok: false, error: 'Could not save contact. Try again.' }
  }

  revalidatePath(`/customers/${parsed.data.customer_id}`)
  return { ok: true }
}

export async function deleteContact(id: string, customerId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('contacts').delete().eq('id', id)

  if (error) {
    return { ok: false, error: 'Could not remove contact. Try again.' }
  }

  revalidatePath(`/customers/${customerId}`)
  return { ok: true }
}
