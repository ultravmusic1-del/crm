import { format, isValid, parseISO } from 'date-fns'

/**
 * The only place in this codebase allowed to turn a number into a money
 * string. Spec §8 step 4 greps for violations — keep it that way.
 */
export type CurrencyFormat = {
  currency_symbol: string
  currency_decimals: number
}

export function formatMoney(
  value: number | string | null | undefined,
  fmt: CurrencyFormat,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'

  const body = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: fmt.currency_decimals,
    maximumFractionDigits: fmt.currency_decimals,
  }).format(Math.abs(n))

  return `${n < 0 ? '-' : ''}${fmt.currency_symbol} ${body}`
}

/** Accepts a `date` or `timestamptz` string from Postgres, or a Date. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? parseISO(value) : value
  return isValid(d) ? format(d, 'd MMM yyyy') : '—'
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? parseISO(value) : value
  return isValid(d) ? format(d, 'd MMM yyyy, HH:mm') : '—'
}

export function formatDateRange(
  from: string | Date,
  to: string | Date,
): string {
  const a = typeof from === 'string' ? parseISO(from) : from
  const b = typeof to === 'string' ? parseISO(to) : to
  if (!isValid(a) || !isValid(b)) return '—'
  const sameYear = a.getFullYear() === b.getFullYear()
  const sameMonth = sameYear && a.getMonth() === b.getMonth()
  if (sameMonth) return `${format(a, 'd')}–${format(b, 'd MMM yyyy')}`
  if (sameYear) return `${format(a, 'd MMM')} – ${format(b, 'd MMM yyyy')}`
  return `${format(a, 'd MMM yyyy')} – ${format(b, 'd MMM yyyy')}`
}

/**
 * Store phone numbers as typed, minus decorative whitespace. Spec §6.2:
 * never reject a phone number for its format.
 */
export function normalisePhone(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}
