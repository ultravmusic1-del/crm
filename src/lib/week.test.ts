import { describe, expect, it } from 'vitest'
import { resolveWeek, shiftWeek } from '@/lib/week'

describe('resolveWeek', () => {
  it('defaults to the Monday–Sunday week containing today', () => {
    // 2026-08-06 is a Thursday.
    expect(resolveWeek(undefined, new Date('2026-08-06T09:00:00.000Z')))
      .toEqual({ from: '2026-08-03', to: '2026-08-09' })
  })

  it('treats Sunday as the END of the week, not the start', () => {
    // 2026-08-09 is a Sunday. With weekStartsOn Monday it belongs to the
    // week beginning 2026-08-03 — a Sunday-start default would silently
    // shift every bake list by a day.
    expect(resolveWeek(undefined, new Date('2026-08-09T09:00:00.000Z')))
      .toEqual({ from: '2026-08-03', to: '2026-08-09' })
  })

  it('snaps an arbitrary date param to its containing week', () => {
    expect(resolveWeek('2026-08-06', new Date('2026-01-01T00:00:00.000Z')))
      .toEqual({ from: '2026-08-03', to: '2026-08-09' })
  })

  it('falls back to the current week for a malformed param', () => {
    expect(resolveWeek('not-a-date', new Date('2026-08-06T09:00:00.000Z')))
      .toEqual({ from: '2026-08-03', to: '2026-08-09' })
  })
})

describe('shiftWeek', () => {
  it('moves forward one week', () => {
    expect(shiftWeek('2026-08-03', 1)).toBe('2026-08-10')
  })

  it('moves back one week across a month boundary', () => {
    expect(shiftWeek('2026-08-03', -1)).toBe('2026-07-27')
  })
})
