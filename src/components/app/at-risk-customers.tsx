'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import type { CustomerSummary } from '@/lib/queries/insights'
import type { Contact } from '@/lib/queries/customers'
import { Money } from '@/components/app/money'
import { DateDisplay } from '@/components/app/date-display'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InteractionSheet } from '@/app/(app)/customers/[id]/interaction-sheet'

function hasId(c: CustomerSummary): c is CustomerSummary & { customer_id: string } {
  return c.customer_id !== null
}

export function AtRiskCustomers({
  customers: allCustomers,
  contactsByCustomer,
}: {
  customers: CustomerSummary[]
  /** Pre-fetched so "Log outreach" opens instantly with the right contact. */
  contactsByCustomer: Record<string, Contact[]>
}) {
  const [loggingFor, setLoggingFor] = useState<string | null>(null)
  const customers = allCustomers.filter(hasId)

  if (customers.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4" aria-hidden />
        Nobody has gone quiet. Everyone is ordering about as often as usual.
      </div>
    )
  }

  return (
    <>
      <ul className="space-y-2">
        {customers.map((c) => {
          const gap = c.avg_gap_days ? Math.round(Number(c.avg_gap_days)) : null
          return (
            <li
              key={c.customer_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/customers/${c.customer_id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <Badge variant="destructive">
                    {c.days_since_last_order} days quiet
                  </Badge>
                </div>
                {/* Say WHY it is flagged. A flag without a reason is noise
                    she will learn to ignore. */}
                <p className="text-sm text-muted-foreground">
                  Usually orders every {gap ?? '—'} days ·{' '}
                  {c.order_count} orders · <Money value={c.lifetime_revenue} /> lifetime
                  {c.last_contacted_at ? (
                    <> · last spoke <DateDisplay value={c.last_contacted_at} /></>
                  ) : (
                    <> · never contacted</>
                  )}
                </p>
              </div>

              {/* One click, per spec §7 Phase 6. Not a navigation. */}
              <Button
                variant="outline"
                className="h-11 shrink-0"
                onClick={() => setLoggingFor(c.customer_id)}
              >
                Log outreach
              </Button>
            </li>
          )
        })}
      </ul>

      {loggingFor ? (
        <InteractionSheet
          customerId={loggingFor}
          contacts={contactsByCustomer[loggingFor] ?? []}
          open
          onOpenChange={(open) => { if (!open) setLoggingFor(null) }}
        />
      ) : null}
    </>
  )
}
