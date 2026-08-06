import { describe, expect, it } from 'vitest'
import { productSchema, ingredientSchema, recipeLineSchema } from '@/lib/schemas/products'

describe('productSchema', () => {
  it('accepts a product with just a name', () => {
    expect(productSchema.safeParse({ name: 'Almond Bar' }).success).toBe(true)
  })

  it('defaults unit to bar and units_per_box to 1', () => {
    const r = productSchema.parse({ name: 'Almond Bar' })
    expect(r.unit).toBe('bar')
    expect(r.units_per_box).toBe(1)
  })

  it('rejects a negative wholesale_price or unit_cost', () => {
    expect(productSchema.safeParse({ name: 'X', wholesale_price: -1 }).success).toBe(false)
    expect(productSchema.safeParse({ name: 'X', unit_cost: -0.001 }).success).toBe(false)
  })

  it('coerces the strings that number inputs produce', () => {
    const r = productSchema.parse({ name: 'X', wholesale_price: '0.500' })
    expect(r.wholesale_price).toBe(0.5)
  })

  it('rejects a units_per_box of zero', () => {
    expect(productSchema.safeParse({ name: 'X', units_per_box: 0 }).success).toBe(false)
  })

  it('turns a blank sku into null so two products with sku: "" do not collide on the unique index', () => {
    expect(productSchema.parse({ name: 'X', sku: '' }).sku).toBeNull()
  })
})

describe('ingredientSchema', () => {
  it('rejects a pack_size of zero', () => {
    const r = ingredientSchema.safeParse({ name: 'Oats', unit: 'g', pack_size: 0, pack_cost: 2.4 })
    expect(r.success).toBe(false)
  })

  it('accepts a valid ingredient', () => {
    expect(
      ingredientSchema.safeParse({ name: 'Oats', unit: 'g', pack_size: 1000, pack_cost: 2.4 }).success,
    ).toBe(true)
  })
})

describe('recipeLineSchema', () => {
  it('rejects a quantity of zero', () => {
    expect(
      recipeLineSchema.safeParse({
        product_id: '11111111-1111-4111-8111-111111111111',
        ingredient_id: '22222222-2222-4222-8222-222222222222',
        quantity: 0,
      }).success,
    ).toBe(false)
  })
})
