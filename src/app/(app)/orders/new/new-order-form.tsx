'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { OrderForm } from '@/components/app/order-form'
import { createOrder } from '@/lib/actions/orders'
import type { OrderOutput } from '@/lib/schemas/orders'
import type { OrderFormCustomer, OrderFormProduct } from '@/lib/queries/order-form'

export function NewOrderForm({
  customers,
  products,
}: {
  customers: OrderFormCustomer[]
  products: OrderFormProduct[]
}) {
  const router = useRouter()

  async function onSubmit(values: OrderOutput) {
    const result = await createOrder(values)
    if (result.ok) {
      toast.success('Order created')
      router.push(`/orders/${result.id}`)
    }
    return result
  }

  return (
    <OrderForm
      customers={customers}
      products={products}
      onSubmit={onSubmit}
      submitLabel="Create order"
    />
  )
}
