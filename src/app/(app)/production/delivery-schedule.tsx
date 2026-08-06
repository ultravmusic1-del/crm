import Link from 'next/link'
import { Phone } from 'lucide-react'
import type { DeliveryRow } from '@/lib/queries/production'
import { formatDate } from '@/lib/format'
import { NoDataYet } from '@/components/app/empty-state'

type DeliveryItem = { name: string; quantity: number }

/** delivery_date is a plain 'YYYY-MM-DD' date column — parsed as UTC noon so
 * no local timezone can shift it into the adjacent day, matching the
 * convention in lib/format.ts. */
function weekdayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  )
}

function groupByDate(rows: DeliveryRow[]): Map<string, DeliveryRow[]> {
  const groups = new Map<string, DeliveryRow[]>()
  for (const row of rows) {
    const date = row.delivery_date ?? ''
    const existing = groups.get(date)
    if (existing) existing.push(row)
    else groups.set(date, [row])
  }
  return groups
}

export function DeliverySchedule({ rows }: { rows: DeliveryRow[] }) {
  if (rows.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-lg font-semibold">Delivery schedule</h2>
        <NoDataYet
          title="No deliveries this week"
          description="Confirmed orders with a delivery date this week will show up here with their addresses."
        />
      </section>
    )
  }

  const groups = groupByDate(rows)

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Delivery schedule</h2>
      <div className="space-y-6">
        {[...groups.entries()].map(([date, deliveries]) => (
          <div key={date} className="space-y-2">
            <h3 className="font-semibold">
              {weekdayLabel(date)} · {formatDate(date)}
            </h3>
            <ul className="space-y-3">
              {deliveries.map((d) => {
                const items = (d.items ?? []) as unknown as DeliveryItem[]
                return (
                  <li key={d.order_id ?? d.order_number} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      {d.customer_id ? (
                        <Link
                          href={`/customers/${d.customer_id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {d.customer_name}
                        </Link>
                      ) : (
                        <span className="font-medium">{d.customer_name}</span>
                      )}
                      <span className="text-sm text-muted-foreground">{d.total_units} units</span>
                    </div>

                    {items.length > 0 ? (
                      <ul className="mt-1 text-sm text-muted-foreground">
                        {items.map((item) => (
                          <li key={item.name}>
                            {item.quantity} × {item.name}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {d.delivery_address ? (
                      <p className="mt-2 text-sm">{d.delivery_address}</p>
                    ) : null}

                    {/* The snapshotted note — this is what stops a wasted trip. */}
                    {d.delivery_notes_snapshot ? (
                      <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        {d.delivery_notes_snapshot}
                      </p>
                    ) : null}

                    {d.customer_phone ? (
                      <a
                        href={`tel:${d.customer_phone}`}
                        className="mt-2 inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                      >
                        <Phone className="size-3.5" aria-hidden />
                        {d.customer_phone}
                      </a>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
