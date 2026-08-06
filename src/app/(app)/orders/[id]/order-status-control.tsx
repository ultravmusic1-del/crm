'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { OrderStatusBadge } from '@/components/app/order-status-badge'
import { setOrderStatus } from '@/lib/actions/orders'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/schemas/orders'

/**
 * Same inline-optimistic pattern as the customer header's status control:
 * update local state first, confirm with the server, and on failure roll
 * back with a PERSISTENT toast + Retry rather than silently reverting — a
 * silent revert on an order status is the kind of thing that gets found
 * at delivery time, not now.
 */
export function OrderStatusControl({
  orderId,
  status,
}: {
  orderId: string
  status: OrderStatus
}) {
  const [current, setCurrent] = useState<OrderStatus>(status)

  async function apply(next: OrderStatus) {
    const previous = current
    setCurrent(next)
    const result = await setOrderStatus({ id: orderId, status: next })
    if (!result.ok) {
      setCurrent(previous)
      toast.error('Could not update status.', {
        duration: Infinity,
        action: {
          label: 'Retry',
          onClick: () => apply(next),
        },
      })
    }
  }

  return (
    <Select value={current} onValueChange={(v) => apply(v as OrderStatus)}>
      <SelectTrigger className="h-11 w-44" aria-label="Order status">
        <OrderStatusBadge status={current} />
      </SelectTrigger>
      <SelectContent>
        {ORDER_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {ORDER_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
