import * as z from 'zod'
import { optionalText } from '@/lib/schemas/settings'

export const PRODUCT_UNITS = ['bar', 'box', 'tray'] as const
export const INGREDIENT_UNITS = ['g', 'ml', 'each'] as const

/** numeric(12,3): three decimals, non-negative, coerced from form strings. */
const money = z.coerce
  .number({ error: 'Enter a number' })
  .min(0, { error: 'Cannot be negative' })
  .multipleOf(0.001, { error: 'At most three decimal places' })

export const productSchema = z.object({
  name: z.string().trim().min(1, { error: 'A name is required' }),
  sku: optionalText.optional().default(''),
  description: optionalText.optional().default(''),
  unit: z.enum(PRODUCT_UNITS).default('bar'),
  units_per_box: z.coerce.number().int().min(1, { error: 'At least 1' }).default(1),
  wholesale_price: money.default(0),
  retail_price: money.default(0),
  unit_cost: money.default(0),
})

export type ProductInput = z.input<typeof productSchema>
export type ProductOutput = z.output<typeof productSchema>

export const ingredientSchema = z.object({
  name: z.string().trim().min(1, { error: 'A name is required' }),
  unit: z.string().trim().min(1, { error: 'Required' }),
  pack_size: z.coerce
    .number({ error: 'Enter a number' })
    .gt(0, { error: 'Must be more than zero — the shopping list divides by it' }),
  pack_cost: money,
})

export type IngredientInput = z.input<typeof ingredientSchema>
export type IngredientOutput = z.output<typeof ingredientSchema>

export const recipeLineSchema = z.object({
  product_id: z.uuid(),
  ingredient_id: z.uuid(),
  quantity: z.coerce
    .number({ error: 'Enter a number' })
    .gt(0, { error: 'Must be more than zero' }),
})

export const customerPriceSchema = z.object({
  customer_id: z.uuid(),
  product_id: z.uuid(),
  unit_price: money,
})
