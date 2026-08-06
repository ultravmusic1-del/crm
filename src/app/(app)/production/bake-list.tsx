'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import type { BakeListRow } from '@/lib/queries/production'
import { formatDate } from '@/lib/format'
import { NoDataYet } from '@/components/app/empty-state'
import { MarkInProduction } from './mark-in-production'

export function BakeList({ rows }: { rows: BakeListRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())

  if (rows.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-lg font-semibold">Bake list</h2>
        <NoDataYet
          title="Nothing to bake this week"
          description="Orders with a delivery date in this week will appear here automatically."
        />
      </section>
    )
  }

  const allOrderIds = [
    ...new Set(rows.flatMap((r) => r.contributors.map((c) => c.order_id))),
  ]

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Bake list</h2>
        <div className="print:hidden">
          <MarkInProduction orderIds={allOrderIds} />
        </div>
      </div>

      <ul className="divide-y rounded-lg border print:border-0">
        {rows.map((row) => {
          const isOpen = open.has(row.product_id)
          return (
            <li key={row.product_id}>
              <button
                type="button"
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s)
                    if (n.has(row.product_id)) n.delete(row.product_id)
                    else n.add(row.product_id)
                    return n
                  })
                }
                className="flex min-h-14 w-full items-center gap-3 px-3 text-left hover:bg-accent/50 print:min-h-0 print:py-1"
              >
                {/* Quantity first and large: this is read at arm's length
                    from a printed sheet on a worktop. */}
                <span className="w-20 shrink-0 text-right text-2xl font-bold tabular-nums print:text-xl">
                  {row.total_quantity}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-lg font-medium print:text-base">{row.product_name}</span>
                  <span className="ml-1 text-sm text-muted-foreground">
                    {row.product_unit}s · {row.contributors.length} orders
                  </span>
                </span>
                <ChevronDown
                  className={isOpen ? 'size-4 rotate-180 print:hidden' : 'size-4 print:hidden'}
                  aria-hidden
                />
              </button>

              {isOpen ? (
                <ul className="space-y-1 bg-muted/40 px-3 pb-3 pl-24 text-sm">
                  {row.contributors.map((c) => (
                    <li key={`${c.order_id}-${row.product_id}`} className="flex justify-between gap-2">
                      <Link href={`/orders/${c.order_id}`} className="underline-offset-4 hover:underline">
                        {c.customer_name}
                      </Link>
                      <span className="text-muted-foreground">
                        {formatDate(c.delivery_date)} · {c.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
