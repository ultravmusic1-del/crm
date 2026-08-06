import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { listOrders } from '@/lib/queries/orders'
import { OrdersTable } from './orders-table'

export default async function OrdersPage() {
  const orders = await listOrders()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <Button asChild className="h-11">
          <Link href="/orders/new">New order</Link>
        </Button>
      </div>
      <OrdersTable orders={orders} />
    </div>
  )
}
