import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/app/money'
import { getOrder, getOrderTotals } from '@/lib/queries/orders'
import { getOrderFormData } from '@/lib/queries/order-form'
import { OrderHeader } from './order-header'

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const order = await getOrder(id)
  if (!order) notFound()

  const [totals, formData] = await Promise.all([getOrderTotals(id), getOrderFormData()])

  return (
    <div className="space-y-6">
      <OrderHeader order={order} customers={formData.customers} products={formData.products} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Rendered from the order_items SNAPSHOT — never a join to
                products. An order is a historical record; a product being
                renamed or re-priced later must not rewrite it. */}
            {order.order_items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="font-medium">{item.product_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.quantity} × <Money value={item.unit_price} />
                  </p>
                </div>
                <span className="shrink-0 tabular-nums font-medium">
                  <Money value={item.line_total} />
                </span>
              </div>
            ))}

            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-lg font-semibold tabular-nums">
                <Money value={totals?.subtotal} />
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Address</p>
              <p>{order.delivery_address ?? '—'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Delivery notes</p>
              <p>{order.delivery_notes_snapshot ?? '—'}</p>
            </div>
            {order.notes ? (
              <div>
                <p className="text-muted-foreground">Order notes</p>
                <p>{order.notes}</p>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              The address and delivery notes are a snapshot from when this order was created —
              later changes to the customer do not rewrite this delivery.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
