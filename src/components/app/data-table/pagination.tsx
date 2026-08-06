'use client'

import type { Table } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'

/**
 * Pagination, never infinite scroll — business data means finding a
 * record and coming back to it.
 */
export function TablePagination<TData>({ table }: { table: Table<TData> }) {
  const total = table.getFilteredRowModel().rows.length
  const pageIndex = table.getState().pagination.pageIndex
  const pageSize = table.getState().pagination.pageSize
  const pageCount = Math.max(table.getPageCount(), 1)

  const first = total === 0 ? 0 : pageIndex * pageSize + 1
  const last = Math.min((pageIndex + 1) * pageSize, total)

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? 'No rows' : `${first}–${last} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-11 md:h-9"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <span className="text-sm tabular-nums">
          {pageIndex + 1} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-11 md:h-9"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
