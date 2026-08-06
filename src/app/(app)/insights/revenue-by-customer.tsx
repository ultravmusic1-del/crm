'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { Users } from 'lucide-react'
import { DataTable } from '@/components/app/data-table/data-table'
import { ColumnHeader } from '@/components/app/data-table/column-header'
import { NoDataYet } from '@/components/app/empty-state'
import { Money } from '@/components/app/money'
import { DateDisplay } from '@/components/app/date-display'
import { parseMoney } from '@/lib/format'
import type { CustomerSummary } from '@/lib/queries/insights'

type Row = CustomerSummary & { customer_id: string; order_count: number }

function hasOrders(c: CustomerSummary): c is Row {
  return c.customer_id !== null && (c.order_count ?? 0) > 0
}

function avgOrder(row: Row): number {
  return parseMoney(row.lifetime_revenue) / row.order_count
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
    accessorKey: 'order_count',
    header: ({ column }) => <ColumnHeader column={column} title="Orders" />,
    meta: { align: 'right' },
    cell: ({ row }) => <span>{row.original.order_count}</span>,
  },
  {
    accessorKey: 'lifetime_revenue',
    header: ({ column }) => <ColumnHeader column={column} title="Lifetime revenue" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={row.original.lifetime_revenue} />,
  },
  {
    id: 'avg_order',
    header: ({ column }) => <ColumnHeader column={column} title="Avg. order" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={avgOrder(row.original)} />,
  },
  {
    accessorKey: 'last_order_date',
    header: ({ column }) => <ColumnHeader column={column} title="Last order" />,
    cell: ({ row }) => <DateDisplay value={row.original.last_order_date} />,
  },
]

export function RevenueByCustomer({ rows }: { rows: CustomerSummary[] }) {
  const withOrders = useMemo(() => rows.filter(hasOrders), [rows])

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Revenue by customer</h2>
        {/* The period picker filters product performance and outreach, but
            lifetime revenue is by definition not period-scoped — say so
            rather than silently ignoring the picker. */}
        <p className="text-sm text-muted-foreground">
          Lifetime figures, not limited to the selected period.
        </p>
      </div>
      <DataTable
        columns={columns}
        data={withOrders}
        pageSize={100}
        initialSorting={[{ id: 'lifetime_revenue', desc: true }]}
        emptyState={
          <NoDataYet
            icon={<Users className="size-10" aria-hidden />}
            title="No customer revenue yet"
            description="Once orders are confirmed, delivered or in production, they show up here."
          />
        }
        renderMobileCard={(c) => (
          <div>
            <div className="font-medium">{c.name}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {c.order_count} orders · <Money value={c.lifetime_revenue} /> lifetime
            </div>
          </div>
        )}
      />
    </section>
  )
}
