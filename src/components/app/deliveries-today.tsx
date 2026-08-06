import Link from 'next/link'
import type { WeekSummary } from '@/lib/queries/dashboard'

/**
 * Lives in the "Today" section, beneath follow-ups — not "This week", which
 * is the whole week's forward-looking summary rather than today's actions.
 */
export function DeliveriesToday({ items }: { items: WeekSummary['deliveriesToday'] }) {
  if (items.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">Deliveries today</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.order_id}
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <Link href={`/customers/${item.customer_id}`} className="font-medium hover:underline">
              {item.customer_name}
            </Link>
            <span className="text-sm text-muted-foreground">{item.total_units} units</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
