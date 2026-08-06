'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RecordSheet } from '@/components/app/record-sheet'
import { OrderForm } from '@/components/app/order-form'
import { updateOrder } from '@/lib/actions/orders'
import type { OrderOutput } from '@/lib/schemas/orders'
import type { OrderWithItems } from '@/lib/queries/orders'
import type { OrderFormCustomer, OrderFormProduct } from '@/lib/queries/order-form'

export function OrderEditSheet({
  order,
  customers,
  products,
  open,
  onOpenChange,
}: {
  order: OrderWithItems
  customers: OrderFormCustomer[]
  products: OrderFormProduct[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  async function onSubmit(values: OrderOutput) {
    const result = await updateOrder(order.id, values)
    if (result.ok) {
      if (result.detachedFromSchedule) {
        // A silent detach is the kind of thing she discovers three weeks
        // later as a missing delivery — say so out loud, and keep the
        // toast on screen long enough to actually read it.
        toast.info('Order saved, and detached from its schedule', {
          description:
            'You changed the delivery date, so the standing order will still generate one on the original day.',
          duration: 10000,
        })
      } else {
        toast.success('Order saved')
      }
      onOpenChange(false)
      router.refresh()
    }
    return result
  }

  return (
    <RecordSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit order #${order.order_number}`}
    >
      <OrderForm
        customers={customers}
        products={products}
        initial={order}
        submitLabel="Save changes"
        onSubmit={onSubmit}
      />
    </RecordSheet>
  )
}
