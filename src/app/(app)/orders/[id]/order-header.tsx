'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DateDisplay } from '@/components/app/date-display'
import { OrderStatusControl } from './order-status-control'
import { OrderEditSheet } from './order-edit-sheet'
import type { OrderWithItems } from '@/lib/queries/orders'
import type { OrderStatus } from '@/lib/schemas/orders'
import type { OrderFormCustomer, OrderFormProduct } from '@/lib/queries/order-form'

export function OrderHeader({
  order,
  customers,
  products,
}: {
  order: OrderWithItems
  customers: OrderFormCustomer[]
  products: OrderFormProduct[]
}) {
  const [editOpen, setEditOpen] = useState(false)
  const status = order.status as OrderStatus

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Order #{order.order_number}</h1>
          {order.recurring_order_id ? <Badge variant="secondary">From a schedule</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link
            href={`/customers/${order.customer_id}`}
            className="font-medium text-foreground hover:underline"
          >
            {order.customers?.name ?? 'Unknown customer'}
          </Link>
          {' · '}Delivery <DateDisplay value={order.delivery_date} />
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <OrderStatusControl orderId={order.id} status={status} />
        {status !== 'cancelled' ? (
          <Button type="button" variant="outline" className="h-11" onClick={() => setEditOpen(true)}>
            <Pencil aria-hidden />
            Edit
          </Button>
        ) : null}
      </div>

      <OrderEditSheet
        order={order}
        customers={customers}
        products={products}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  )
}
