import { describe, expect, it } from 'vitest'
import { formatMoney, type CurrencyFormat } from '@/lib/format'

const BHD: CurrencyFormat = {
  currency_symbol: 'BD',
  currency_decimals: 3,
}

const GBP: CurrencyFormat = {
  currency_symbol: '£',
  currency_decimals: 2,
}

describe('formatMoney', () => {
  it('renders BHD to three decimal places', () => {
    expect(formatMoney(1.5, BHD)).toBe('BD 1.500')
  })

  it('renders a two-decimal currency to two places', () => {
    expect(formatMoney(1.5, GBP)).toBe('£ 1.50')
  })

  it('accepts the numeric strings supabase-js returns for numeric columns', () => {
    // supabase-js returns numeric(12,3) as a string to avoid float loss.
    expect(formatMoney('12.250', BHD)).toBe('BD 12.250')
  })

  it('groups thousands', () => {
    expect(formatMoney(12345.6, BHD)).toBe('BD 12,345.600')
  })

  it('places the minus sign before the symbol, not after it', () => {
    expect(formatMoney(-1.5, BHD)).toBe('-BD 1.500')
  })

  it('renders zero rather than an em dash', () => {
    expect(formatMoney(0, BHD)).toBe('BD 0.000')
  })

  it('renders an em dash for null and undefined', () => {
    expect(formatMoney(null, BHD)).toBe('—')
    expect(formatMoney(undefined, BHD)).toBe('—')
  })

  it('renders an em dash rather than NaN for unparseable input', () => {
    expect(formatMoney('not a number', BHD)).toBe('—')
  })
})
