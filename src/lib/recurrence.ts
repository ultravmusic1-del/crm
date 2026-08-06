import {
  addDays, differenceInCalendarDays, format, getDate, getDay,
  isAfter, parseISO, startOfDay,
} from 'date-fns'

export type Frequency = 'weekly' | 'fortnightly' | 'monthly'

export type SchedulePattern = {
  frequency: Frequency
  /** 0 = SUNDAY, matching Postgres extract(dow) and date-fns getDay(). */
  day_of_week: number | null
  /** 1–28. Capped in the schema so "the 31st of February" cannot arise. */
  day_of_month: number | null
  starts_on: string // yyyy-MM-dd
  ends_on: string | null
}

/**
 * This is the second implementation of the recurrence rule — the first is
 * `f_generate_scheduled_orders` in migration 0005 (plpgsql). The two MUST
 * stay behaviourally identical. `supabase/verify.sql` assertion P3.1
 * cross-checks the SQL side against the expectations in
 * `src/lib/recurrence.test.ts`; if you change one, change both.
 */
function matches(pattern: SchedulePattern, day: Date, start: Date): boolean {
  if (pattern.frequency === 'monthly') {
    return pattern.day_of_month !== null && getDate(day) === pattern.day_of_month
  }

  if (pattern.day_of_week === null) return false
  if (getDay(day) !== pattern.day_of_week) return false
  if (pattern.frequency === 'weekly') return true

  // Fortnightly parity is anchored on starts_on, NOT on the epoch or the
  // year boundary.
  return Math.floor(differenceInCalendarDays(day, start) / 7) % 2 === 0
}

export function nextOccurrences(
  pattern: SchedulePattern,
  count = 8,
  from: Date = new Date(),
): string[] {
  const start = startOfDay(parseISO(pattern.starts_on))
  const end = pattern.ends_on ? startOfDay(parseISO(pattern.ends_on)) : null
  const today = startOfDay(from)

  let cursor = isAfter(start, today) ? start : today
  const out: string[] = []

  // ~2 years. Enough for 8 monthly occurrences; stops an impossible pattern
  // from spinning the browser.
  const MAX_DAYS = 800

  for (let i = 0; i < MAX_DAYS && out.length < count; i += 1) {
    if (end && isAfter(cursor, end)) break
    if (matches(pattern, cursor, start)) out.push(format(cursor, 'yyyy-MM-dd'))
    cursor = addDays(cursor, 1)
  }

  return out
}
