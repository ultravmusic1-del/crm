import { addWeeks, endOfWeek, format, isValid, parseISO, startOfWeek } from 'date-fns'

export type Week = { from: string; to: string }

/**
 * Monday–Sunday. weekStartsOn: 1 everywhere in this app — the dashboard's
 * week summary, the production page and the insights period picker must
 * agree, or the same orders appear in two different weeks.
 */
const OPTS = { weekStartsOn: 1 as const }

export function resolveWeek(param: string | undefined, now: Date = new Date()): Week {
  const parsed = param ? parseISO(param) : null
  const anchor = parsed && isValid(parsed) ? parsed : now
  return {
    from: format(startOfWeek(anchor, OPTS), 'yyyy-MM-dd'),
    to: format(endOfWeek(anchor, OPTS), 'yyyy-MM-dd'),
  }
}

export function shiftWeek(from: string, by: number): string {
  return format(addWeeks(parseISO(from), by), 'yyyy-MM-dd')
}
