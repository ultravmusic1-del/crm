'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  productSchema,
  ingredientSchema,
  recipeLineSchema,
  customerPriceSchema,
} from '@/lib/schemas/products'
import type { ActionResult } from '@/lib/actions/auth'

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>
}

export async function createProduct(raw: unknown): Promise<ActionResult & { id?: string }> {
  const parsed = productSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products').insert(parsed.data).select('id').single()

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'A product with that SKU already exists.' }
    return { ok: false, error: 'Could not create product. Try again.' }
  }

  revalidatePath('/products')
  return { ok: true, id: data.id }
}

/**
 * `order_items` snapshots `product_name`, `unit_price` and `unit_cost` at
 * the moment an order is created, so a past order must never change when
 * the product it references does. Deliberately no revalidation of any
 * `/orders/*` path here — those pages read the snapshot, not this row.
 */
export async function updateProduct(id: string, raw: unknown): Promise<ActionResult> {
  const parsed = productSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('products').update(parsed.data).eq('id', id)

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'A product with that SKU already exists.' }
    return { ok: false, error: 'Could not save product. Try again.' }
  }

  revalidatePath('/products')
  revalidatePath(`/products/${id}`)
  return { ok: true }
}

export async function archiveProduct(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('products').update({ archived_at: new Date().toISOString() }).eq('id', id)

  if (error) return { ok: false, error: 'Could not archive product. Try again.' }

  revalidatePath('/products')
  revalidatePath(`/products/${id}`)
  return { ok: true }
}

export async function unarchiveProduct(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('products').update({ archived_at: null }).eq('id', id)

  if (error) return { ok: false, error: 'Could not unarchive product. Try again.' }

  revalidatePath('/products')
  revalidatePath(`/products/${id}`)
  return { ok: true }
}

// ── Ingredients ─────────────────────────────────────────────────────────

export async function upsertIngredient(id: string | null, raw: unknown): Promise<ActionResult> {
  const parsed = ingredientSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Check the fields below.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = id
    ? await supabase.from('ingredients').update(parsed.data).eq('id', id)
    : await supabase.from('ingredients').insert(parsed.data)

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'An ingredient with that name already exists.' }
    return { ok: false, error: 'Could not save ingredient. Try again.' }
  }

  revalidatePath('/ingredients')
  revalidatePath('/products')
  return { ok: true }
}

export async function deleteIngredient(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('ingredients').delete().eq('id', id)

  if (error) {
    // on delete restrict from product_ingredients.ingredient_id.
    if (error.code === '23503') {
      return { ok: false, error: 'That ingredient is used in a recipe. Remove it from the recipe first.' }
    }
    return { ok: false, error: 'Could not delete ingredient. Try again.' }
  }

  revalidatePath('/ingredients')
  return { ok: true }
}

// ── Recipes ─────────────────────────────────────────────────────────────

export async function upsertRecipeLine(raw: unknown): Promise<ActionResult> {
  const parsed = recipeLineSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: 'Check the quantity.', fieldErrors: fieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('product_ingredients')
    .upsert(parsed.data, { onConflict: 'product_id,ingredient_id' })

  if (error) return { ok: false, error: 'Could not save recipe line. Try again.' }

  revalidatePath(`/products/${parsed.data.product_id}`)
  revalidatePath('/production')
  return { ok: true }
}

export async function deleteRecipeLine(id: string, productId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('product_ingredients').delete().eq('id', id)

  if (error) return { ok: false, error: 'Could not remove recipe line. Try again.' }

  revalidatePath(`/products/${productId}`)
  revalidatePath('/production')
  return { ok: true }
}

// ── Per-customer prices ─────────────────────────────────────────────────

export async function setCustomerPrice(raw: unknown): Promise<ActionResult> {
  const parsed = customerPriceSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'Enter a valid price.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('customer_prices')
    .upsert(parsed.data, { onConflict: 'customer_id,product_id' })

  if (error) return { ok: false, error: 'Could not save price. Try again.' }

  revalidatePath(`/customers/${parsed.data.customer_id}`)
  return { ok: true }
}

/** Clearing an override reverts the customer to the tier price. */
export async function clearCustomerPrice(customerId: string, productId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('customer_prices')
    .delete()
    .eq('customer_id', customerId)
    .eq('product_id', productId)

  if (error) return { ok: false, error: 'Could not clear price. Try again.' }

  revalidatePath(`/customers/${customerId}`)
  return { ok: true }
}
