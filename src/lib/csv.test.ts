import { describe, expect, it } from 'vitest'
import { toCsv } from '@/lib/csv'

describe('toCsv', () => {
  it('writes a header row from the column definitions', () => {
    const csv = toCsv([{ a: 1 }], [{ key: 'a', header: 'Alpha' }])
    expect(csv.split('\r\n')[0]).toBe('Alpha')
  })

  it('quotes a value containing a comma', () => {
    const csv = toCsv([{ a: 'Manama, Bahrain' }], [{ key: 'a', header: 'City' }])
    expect(csv).toContain('"Manama, Bahrain"')
  })

  it('doubles embedded quotes', () => {
    const csv = toCsv([{ a: 'The "Good" Café' }], [{ key: 'a', header: 'Name' }])
    expect(csv).toContain('"The ""Good"" Café"')
  })

  it('quotes a value containing a newline', () => {
    const csv = toCsv([{ a: 'line1\nline2' }], [{ key: 'a', header: 'Notes' }])
    expect(csv).toContain('"line1\nline2"')
  })

  it('renders null and undefined as an empty field, not "null"', () => {
    // Two empty cells joined by the field delimiter is a bare comma, not
    // an empty string — this checks each field is empty, not literally
    // "null" or "undefined".
    const csv = toCsv(
      [{ a: null, b: undefined }],
      [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }],
    )
    expect(csv.split('\r\n')[1]).toBe(',')
  })

  it('neutralises a formula-injection payload', () => {
    // A cell starting with = + - or @ is executed by Excel and Sheets on
    // open. A customer named "=cmd|..." must not become a live formula in
    // a file she double-clicks.
    for (const payload of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      const csv = toCsv([{ a: payload }], [{ key: 'a', header: 'A' }])
      expect(csv.split('\r\n')[1]).toBe(`"'${payload}"`)
    }
  })

  it('uses CRLF line endings so Excel does not run the rows together', () => {
    const csv = toCsv([{ a: 1 }, { a: 2 }], [{ key: 'a', header: 'A' }])
    expect(csv).toBe('A\r\n1\r\n2')
  })

  it('returns just the header row for an empty dataset', () => {
    expect(toCsv([], [{ key: 'a', header: 'A' }])).toBe('A')
  })
})
