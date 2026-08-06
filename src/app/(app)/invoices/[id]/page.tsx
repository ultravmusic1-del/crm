import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Money } from '@/components/app/money'
import { DateDisplay } from '@/components/app/date-display'
import { InvoiceStatusBadge } from '@/components/app/invoice-status-badge'
import { PAYMENT_METHOD_LABELS } from '@/lib/schemas/invoices'
import { getInvoiceDetail } from '@/lib/queries/invoices'
import { parseMoney } from '@/lib/format'
import { DeletePaymentButton } from './delete-payment-button'
import { InvoiceActions } from './invoice-actions'

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const detail = await getInvoiceDetail(id)
  if (!detail) notFound()

  const { invoice, customer, totals, orders, payments } = detail
  const isVoid = totals.computed_status === 'void'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">Invoice {invoice.invoice_number}</h1>
            <InvoiceStatusBadge status={totals.computed_status ?? 'draft'} />
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href={`/customers/${customer.id}`} className="font-medium underline-offset-4 hover:underline">
              {customer.name}
            </Link>
            {' · Issued '}
            <DateDisplay value={invoice.issued_on} />
            {' · Due '}
            <DateDisplay value={invoice.due_on} />
          </p>
        </div>
        <InvoiceActions
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoice_number}
          computedStatus={totals.computed_status ?? 'draft'}
          balance={parseMoney(totals.balance)}
        />
      </div>

      {isVoid ? (
        <div className="rounded-lg border border-dashed bg-muted/50 p-4 text-sm">
          This invoice was voided. Its orders were released and can be invoiced again. The
          number and total are kept for the record.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {orders.map((order) => (
            <Card key={order.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  #{order.order_number} — delivered <DateDisplay value={order.delivery_date} />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {order.order_items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                    {/* order_items.product_name is the SNAPSHOT taken at order time —
                        an invoice is a historical document and must reprint identically
                        forever, even after the product is renamed. */}
                    <span>
                      {item.quantity} × {item.product_name}
                    </span>
                    <Money value={item.line_total} className="tabular-nums" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                <div className="divide-y">
                  {payments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div>
                        <DateDisplay value={p.paid_on} />
                        <span className="text-muted-foreground">
                          {' · '}
                          {p.method ? PAYMENT_METHOD_LABELS[p.method] : 'Unspecified'}
                          {p.reference ? ` · ${p.reference}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Money value={p.amount} className="tabular-nums font-medium" />
                        <DeletePaymentButton paymentId={p.id} invoiceId={invoice.id} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm tabular-nums">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <Money value={totals.subtotal} />
            </div>
            {parseMoney(totals.delivery_charge) !== 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Delivery charge</span>
                <Money value={totals.delivery_charge} />
              </div>
            ) : null}
            {parseMoney(totals.discount_amount) !== 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span>-<Money value={totals.discount_amount} /></span>
              </div>
            ) : null}
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <Money value={totals.total} />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paid</span>
              <Money value={totals.amount_paid} />
            </div>
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <span>Balance</span>
              <Money value={totals.balance} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
