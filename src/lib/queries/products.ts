import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type Product = Tables<'products'>
export type Ingredient = Tables<'ingredients'>
export type ProductCost = Tables<'v_product_costs'>

export type ProductWithCost = Product & { recipe_cost: number; ingredient_count: number }

/**
 * Everything, joined with its live recipe cost. `!inner` is safe here: the
 * view is a left join from `products` in SQL, so every product id has
 * exactly one `v_product_costs` row (recipe_cost 0, ingredient_count 0 for
 * a product with no recipe yet) — it never filters a product out.
 *
 * `v_product_costs` is a *view*, not a table with a declared foreign key,
 * so the generated types cannot express the one-to-one relationship and
 * embed it as a one-element array instead of an object. Reading `[0]` is
 * the correct, fully-typed way to unwrap that — not a workaround.
 */
export async function listProducts(includeArchived = false): Promise<ProductWithCost[]> {
  const supabase = await createClient()
  let query = supabase
    .from('products')
    .select('*, v_product_costs!inner ( recipe_cost, ingredient_count )')
    .order('name', { ascending: true })

  if (!includeArchived) query = query.is('archived_at', null)

  const { data, error } = await query
  if (error) throw new Error(`Could not load products: ${error.message}`)

  return (data ?? []).map((row) => {
    const { v_product_costs, ...product } = row
    const cost = v_product_costs[0]
    return {
      ...product,
      recipe_cost: cost?.recipe_cost ?? 0,
      ingredient_count: cost?.ingredient_count ?? 0,
    }
  })
}

export async function getProduct(id: string): Promise<Product | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Could not load product: ${error.message}`)
  return data
}

export async function getProductCost(id: string): Promise<ProductCost | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_product_costs').select('*').eq('product_id', id).maybeSingle()
  if (error) throw new Error(`Could not load product cost: ${error.message}`)
  return data
}

export type RecipeLine = Tables<'product_ingredients'> & {
  ingredients: Pick<Ingredient, 'id' | 'name' | 'unit' | 'pack_size' | 'pack_cost'> | null
}

export async function listRecipe(productId: string): Promise<RecipeLine[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('product_ingredients')
    .select('*, ingredients ( id, name, unit, pack_size, pack_cost )')
    .eq('product_id', productId)

  if (error) throw new Error(`Could not load recipe: ${error.message}`)
  return (data ?? []).sort((a, b) =>
    (a.ingredients?.name ?? '').localeCompare(b.ingredients?.name ?? ''),
  )
}

export async function listIngredients(): Promise<Ingredient[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ingredients').select('*').order('name', { ascending: true })
  if (error) throw new Error(`Could not load ingredients: ${error.message}`)
  return data ?? []
}
