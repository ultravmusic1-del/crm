import { describe, expect, it } from 'vitest'
import { settingsSchema } from '@/lib/schemas/settings'

const validSettings = {
  business_name: 'Oat Bar Bakery',
  business_email: 'hello@oatbar.example',
  business_phone: '+973 1234 5678',
  address_line1: 'Building 123, Road 456',
  address_line2: 'Block 789',
  city: 'Manama',
  postcode: '1234',
  country: 'Bahrain',
  timezone: 'Asia/Bahrain',
  currency_code: 'BHD',
  currency_symbol: 'BD',
  invoice_prefix: 'INV-',
  currency_decimals: 3,
  default_payment_terms_days: 14,
  lapse_threshold_days: 45,
  bank_name: 'Bank of Bahrain',
  bank_account_name: 'Oat Bar Bakery WLL',
  bank_account_number: '1234567890',
  bank_iban: 'BH00BANK00001234567890',
  bank_swift: 'BBMEBHBX',
}

describe('settingsSchema', () => {
  it('accepts a complete valid object', () => {
    const r = settingsSchema.safeParse(validSettings)
    expect(r.success).toBe(true)
  })

  it('rejects a whitespace-only business_name', () => {
    const r = settingsSchema.safeParse({ ...validSettings, business_name: '   ' })
    expect(r.success).toBe(false)
  })

  it('rejects currency_decimals of 4 and of -1', () => {
    const tooHigh = settingsSchema.safeParse({ ...validSettings, currency_decimals: 4 })
    const tooLow = settingsSchema.safeParse({ ...validSettings, currency_decimals: -1 })
    expect(tooHigh.success).toBe(false)
    expect(tooLow.success).toBe(false)
  })

  it('rejects lapse_threshold_days of 0 — a zero threshold would flag every customer as lapsed', () => {
    const r = settingsSchema.safeParse({ ...validSettings, lapse_threshold_days: 0 })
    expect(r.success).toBe(false)
  })

  it('turns blank optional text into null, not empty string', () => {
    const r = settingsSchema.parse({ ...validSettings, bank_iban: '   ' })
    expect(r.bank_iban).toBeNull()
  })

  it('rejects a malformed business_email but accepts an empty one', () => {
    const bad = settingsSchema.safeParse({ ...validSettings, business_email: 'not-an-email' })
    expect(bad.success).toBe(false)

    const empty = settingsSchema.parse({ ...validSettings, business_email: '' })
    expect(empty.business_email).toBeNull()
  })

  it('strips next_invoice_number — it is allocated atomically in Phase 5, not settable from this form', () => {
    const r = settingsSchema.parse({ ...validSettings, next_invoice_number: 999 })
    expect(r).not.toHaveProperty('next_invoice_number')
  })
})
