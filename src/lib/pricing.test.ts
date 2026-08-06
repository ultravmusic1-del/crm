import { describe, expect, it } from 'vitest'
import { pickPrice, marginPercent, recipeCost } from '@/lib/pricing'

describe('pickPrice', () => {
  it('prefers a custom price over the tier price', () => {
    expect(pickPrice({ customPrice: '0.400', wholesalePrice: '0.500', retailPrice: '0.800', priceTier: 'wholesale' }))
      .toEqual({ unitPrice: 0.4, source: 'custom' })
  })

  it('uses the wholesale price for a wholesale customer with no override', () => {
    expect(pickPrice({ customPrice: null, wholesalePrice: '0.500', retailPrice: '0.800', priceTier: 'wholesale' }))
      .toEqual({ unitPrice: 0.5, source: 'wholesale' })
  })

  it('uses the retail price for a retail customer with no override', () => {
    expect(pickPrice({ customPrice: null, wholesalePrice: '0.500', retailPrice: '0.800', priceTier: 'retail' }))
      .toEqual({ unitPrice: 0.8, source: 'retail' })
  })

  it('honours a custom price even when it is HIGHER than the tier price', () => {
    // "Override" means override, not "discount".
    expect(pickPrice({ customPrice: '0.900', wholesalePrice: '0.500', retailPrice: '0.800', priceTier: 'wholesale' }))
      .toEqual({ unitPrice: 0.9, source: 'custom' })
  })

  it('throws when the resolved price is zero', () => {
    // A zero price is far more likely a missing setup than a genuine
    // freebie, and must fail loudly rather than write a 0 into an order.
    expect(() => pickPrice({ customPrice: null, wholesalePrice: '0.000', retailPrice: '0.800', priceTier: 'wholesale' }))
      .toThrow(/no price/i)
  })

  it('throws on a zero CUSTOM price too, not just a zero tier price', () => {
    expect(() => pickPrice({ customPrice: '0.000', wholesalePrice: '0.500', retailPrice: '0.800', priceTier: 'wholesale' }))
      .toThrow(/no price/i)
  })

  it('names the product in the error so the message is actionable', () => {
    expect(() => pickPrice({ customPrice: null, wholesalePrice: '0', retailPrice: '0', priceTier: 'wholesale' }, 'Almond Bar'))
      .toThrow(/Almond Bar/)
  })

  it('produces an error message that tells you exactly what to fix', () => {
    try {
      pickPrice({ customPrice: null, wholesalePrice: 0, retailPrice: '0.800', priceTier: 'wholesale' }, 'Cacao Bar')
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('Cacao Bar')
      expect(msg).toContain('wholesale')
      expect(msg).toContain('custom price')
    }
  })
})

describe('marginPercent', () => {
  it('computes margin as a percentage of price', () => {
    expect(marginPercent('0.500', '0.250')).toBe(50)
  })

  it('rounds to one decimal place', () => {
    expect(marginPercent('0.310', '0.250')).toBe(19.4)
  })

  it('returns a negative margin rather than clamping to zero', () => {
    // Selling below cost must be visible, not hidden.
    expect(marginPercent('0.200', '0.250')).toBe(-25)
  })

  it('returns null when the price is zero, instead of dividing by it', () => {
    expect(marginPercent('0', '0.250')).toBeNull()
  })
})

describe('recipeCost', () => {
  it('sums quantity times per-unit ingredient cost', () => {
    // 40g oats at 2.400 per 1000g = 0.096
    // 10g almonds at 6.000 per 500g = 0.120
    expect(recipeCost([
      { quantity: '40', packCost: '2.400', packSize: '1000' },
      { quantity: '10', packCost: '6.000', packSize: '500' },
    ])).toBeCloseTo(0.216, 6)
  })

  it('returns zero for an empty recipe', () => {
    expect(recipeCost([])).toBe(0)
  })

  it('throws rather than dividing by a zero pack size', () => {
    expect(() => recipeCost([{ quantity: '40', packCost: '2.400', packSize: '0' }]))
      .toThrow(/pack size/i)
  })
})
