import { describe, expect, it } from 'vitest'
import { createInvoiceSchema, paymentSchema, adjustmentSchema } from '@/lib/schemas/invoices'

const CUST = '11111111-1111-4111-8111-111111111111'
const ORD1 = '22222222-2222-4222-8222-222222222222'
const ORD2 = '33333333-3333-4333-8333-333333333333'
const INV  = '44444444-4444-4444-8444-444444444444'

describe('createInvoiceSchema', () => {
  const valid = {
    customer_id: CUST,
    order_ids: [ORD1, ORD2],
    issued_on: '2026-08-06',
    due_on: '2026-08-20',
  }

  it('accepts a valid invoice request', () => {
    expect(createInvoiceSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects an invoice with no orders', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, order_ids: [] }).success).toBe(false)
  })

  it('rejects the same order twice', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, order_ids: [ORD1, ORD1] }).success).toBe(false)
  })

  it('rejects a due date before the issue date', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, due_on: '2026-08-05' }).success).toBe(false)
  })

  it('allows a due date equal to the issue date', () => {
    expect(createInvoiceSchema.safeParse({ ...valid, due_on: '2026-08-06' }).success).toBe(true)
  })
})

describe('paymentSchema', () => {
  const valid = { invoice_id: INV, amount: 20, paid_on: '2026-08-06', method: 'cash', reference: '' }

  it('accepts a valid payment', () => {
    expect(paymentSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a zero or negative amount', () => {
    expect(paymentSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false)
    expect(paymentSchema.safeParse({ ...valid, amount: -5 }).success).toBe(false)
  })

  it('allows a partial amount — partial payments are supported by design', () => {
    expect(paymentSchema.safeParse({ ...valid, amount: 0.001 }).success).toBe(true)
  })

  it('rejects a method outside the enum', () => {
    expect(paymentSchema.safeParse({ ...valid, method: 'bitcoin' }).success).toBe(false)
  })

  it('turns a blank method and reference into null', () => {
    const r = paymentSchema.parse({ ...valid, method: '', reference: '  ' })
    expect(r.method).toBeNull()
    expect(r.reference).toBeNull()
  })
})

describe('adjustmentSchema', () => {
  it('rejects a negative discount or delivery charge', () => {
    expect(adjustmentSchema.safeParse({ id: INV, discount_amount: -1, delivery_charge: 0 }).success).toBe(false)
    expect(adjustmentSchema.safeParse({ id: INV, discount_amount: 0, delivery_charge: -1 }).success).toBe(false)
  })
})
