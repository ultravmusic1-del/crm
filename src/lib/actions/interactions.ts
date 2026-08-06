'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { interactionSchema, followUpDoneSchema } from '@/lib/schemas/interactions'
import type { ActionResult } from '@/lib/actions/auth'

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>
}

function revalidateInteractionPaths(customerId: string) {
  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/customers')
  revalidatePath('/')
}

export async function logInteraction(raw: unknown): Promise<ActionResult> {
  const parsed = interactionSchema.safeParse(raw)

  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const created_by = claimsData?.claims?.sub ?? null

  const { error } = await supabase
    .from('interactions')
    .insert({ ...parsed.data, created_by })

  if (error) {
    return { ok: false, error: 'Could not log interaction. Try again.' }
  }

  revalidateInteractionPaths(parsed.data.customer_id)
  return { ok: true }
}

export async function setFollowUpDone(raw: unknown): Promise<ActionResult> {
  const parsed = followUpDoneSchema.safeParse(raw)

  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('interactions')
    .update({ follow_up_done: parsed.data.done })
    .eq('id', parsed.data.id)
    .select('customer_id')
    .single()

  if (error || !data) {
    return { ok: false, error: 'Could not update follow-up. Try again.' }
  }

  revalidateInteractionPaths(data.customer_id)
  return { ok: true }
}

/**
 * Bulk-clear multiple follow-ups at once. NOT optimistic — spec §6.4 limits
 * optimistic UI to single-object, reversible mutations, and this touches
 * many objects. The single-row "Done" button stays optimistic with Undo.
 */
export async function setFollowUpsDoneBulk(
  ids: string[],
): Promise<ActionResult & { count?: number }> {
  if (ids.length === 0) return { ok: false, error: 'Nothing selected' }

  const supabase = await createClient()
  const { error, count } = await supabase
    .from('interactions')
    .update({ follow_up_done: true }, { count: 'exact' })
    .in('id', ids)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/customers')
  revalidatePath('/')
  return { ok: true, count: count ?? ids.length }
}

export async function deleteInteraction(id: string, customerId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('interactions').delete().eq('id', id)

  if (error) {
    return { ok: false, error: 'Could not delete interaction. Try again.' }
  }

  revalidateInteractionPaths(customerId)
  return { ok: true }
}
