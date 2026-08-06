import { describe, expect, it } from 'vitest'
import { orderSchema, orderStatusSchema, ORDER_STATUSES } from '@/lib/schemas/orders'

const CUST = '11111111-1111-4111-8111-111111111111'
const PROD = '22222222-2222-4222-8222-222222222222'

const valid = {
  customer_id: CUST,
  delivery_date: '2026-08-20',
  status: 'confirmed',
  notes: '',
  items: [{ product_id: PROD, quantity: 40 }],
}

describe('orderSchema', () => {
  it('accepts a valid order', () => {
    expect(orderSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an order with no line items', () => {
    expect(orderSchema.safeParse({ ...valid, items: [] }).success).toBe(false)
  })

  it('rejects a quantity of zero or below', () => {
    expect(orderSchema.safeParse({ ...valid, items: [{ product_id: PROD, quantity: 0 }] }).success).toBe(false)
    expect(orderSchema.safeParse({ ...valid, items: [{ product_id: PROD, quantity: -5 }] }).success).toBe(false)
  })

  it('rejects a fractional quantity — you cannot bake half a bar', () => {
    expect(orderSchema.safeParse({ ...valid, items: [{ product_id: PROD, quantity: 2.5 }] }).success).toBe(false)
  })

  it('rejects the same product twice on one order', () => {
    // order_items has unique (order_id, product_id); catch it before the DB.
    const r = orderSchema.safeParse({
      ...valid,
      items: [{ product_id: PROD, quantity: 10 }, { product_id: PROD, quantity: 20 }],
    })
    expect(r.success).toBe(false)
  })

  it('IGNORES any unit_price the client sends', () => {
    // Spec §5 rule 3. This is a security boundary, not a nicety.
    const r = orderSchema.parse({
      ...valid,
      items: [{ product_id: PROD, quantity: 40, unit_price: 0.001 }],
    })
    expect('unit_price' in r.items[0]).toBe(false)
  })

  it('requires a delivery date', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring is how we omit `delivery_date` from `rest`
    const { delivery_date, ...rest } = valid
    expect(orderSchema.safeParse(rest).success).toBe(false)
  })

  it('allows a delivery date in the past — backdating a missed entry is legitimate', () => {
    expect(orderSchema.safeParse({ ...valid, delivery_date: '2020-01-01' }).success).toBe(true)
  })
})

describe('orderStatusSchema', () => {
  it('accepts every documented status', () => {
    for (const s of ORDER_STATUSES) {
      expect(orderStatusSchema.safeParse({ id: CUST, status: s }).success).toBe(true)
    }
  })

  it('rejects an unknown status', () => {
    expect(orderStatusSchema.safeParse({ id: CUST, status: 'shipped' }).success).toBe(false)
  })
})
