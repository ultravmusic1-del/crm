import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ExportButton } from '@/components/app/export-button'
import { listOrders } from '@/lib/queries/orders'
import { OrdersTable } from './orders-table'

export default async function OrdersPage() {
  const orders = await listOrders()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <div className="flex gap-2">
          <ExportButton entity="orders" />
          <Button asChild className="h-11">
            <Link href="/orders/new">New order</Link>
          </Button>
        </div>
      </div>
      <OrdersTable orders={orders} />
    </div>
  )
}
