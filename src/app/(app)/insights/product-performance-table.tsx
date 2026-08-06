'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { PackageSearch } from 'lucide-react'
import { DataTable } from '@/components/app/data-table/data-table'
import { ColumnHeader } from '@/components/app/data-table/column-header'
import { NoDataYet } from '@/components/app/empty-state'
import { Money } from '@/components/app/money'
import { cn } from '@/lib/utils'
import type { ProductPerformance } from '@/lib/queries/insights'

function marginPctTone(pct: number): string {
  if (pct < 0) return 'font-semibold text-destructive'
  if (pct < 20) return 'text-amber-600 dark:text-amber-500'
  return 'text-emerald-600 dark:text-emerald-500'
}

function MarginPctCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground">—</span>
  // pct is a PERCENTAGE, not money — this is not the banned money toFixed.
  return (
    <span className={cn('tabular-nums', marginPctTone(pct))}>
      {pct.toFixed(1)}%{pct < 0 ? ' Loss' : ''}
    </span>
  )
}

const columns: ColumnDef<ProductPerformance, unknown>[] = [
  {
    accessorKey: 'product_name',
    header: ({ column }) => <ColumnHeader column={column} title="Product" />,
    cell: ({ row }) => <span className="font-medium">{row.original.product_name}</span>,
  },
  {
    accessorKey: 'units_sold',
    header: ({ column }) => <ColumnHeader column={column} title="Units" />,
    meta: { align: 'right' },
    cell: ({ row }) => <span>{row.original.units_sold}</span>,
  },
  {
    accessorKey: 'revenue',
    header: ({ column }) => <ColumnHeader column={column} title="Revenue" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={row.original.revenue} />,
  },
  {
    accessorKey: 'cost',
    header: ({ column }) => <ColumnHeader column={column} title="Cost" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={row.original.cost} />,
  },
  {
    accessorKey: 'margin',
    header: ({ column }) => <ColumnHeader column={column} title="Margin" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={row.original.margin} />,
  },
  {
    accessorKey: 'margin_pct',
    header: ({ column }) => <ColumnHeader column={column} title="Margin %" />,
    meta: { align: 'right' },
    cell: ({ row }) => <MarginPctCell pct={row.original.margin_pct} />,
  },
]

/**
 * There are six products, so no search box and no real pagination —
 * pageSize={100} keeps everything on one page. There is nothing to filter,
 * so the "no data yet" / "no results" split collapses to one empty state.
 */
export function ProductPerformanceTable({ rows }: { rows: ProductPerformance[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Product performance</h2>
      <DataTable
        columns={columns}
        data={rows}
        pageSize={100}
        initialSorting={[{ id: 'revenue', desc: true }]}
        emptyState={
          <NoDataYet
            icon={<PackageSearch className="size-10" aria-hidden />}
            title="No sales in this period"
            description="Pick a wider period, or record some orders."
          />
        }
        renderMobileCard={(p) => (
          <div>
            <div className="font-medium">{p.product_name}</div>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                {p.units_sold} units · <Money value={p.revenue} />
              </span>
              <span>·</span>
              <MarginPctCell pct={p.margin_pct} />
            </div>
          </div>
        )}
      />
    </section>
  )
}
