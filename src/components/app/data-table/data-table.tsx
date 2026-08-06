'use client'

import { type ReactNode, useMemo, useState } from 'react'
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { TablePagination } from './pagination'
import { cn } from '@/lib/utils'

/**
 * TanStack Table v8. In v9 `useReactTable` was renamed `useTable` and
 * features must be registered — if an upgrade ever lands, this import is
 * where it breaks first, which is exactly why v8 is pinned exactly.
 */
export function DataTable<TData>({
  columns,
  data,
  globalFilter,
  initialSorting = [],
  pageSize = 25,
  onRowClick,
  renderMobileCard,
  emptyState,
}: {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  globalFilter?: string
  initialSorting?: SortingState
  pageSize?: number
  onRowClick?: (row: TData) => void
  /** Below md, tables become cards — never a horizontally scrolling table. */
  renderMobileCard: (row: TData) => ReactNode
  emptyState: ReactNode
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: globalFilter ?? '' },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  })

  const rows = table.getRowModel().rows
  const isEmpty = table.getFilteredRowModel().rows.length === 0
  const mobileRows = useMemo(() => rows.map((r) => r.original), [rows])

  if (isEmpty) return <>{emptyState}</>

  return (
    <div>
      {/* Cards below md */}
      <div className="space-y-2 md:hidden">
        {mobileRows.map((row, i) => (
          <div
            key={i}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              'rounded-lg border p-3',
              onRowClick && 'cursor-pointer active:bg-accent/50',
            )}
          >
            {renderMobileCard(row)}
          </div>
        ))}
      </div>

      {/* Table from md up */}
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader className="sticky top-14 z-10 bg-background">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="h-12 hover:bg-transparent">
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'h-12',
                      header.column.columnDef.meta?.align === 'right' && 'text-right',
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn('h-12', onRowClick && 'cursor-pointer')}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      'h-12',
                      cell.column.columnDef.meta?.align === 'right' &&
                        'text-right tabular-nums',
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <TablePagination table={table} />
    </div>
  )
}
