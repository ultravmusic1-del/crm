'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ScheduleForm } from '@/components/app/schedule-form'
import { upsertSchedule } from '@/lib/actions/orders'
import type { ScheduleOutput } from '@/lib/schemas/orders'
import type { OrderFormCustomer, OrderFormProduct } from '@/lib/queries/order-form'

export function NewScheduleForm({
  customers,
  products,
}: {
  customers: OrderFormCustomer[]
  products: OrderFormProduct[]
}) {
  const router = useRouter()

  async function onSubmit(values: ScheduleOutput) {
    const result = await upsertSchedule(null, values)
    if (result.ok) {
      toast.success('Schedule created')
      router.push(`/schedules/${result.id}`)
    }
    return result
  }

  return (
    <ScheduleForm
      customers={customers}
      products={products}
      onSubmit={onSubmit}
      submitLabel="Create schedule"
    />
  )
}
