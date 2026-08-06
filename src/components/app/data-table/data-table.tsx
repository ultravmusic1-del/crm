'use client'

import { Fragment, type ReactNode, useMemo, useState } from 'react'
import {
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
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
  rowSelection,
  onRowSelectionChange,
  getRowId,
  groupBy,
  renderGroupHeader,
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
  /**
   * Additive, optional bulk-selection support — existing callers that omit
   * all three of these keep working unchanged. Pass all three together
   * (e.g. the orders list): the caller owns the `select` checkbox column
   * definition and the selection state; DataTable only wires them into
   * TanStack Table so `row.getIsSelected()` / `row.toggleSelected()` work
   * inside that column's cell renderer.
   */
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  getRowId?: (row: TData) => string
  /**
   * Additive, optional grouping: inserts a full-width subheading row (or,
   * on mobile, a heading line) before the first row of each new group.
   * Assumes `data` arrives already sorted by whatever `groupBy` returns —
   * TanStack's own sort/filter can reorder rows and break contiguity into
   * duplicate group headers, an accepted trade-off for a visual aid that
   * only orders' "upcoming" view opts into.
   */
  groupBy?: (row: TData) => string
  renderGroupHeader?: (groupKey: string) => ReactNode
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: globalFilter ?? '', rowSelection: rowSelection ?? {} },
    onSortingChange: setSorting,
    onRowSelectionChange,
    enableRowSelection: Boolean(onRowSelectionChange),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
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

  let lastMobileGroup: string | undefined
  let lastDesktopGroup: string | undefined

  return (
    <div>
      {/* Cards below md */}
      <div className="space-y-2 md:hidden">
        {mobileRows.map((row, i) => {
          const groupKey = groupBy?.(row)
          const showHeader = Boolean(groupBy) && groupKey !== lastMobileGroup
          if (showHeader) lastMobileGroup = groupKey
          return (
            <Fragment key={i}>
              {showHeader && renderGroupHeader ? (
                <div className="px-1 pt-2 text-xs font-medium text-muted-foreground">
                  {renderGroupHeader(groupKey!)}
                </div>
              ) : null}
              <div
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'rounded-lg border p-3',
                  onRowClick && 'cursor-pointer active:bg-accent/50',
                )}
              >
                {renderMobileCard(row)}
              </div>
            </Fragment>
          )
        })}
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
            {rows.map((row) => {
              const groupKey = groupBy?.(row.original)
              const showHeader = Boolean(groupBy) && groupKey !== lastDesktopGroup
              if (showHeader) lastDesktopGroup = groupKey
              return (
                <Fragment key={row.id}>
                  {showHeader && renderGroupHeader ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={columns.length}
                        className="h-9 bg-muted/50 text-xs font-medium text-muted-foreground"
                      >
                        {renderGroupHeader(groupKey!)}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  <TableRow
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
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <TablePagination table={table} />
    </div>
  )
}
