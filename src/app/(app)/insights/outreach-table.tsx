'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { MessageCircle } from 'lucide-react'
import { DataTable } from '@/components/app/data-table/data-table'
import { ColumnHeader } from '@/components/app/data-table/column-header'
import { NoDataYet } from '@/components/app/empty-state'
import { CHANNEL_LABELS, type Channel } from '@/lib/schemas/interactions'
import type { OutreachEffectiveness } from '@/lib/queries/insights'

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel as Channel] ?? channel
}

const columns: ColumnDef<OutreachEffectiveness, unknown>[] = [
  {
    accessorKey: 'channel',
    header: ({ column }) => <ColumnHeader column={column} title="Channel" />,
    cell: ({ row }) => <span className="font-medium">{channelLabel(row.original.channel)}</span>,
  },
  {
    accessorKey: 'interaction_count',
    header: ({ column }) => <ColumnHeader column={column} title="Interactions" />,
    meta: { align: 'right' },
    cell: ({ row }) => <span>{row.original.interaction_count}</span>,
  },
  {
    accessorKey: 'customers_touched',
    header: ({ column }) => <ColumnHeader column={column} title="Customers reached" />,
    meta: { align: 'right' },
    cell: ({ row }) => <span>{row.original.customers_touched}</span>,
  },
  {
    accessorKey: 'customers_who_ordered',
    header: ({ column }) => <ColumnHeader column={column} title="Went on to order" />,
    meta: { align: 'right' },
    cell: ({ row }) => <span>{row.original.customers_who_ordered}</span>,
  },
  {
    accessorKey: 'conversion_pct',
    header: ({ column }) => <ColumnHeader column={column} title="Conversion %" />,
    meta: { align: 'right' },
    cell: ({ row }) => {
      const pct = row.original.conversion_pct
      if (pct === null) return <span className="text-muted-foreground">—</span>
      // pct is a PERCENTAGE, not money — this is not the banned money toFixed.
      return <span className="tabular-nums">{pct.toFixed(1)}%</span>
    },
  },
]

export function OutreachTable({ rows }: { rows: OutreachEffectiveness[] }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Outreach effectiveness</h2>
        <p className="text-sm text-muted-foreground">
          Of the customers you contacted this way, how many placed an order afterwards. This
          is what tells you whether sample drops are worth the trip.
        </p>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        pageSize={100}
        initialSorting={[{ id: 'conversion_pct', desc: true }]}
        emptyState={
          <NoDataYet
            icon={<MessageCircle className="size-10" aria-hidden />}
            title="No outreach logged in this period"
            description="Log a call, email or sample drop from a customer's page to see conversion here."
          />
        }
        renderMobileCard={(r) => (
          <div>
            <div className="font-medium">{channelLabel(r.channel)}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {r.customers_who_ordered} of {r.customers_touched} ordered
              {r.conversion_pct !== null ? ` · ${r.conversion_pct.toFixed(1)}%` : ''}
            </div>
          </div>
        )}
      />
    </section>
  )
}
