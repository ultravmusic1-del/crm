import { describe, expect, it } from 'vitest'
import { resolvePeriod, PERIOD_OPTIONS } from '@/lib/period'

const NOW = new Date('2026-08-06T09:00:00.000Z') // Thursday

describe('resolvePeriod', () => {
  it('defaults to this month', () => {
    expect(resolvePeriod(undefined, undefined, undefined, NOW)).toEqual({
      key: 'this_month', from: '2026-08-01', to: '2026-08-31',
    })
  })

  it('resolves last month across a year boundary', () => {
    expect(resolvePeriod('last_month', undefined, undefined, new Date('2027-01-15T00:00:00.000Z')))
      .toEqual({ key: 'last_month', from: '2026-12-01', to: '2026-12-31' })
  })

  it('resolves the last 90 days inclusive of today', () => {
    const r = resolvePeriod('last_90', undefined, undefined, NOW)
    expect(r.to).toBe('2026-08-06')
    expect(r.from).toBe('2026-05-09')
  })

  it('resolves this year', () => {
    expect(resolvePeriod('this_year', undefined, undefined, NOW)).toEqual({
      key: 'this_year', from: '2026-01-01', to: '2026-12-31',
    })
  })

  it('honours a custom range', () => {
    expect(resolvePeriod('custom', '2026-03-01', '2026-03-31', NOW)).toEqual({
      key: 'custom', from: '2026-03-01', to: '2026-03-31',
    })
  })

  it('falls back to this month when custom dates are missing or reversed', () => {
    expect(resolvePeriod('custom', undefined, undefined, NOW).key).toBe('this_month')
    expect(resolvePeriod('custom', '2026-03-31', '2026-03-01', NOW).key).toBe('this_month')
  })

  it('falls back to this month for an unknown key', () => {
    expect(resolvePeriod('last_decade', undefined, undefined, NOW).key).toBe('this_month')
  })

  it('exports options in the order the picker should show them', () => {
    expect(PERIOD_OPTIONS.map((o) => o.key)).toEqual([
      'this_month', 'last_month', 'last_90', 'this_year', 'custom',
    ])
  })
})
