'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarClock } from 'lucide-react'
import { DataTable } from '@/components/app/data-table/data-table'
import { ColumnHeader } from '@/components/app/data-table/column-header'
import { NoDataYet } from '@/components/app/empty-state'
import { DateDisplay } from '@/components/app/date-display'
import type { CustomerSummary } from '@/lib/queries/insights'

type Row = CustomerSummary & {
  customer_id: string
  avg_gap_days: number
  days_since_last_order: number
}

function hasCadence(c: CustomerSummary): c is Row {
  return (
    c.customer_id !== null &&
    (c.order_count ?? 0) >= 2 &&
    c.avg_gap_days !== null &&
    c.days_since_last_order !== null
  )
}

type Trend = 'Overdue' | 'Due soon' | 'On track'

function trendFor(row: Row): Trend {
  if (row.risk_flag) return 'Overdue'
  if (row.days_since_last_order > row.avg_gap_days) return 'Due soon'
  return 'On track'
}

function TrendCell({ trend }: { trend: Trend }) {
  const tone =
    trend === 'Overdue'
      ? 'text-destructive font-semibold'
      : trend === 'Due soon'
        ? 'text-amber-600 dark:text-amber-500'
        : 'text-emerald-600 dark:text-emerald-500'
  return <span className={tone}>{trend}</span>
}

const columns: ColumnDef<Row, unknown>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <ColumnHeader column={column} title="Customer" />,
    cell: ({ row }) => (
      <Link
        href={`/customers/${row.original.customer_id}`}
        className="font-medium underline-offset-4 hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: 'avg_gap',
    header: ({ column }) => <ColumnHeader column={column} title="Average gap (days)" />,
    meta: { align: 'right' },
    cell: ({ row }) => <span>{Math.round(row.original.avg_gap_days)}</span>,
  },
  {
    accessorKey: 'last_order_date',
    header: ({ column }) => <ColumnHeader column={column} title="Last order" />,
    cell: ({ row }) => <DateDisplay value={row.original.last_order_date} />,
  },
  {
    accessorKey: 'days_since_last_order',
    header: ({ column }) => <ColumnHeader column={column} title="Days since" />,
    meta: { align: 'right' },
    cell: ({ row }) => <span>{row.original.days_since_last_order}</span>,
  },
  {
    id: 'trend',
    header: ({ column }) => <ColumnHeader column={column} title="Trend" />,
    cell: ({ row }) => <TrendCell trend={trendFor(row.original)} />,
  },
]

export function OrderCadence({ rows }: { rows: CustomerSummary[] }) {
  const withCadence = useMemo(() => rows.filter(hasCadence), [rows])

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Order cadence</h2>
      <DataTable
        columns={columns}
        data={withCadence}
        pageSize={100}
        initialSorting={[{ id: 'days_since_last_order', desc: true }]}
        emptyState={
          <NoDataYet
            icon={<CalendarClock className="size-10" aria-hidden />}
            title="Not enough order history yet"
            description="Cadence needs at least two orders per customer to compute a gap."
          />
        }
        renderMobileCard={(c) => (
          <div>
            <div className="font-medium">{c.name}</div>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span>Every {Math.round(c.avg_gap_days)} days</span>
              <span>·</span>
              <TrendCell trend={trendFor(c)} />
            </div>
          </div>
        )}
      />
    </section>
  )
}
