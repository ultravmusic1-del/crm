import { isValid, parseISO } from 'date-fns'

/**
 * The only place in this codebase allowed to turn a number into a money
 * string. Spec §8 step 4 greps for violations — keep it that way.
 */
export type CurrencyFormat = {
  currency_symbol: string
  currency_decimals: number
}

/** The bakery's operating timezone. Used as the default for all instant
 * (timestamptz) formatting. A later task reads the real value from
 * `app_settings.timezone` and passes it through explicitly. */
export const BUSINESS_TIME_ZONE = 'Asia/Bahrain'

/** The single sentinel for "nothing to show" across this module. */
export const NO_VALUE = '—'

// Postgres emits numeric(p,s) columns as plain decimal strings: optional
// leading '-', digits, optional '.digits'. Nothing else — no whitespace, no
// hex, no exponents — is a value this app should ever treat as money.
const NUMERIC_STRING_RE = /^-?\d+(\.\d+)?$/

// A `date` column value: 'YYYY-MM-DD', a calendar date with no instant
// attached. Must never go through timezone conversion.
const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Money formatters are expensive to construct (measured ~45x slower than
 * formatting itself). Cache one per decimal count, module-lifetime. */
const moneyFormatterCache = new Map<number, Intl.NumberFormat>()

function getMoneyFormatter(decimals: number): Intl.NumberFormat {
  let formatter = moneyFormatterCache.get(decimals)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    moneyFormatterCache.set(decimals, formatter)
  }
  return formatter
}

/** `currency_decimals` comes from a database row — `number` is an
 * assertion, not a guarantee. A value outside 0..6 (or not an integer at
 * all) is corrupt data, not a badly-expressed preference — the same
 * category as NaN — so it falls back to 3 (BHD's own precision) rather
 * than being clamped into a plausible-looking but wrong precision. */
function resolveDecimals(decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) return 3
  return decimals
}

export function formatMoney(
  value: number | string | null | undefined,
  fmt: CurrencyFormat,
): string {
  if (value === null || value === undefined || value === '') return NO_VALUE

  let n: number
  if (typeof value === 'string') {
    if (!NUMERIC_STRING_RE.test(value)) return NO_VALUE
    n = Number(value)
  } else {
    n = value
  }
  if (!Number.isFinite(n)) return NO_VALUE

  const decimals = resolveDecimals(fmt.currency_decimals)
  const body = getMoneyFormatter(decimals).format(Math.abs(n))

  return `${n < 0 ? '-' : ''}${fmt.currency_symbol} ${body}`
}

function calendarDateFromPlainString(value: string): Date | null {
  // Represent the calendar date as UTC noon: far enough from midnight
  // that no timezone or DST shift can push it into an adjacent day when
  // later read back out.
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d, 12))
  // Date.UTC normalises overflow (Feb 30 -> Mar 2) and maps years 0-99
  // into the 1900s. Reject anything it silently rewrote.
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null
  }
  return date
}

function formatInstantDatePart(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(d)
}

function formatInstantTimePart(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(d)
}

/**
 * Accepts a `date` or `timestamptz` string from Postgres, or a Date.
 *
 * `date` values ('YYYY-MM-DD') are calendar dates with no instant attached
 * and are rendered as-is, in no timezone. Everything else — an ISO instant
 * string, or a `Date` — is converted into `timeZone` before rendering,
 * because the server may run in UTC while the business is in Bahrain.
 */
export function formatDate(
  value: string | Date | null | undefined,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  if (!value) return NO_VALUE

  if (typeof value === 'string' && PLAIN_DATE_RE.test(value)) {
    const d = calendarDateFromPlainString(value)
    return d ? formatInstantDatePart(d, 'UTC') : NO_VALUE
  }

  const d = typeof value === 'string' ? parseISO(value) : value
  return isValid(d) ? formatInstantDatePart(d, timeZone) : NO_VALUE
}

/**
 * Accepts a `timestamptz` string from Postgres, or a Date. Always an
 * instant — converted into `timeZone` before rendering.
 *
 * A plain `date` string ('YYYY-MM-DD') has no time-of-day, so inventing
 * midnight for it would be a lie regardless of which timezone we pick —
 * that value belongs to `formatDate`, not here. Reject it rather than
 * silently rendering the wrong day.
 */
export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  if (!value) return NO_VALUE
  if (typeof value === 'string' && PLAIN_DATE_RE.test(value)) return NO_VALUE
  const d = typeof value === 'string' ? parseISO(value) : value
  if (!isValid(d)) return NO_VALUE
  return `${formatInstantDatePart(d, timeZone)}, ${formatInstantTimePart(d, timeZone)}`
}

type YMD = { y: number; m: number; d: number } // m is 1-based

function toYMD(value: string | Date, timeZone: string): YMD | null {
  if (typeof value === 'string' && PLAIN_DATE_RE.test(value)) {
    const date = calendarDateFromPlainString(value)
    if (!date) return null
    return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }
  }

  const dateObj = typeof value === 'string' ? parseISO(value) : value
  if (!isValid(dateObj)) return null

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateObj)
  const y = Number(parts.find((p) => p.type === 'year')?.value)
  const m = Number(parts.find((p) => p.type === 'month')?.value)
  const d = Number(parts.find((p) => p.type === 'day')?.value)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
  return { y, m, d }
}

function renderYMD(ymd: YMD, withYear: boolean): string {
  const d = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12))
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(d)
}

/**
 * Renders an inclusive date range, collapsing to a single date when both
 * ends fall on the same day and rejecting a reversed range outright.
 * `from`/`to` follow the same calendar-date-vs-instant rule as
 * `formatDate`.
 */
export function formatDateRange(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  if (!from || !to) return NO_VALUE

  const a = toYMD(from, timeZone)
  const b = toYMD(to, timeZone)
  if (!a || !b) return NO_VALUE

  const aTime = Date.UTC(a.y, a.m - 1, a.d)
  const bTime = Date.UTC(b.y, b.m - 1, b.d)
  if (aTime > bTime) return NO_VALUE
  if (aTime === bTime) return renderYMD(a, true)

  const sameYear = a.y === b.y
  const sameMonth = sameYear && a.m === b.m
  if (sameMonth) return `${a.d}–${renderYMD(b, true)}`
  if (sameYear) return `${renderYMD(a, false)} – ${renderYMD(b, true)}`
  return `${renderYMD(a, true)} – ${renderYMD(b, true)}`
}

// Ordinary whitespace, plus the invisible characters phones pasted from
// WhatsApp in a bilingual Arabic/English market routinely carry: zero-width
// space (U+200B), the LRM/RLM bidi marks (U+200E/U+200F), the Arabic
// Letter Mark (U+061C), and the directional isolate marks (U+2066-U+2069).
const INVISIBLE_RE = /[\u200B\u200E\u200F\u061C\u2066-\u2069]/g

/**
 * Store phone numbers as typed, minus decorative whitespace and invisible
 * characters. Spec §6.2: never reject a phone number for its format.
 */
export function normalisePhone(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim()
  return trimmed.length > 0 ? trimmed : null
}
