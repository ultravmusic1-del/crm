import { getOrderFormData } from '@/lib/queries/order-form'
import { NewOrderForm } from './new-order-form'

export default async function NewOrderPage() {
  const { customers, products } = await getOrderFormData()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New order</h1>
      <NewOrderForm customers={customers} products={products} />
    </div>
  )
}
