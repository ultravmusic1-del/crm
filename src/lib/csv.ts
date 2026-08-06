export type CsvColumn<T> = {
  key: keyof T & string
  header: string
  /** Optional transform, e.g. a date or a currency code. */
  format?: (value: unknown, row: T) => string
}

const NEEDS_QUOTES = /[",\r\n]/
const FORMULA_START = /^[=+\-@\t\r]/

function escapeCell(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  let value = String(raw)

  // Formula injection: Excel and Google Sheets execute a cell beginning
  // with = + - or @ the moment the file is opened. Prefixing an
  // apostrophe is the standard neutralisation and is invisible in the
  // spreadsheet.
  if (FORMULA_START.test(value)) value = `'${value}`

  if (NEEDS_QUOTES.test(value) || value.startsWith("'")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: CsvColumn<T>[],
): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(',')]

  for (const row of rows) {
    lines.push(
      columns
        .map((c) => escapeCell(c.format ? c.format(row[c.key], row) : row[c.key]))
        .join(','),
    )
  }

  // CRLF: Excel treats a bare LF as a continuation in some locales.
  return lines.join('\r\n')
}
