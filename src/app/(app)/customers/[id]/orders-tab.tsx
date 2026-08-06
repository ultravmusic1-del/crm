import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { NoDataYet } from '@/components/app/empty-state'
import { DateDisplay } from '@/components/app/date-display'
import { Money } from '@/components/app/money'
import { OrderStatusBadge } from '@/components/app/order-status-badge'
import type { OrderStatus } from '@/lib/schemas/orders'
import type { OrderListRow } from '@/lib/queries/orders'

export function OrdersTab({ orders }: { orders: OrderListRow[] }) {
  if (orders.length === 0) {
    return (
      <NoDataYet
        title="No orders yet"
        description="Orders placed for this customer will show up here."
        action={
          <Button asChild className="h-11">
            <Link href="/orders/new">Record an order</Link>
          </Button>
        }
      />
    )
  }

  return (
    <ul className="space-y-2">
      {orders.map((o) => (
        <li key={o.order_id}>
          <Link
            href={`/orders/${o.order_id}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 hover:bg-accent/50"
          >
            <div>
              <span className="font-medium tabular-nums">#{o.order_number}</span>
              <span className="ml-2 text-sm text-muted-foreground">
                <DateDisplay value={o.delivery_date} />
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="tabular-nums">
                <Money value={o.subtotal} />
              </span>
              <OrderStatusBadge status={(o.status as OrderStatus) ?? 'draft'} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
