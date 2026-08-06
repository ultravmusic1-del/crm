import {
  endOfMonth, endOfYear, format, isValid, parseISO,
  startOfMonth, startOfYear, subDays, subMonths,
} from 'date-fns'

export type PeriodKey = 'this_month' | 'last_month' | 'last_90' | 'this_year' | 'custom'

export type Period = { key: PeriodKey; from: string; to: string }

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_90',    label: 'Last 90 days' },
  { key: 'this_year',  label: 'This year' },
  { key: 'custom',     label: 'Custom' },
]

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

export function resolvePeriod(
  key: string | undefined,
  from: string | undefined,
  to: string | undefined,
  now: Date = new Date(),
): Period {
  if (key === 'last_month') {
    const m = subMonths(now, 1)
    return { key: 'last_month', from: iso(startOfMonth(m)), to: iso(endOfMonth(m)) }
  }
  if (key === 'last_90') {
    return { key: 'last_90', from: iso(subDays(now, 89)), to: iso(now) }
  }
  if (key === 'this_year') {
    return { key: 'this_year', from: iso(startOfYear(now)), to: iso(endOfYear(now)) }
  }
  if (key === 'custom' && from && to) {
    const a = parseISO(from)
    const b = parseISO(to)
    if (isValid(a) && isValid(b) && from <= to) {
      return { key: 'custom', from, to }
    }
  }
  return { key: 'this_month', from: iso(startOfMonth(now)), to: iso(endOfMonth(now)) }
}
