import { describe, expect, it } from 'vitest'
import { customerSchema, CUSTOMER_STATUSES } from '@/lib/schemas/customers'

describe('customerSchema', () => {
  it('accepts a customer with nothing but a name', () => {
    // "Only Name required" is a Phase 1 acceptance criterion, so it is a
    // test, not a comment.
    const r = customerSchema.safeParse({ name: 'Café Lila' })
    expect(r.success).toBe(true)
  })

  it('applies the documented defaults when fields are omitted', () => {
    const r = customerSchema.parse({ name: 'Café Lila' })
    expect(r.status).toBe('lead')
    expect(r.type).toBe('business')
    expect(r.price_tier).toBe('wholesale')
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(customerSchema.safeParse({ name: '' }).success).toBe(false)
    expect(customerSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('trims the name', () => {
    expect(customerSchema.parse({ name: '  Café Lila  ' }).name).toBe('Café Lila')
  })

  it('turns blank optional fields into null, not empty string', () => {
    const r = customerSchema.parse({ name: 'X', email: '', city: '  ' })
    expect(r.email).toBeNull()
    expect(r.city).toBeNull()
  })

  it('rejects a malformed email but allows a blank one', () => {
    expect(customerSchema.safeParse({ name: 'X', email: 'nope' }).success).toBe(false)
    expect(customerSchema.parse({ name: 'X', email: '' }).email).toBeNull()
  })

  it('accepts any phone format and only collapses whitespace', () => {
    // Baymard: format-rejection causes real abandonment. Never reject a
    // phone number for how it is punctuated.
    for (const p of ['+973 3300 1122', '(973) 3300-1122', '33001122', '973.3300.1122']) {
      expect(customerSchema.safeParse({ name: 'X', phone: p }).success).toBe(true)
    }
    expect(customerSchema.parse({ name: 'X', phone: ' +973  3300 1122 ' }).phone)
      .toBe('+973 3300 1122')
  })

  it('rejects a status outside the enum', () => {
    expect(customerSchema.safeParse({ name: 'X', status: 'prospect' }).success).toBe(false)
  })

  it('exports the statuses in the order the UI should show them', () => {
    expect(CUSTOMER_STATUSES).toEqual([
      'lead', 'contacted', 'sampling', 'active', 'lapsed', 'lost',
    ])
  })
})
