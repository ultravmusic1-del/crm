import { describe, expect, it } from 'vitest'
import {
  BUSINESS_TIME_ZONE,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatMoney,
  NO_VALUE,
  normalisePhone,
  parseMoney,
  type CurrencyFormat,
} from '@/lib/format'

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

  it('renders the sentinel for null and undefined', () => {
    expect(formatMoney(null, BHD)).toBe(NO_VALUE)
    expect(formatMoney(undefined, BHD)).toBe(NO_VALUE)
  })

  it('renders the sentinel rather than NaN for unparseable input', () => {
    expect(formatMoney('not a number', BHD)).toBe(NO_VALUE)
  })

  it('renders the sentinel for a whitespace-only string rather than treating it as zero', () => {
    // Number('   ') === 0 — must not silently become "an invoice for nothing".
    expect(formatMoney('   ', BHD)).toBe(NO_VALUE)
  })

  it('renders the sentinel for a hex-looking string rather than coercing it', () => {
    // Number('0x10') === 16 — Postgres numeric never emits this shape.
    expect(formatMoney('0x10', BHD)).toBe(NO_VALUE)
  })

  it('falls back to three decimals when currency_decimals is unusable, without throwing', () => {
    const corrupt: CurrencyFormat = { currency_symbol: 'BD', currency_decimals: null as never }
    expect(() => formatMoney(1.5, corrupt)).not.toThrow()
    expect(formatMoney(1.5, corrupt)).toBe('BD 1.500')
  })

  it('falls back to three decimals for an out-of-range currency_decimals rather than clamping it', () => {
    // -4 and 40 are corrupt data, not badly-expressed preferences — the
    // same category as NaN. Clamping them would render plausible-looking
    // money at the wrong precision (e.g. whole units instead of thousandths).
    expect(() =>
      formatMoney(1.5, { currency_symbol: 'BD', currency_decimals: -4 }),
    ).not.toThrow()
    expect(formatMoney(1.5, { currency_symbol: 'BD', currency_decimals: -4 })).toBe('BD 1.500')
    expect(formatMoney(1.5, { currency_symbol: 'BD', currency_decimals: 40 })).toBe('BD 1.500')
  })

  it('keeps a legitimate zero-decimal currency at zero decimals', () => {
    expect(formatMoney(1.5, { currency_symbol: '¥', currency_decimals: 0 })).toBe('¥ 2')
  })

  it('rounds half-away-from-zero at the least significant rendered decimal', () => {
    expect(formatMoney('1.0005', BHD)).toBe('BD 1.001')
    expect(formatMoney('1.0015', BHD)).toBe('BD 1.002')
  })

  it('renders the full numeric(12,3) precision ceiling', () => {
    expect(formatMoney('999999999.999', BHD)).toBe('BD 999,999,999.999')
  })
})

describe('formatDate', () => {
  it('renders a plain date column with no timezone conversion', () => {
    expect(formatDate('2026-08-06')).toBe('6 Aug 2026')
    // A calendar date is the same date everywhere on earth.
    expect(formatDate('2026-08-06', 'Pacific/Kiritimati')).toBe('6 Aug 2026')
    expect(formatDate('2026-08-06', 'Etc/GMT+12')).toBe('6 Aug 2026')
  })

  it('shifts the calendar day when a timestamptz instant crosses midnight in the business timezone', () => {
    // 2026-08-06T21:30:00Z is 2026-08-07T00:30:00+03:00 in Bahrain.
    expect(formatDate('2026-08-06T21:30:00Z')).toBe('7 Aug 2026')
  })

  it('renders the sentinel for null and undefined', () => {
    expect(formatDate(null)).toBe(NO_VALUE)
    expect(formatDate(undefined)).toBe(NO_VALUE)
  })

  it('rejects an invalid plain date rather than letting Date.UTC roll it over', () => {
    // Date.UTC normalises overflow (Feb 30 -> Mar 2, month 13 -> next Feb)
    // and maps years 0-99 into the 1900s. None of that is "the date the
    // caller typed" and must not render as if it were.
    expect(formatDate('2026-02-30')).toBe(NO_VALUE)
    expect(formatDate('2026-13-45')).toBe(NO_VALUE)
    expect(formatDate('0099-08-06')).toBe(NO_VALUE)
  })
})

describe('formatDateTime', () => {
  it('converts a timestamptz instant into the business timezone by default', () => {
    expect(formatDateTime('2026-08-06T22:30:00+03:00')).toBe('6 Aug 2026, 22:30')
  })

  it('honours an explicit timeZone parameter and produces a different result', () => {
    expect(formatDateTime('2026-08-06T22:30:00+03:00', 'UTC')).toBe('6 Aug 2026, 19:30')
  })

  it('renders 24-hour time, never 12-hour with am/pm', () => {
    expect(formatDateTime('2026-08-06T21:30:00Z')).toBe('7 Aug 2026, 00:30')
  })

  it('defaults to Asia/Bahrain', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Asia/Bahrain')
  })

  it('rejects a plain date rather than inventing a midnight for it', () => {
    // A `date` column has no time-of-day. Under a non-Bahrain host TZ this
    // used to shift the calendar day (parseISO('2026-08-06') gives
    // host-local midnight); it must now be refused outright, in any TZ.
    expect(formatDateTime('2026-08-06')).toBe(NO_VALUE)
    expect(formatDateTime('2026-08-06', 'Pacific/Kiritimati')).toBe(NO_VALUE)
  })
})

describe('formatDateRange', () => {
  it('collapses a same-day range to a single date instead of "6–6 Aug 2026"', () => {
    expect(formatDateRange('2026-08-06', '2026-08-06')).toBe('6 Aug 2026')
  })

  it('rejects a reversed range rather than rendering it backwards', () => {
    expect(formatDateRange('2026-08-10', '2026-08-01')).toBe(NO_VALUE)
  })

  it('renders the sentinel for nullish input', () => {
    expect(formatDateRange(null, '2026-08-06')).toBe(NO_VALUE)
    expect(formatDateRange('2026-08-06', undefined)).toBe(NO_VALUE)
  })

  it('rejects an invalid plain date on either end rather than rolling it over', () => {
    expect(formatDateRange('2026-02-30', '2026-08-06')).toBe(NO_VALUE)
    expect(formatDateRange('2026-08-06', '2026-13-45')).toBe(NO_VALUE)
    expect(formatDateRange('0099-08-06', '2026-08-06')).toBe(NO_VALUE)
  })
})

describe('parseMoney', () => {
  it('parses the strings supabase-js returns for numeric columns', () => {
    expect(parseMoney('12.250')).toBe(12.25)
    expect(parseMoney('0.000')).toBe(0)
  })

  it('passes numbers through', () => {
    expect(parseMoney(1.5)).toBe(1.5)
  })

  it('treats null and undefined as zero', () => {
    expect(parseMoney(null)).toBe(0)
    expect(parseMoney(undefined)).toBe(0)
  })

  it('throws on genuinely unparseable input rather than returning NaN', () => {
    // A NaN silently poisoning a total is far worse than a 500.
    expect(() => parseMoney('abc')).toThrow()
  })
})

describe('normalisePhone', () => {
  it('strips invisible zero-width and bidi marks that WhatsApp pastes leave behind', () => {
    expect(normalisePhone('‎+973 1234​ 5678‏')).toBe('+973 1234 5678')
  })

  it('strips the Arabic Letter Mark and directional isolate marks', () => {
    expect(normalisePhone('؜+973⁦ 1234 5678⁩')).toBe('+973 1234 5678')
  })
})
