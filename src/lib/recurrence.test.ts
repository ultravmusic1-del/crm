import { describe, expect, it } from 'vitest'
import { nextOccurrences, type SchedulePattern } from '@/lib/recurrence'

// 2026-08-06 is a Thursday. date-fns getDay(): Sun=0 … Thu=4.
const THURSDAY = new Date('2026-08-06T09:00:00.000Z')

describe('nextOccurrences — weekly', () => {
  const s: SchedulePattern = {
    frequency: 'weekly',
    day_of_week: 2, // Tuesday, since 0 = Sunday
    day_of_month: null,
    starts_on: '2026-08-01',
    ends_on: null,
  }

  it('lists consecutive Tuesdays from today', () => {
    expect(nextOccurrences(s, 4, THURSDAY)).toEqual([
      '2026-08-11', '2026-08-18', '2026-08-25', '2026-09-01',
    ])
  })

  it('includes today when today IS the day', () => {
    expect(nextOccurrences({ ...s, day_of_week: 4 }, 1, THURSDAY)).toEqual(['2026-08-06'])
  })

  it('never starts before starts_on', () => {
    expect(nextOccurrences({ ...s, starts_on: '2026-09-01' }, 1, THURSDAY)[0]).toBe('2026-09-01')
  })

  it('stops at ends_on', () => {
    expect(nextOccurrences({ ...s, ends_on: '2026-08-20' }, 8, THURSDAY))
      .toEqual(['2026-08-11', '2026-08-18'])
  })

  it('returns an empty list once ends_on has passed', () => {
    expect(nextOccurrences({ ...s, ends_on: '2026-01-01' }, 8, THURSDAY)).toEqual([])
  })
})

describe('nextOccurrences — fortnightly', () => {
  // starts_on 2026-08-04 is a Tuesday. Parity anchors HERE, not on the
  // epoch: weeks 0, 2, 4 … from starts_on are due.
  const s: SchedulePattern = {
    frequency: 'fortnightly',
    day_of_week: 2,
    day_of_month: null,
    starts_on: '2026-08-04',
    ends_on: null,
  }

  it('skips every other Tuesday, anchored on starts_on', () => {
    expect(nextOccurrences(s, 4, THURSDAY)).toEqual([
      '2026-08-18', '2026-09-01', '2026-09-15', '2026-09-29',
    ])
  })

  it('shifting starts_on by one week flips the parity', () => {
    expect(nextOccurrences({ ...s, starts_on: '2026-08-11' }, 3, THURSDAY)).toEqual([
      '2026-08-11', '2026-08-25', '2026-09-08',
    ])
  })
})

describe('nextOccurrences — monthly', () => {
  const s: SchedulePattern = {
    frequency: 'monthly',
    day_of_week: null,
    day_of_month: 15,
    starts_on: '2026-01-01',
    ends_on: null,
  }

  it('lists the 15th of each month', () => {
    expect(nextOccurrences(s, 3, THURSDAY)).toEqual([
      '2026-08-15', '2026-09-15', '2026-10-15',
    ])
  })

  it('handles day 28 in February without a 31st-of-February problem', () => {
    const dates = nextOccurrences({ ...s, day_of_month: 28 }, 8, new Date('2027-01-01T09:00:00.000Z'))
    expect(dates).toContain('2027-02-28')
    expect(dates.every((d) => d.endsWith('-28'))).toBe(true)
  })
})

describe('nextOccurrences — guards', () => {
  it('terminates rather than looping forever on an impossible pattern', () => {
    expect(nextOccurrences({
      frequency: 'weekly',
      day_of_week: null, // constraint-violating; defend anyway
      day_of_month: null,
      starts_on: '2026-08-01',
      ends_on: null,
    }, 8, THURSDAY)).toEqual([])
  })
})
