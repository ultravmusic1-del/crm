import '@tanstack/react-table'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-unnecessary-type-constraint
  interface ColumnMeta<TData extends unknown, TValue> {
    /** Right-align with tabular figures — for numeric columns. */
    align?: 'left' | 'right'
  }
}
