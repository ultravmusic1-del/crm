import { getOrderFormData } from '@/lib/queries/order-form'
import { NewScheduleForm } from './new-schedule-form'

export default async function NewSchedulePage() {
  const { customers, products } = await getOrderFormData()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New schedule</h1>
      <NewScheduleForm customers={customers} products={products} />
    </div>
  )
}
