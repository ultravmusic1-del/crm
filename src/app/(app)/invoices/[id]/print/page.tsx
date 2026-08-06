import { Fragment } from 'react'
import { notFound } from 'next/navigation'
import { getInvoiceDetail } from '@/lib/queries/invoices'
import { getSettings } from '@/lib/queries/settings'
import { formatDate, formatMoney, parseMoney } from '@/lib/format'

/**
 * No PDF library — this is a print-styled HTML route, saved as PDF by the
 * browser. Keep the whole template in one file: it will be re-themed, and
 * a re-theme across six files is a bad afternoon.
 *
 * Money goes through formatMoney(value, settings) directly rather than
 * <Money />: this route renders outside the SettingsProvider's useful
 * reach (there is no benefit to the context here, since the settings are
 * already fetched server-side), and this is the one sanctioned exception —
 * it still routes through lib/format.ts, so the Phase 8 grep stays clean.
 */
export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [detail, settings] = await Promise.all([getInvoiceDetail(id), getSettings()])
  if (!detail) notFound()

  const { invoice, customer, totals, orders } = detail
  const isVoid = totals.computed_status === 'void'
  const money = (value: number | string | null | undefined) => formatMoney(value, settings)

  const businessAddress = [settings.address_line1, settings.address_line2]
    .filter(Boolean)
    .concat([[settings.city, settings.postcode].filter(Boolean).join(' ')].filter(Boolean))
    .concat(settings.country ? [settings.country] : [])

  const customerAddress = [customer.address_line1, customer.address_line2]
    .filter(Boolean)
    .concat([[customer.city, customer.postcode].filter(Boolean).join(' ')].filter(Boolean))

  const bankLines: { label: string; value: string }[] = [
    { label: 'Bank', value: settings.bank_name ?? '' },
    { label: 'Account name', value: settings.bank_account_name ?? '' },
    { label: 'Account number', value: settings.bank_account_number ?? '' },
    { label: 'IBAN', value: settings.bank_iban ?? '' },
    { label: 'SWIFT', value: settings.bank_swift ?? '' },
  ].filter((l) => l.value)

  const hasDelivery = parseMoney(totals.delivery_charge) !== 0
  const hasDiscount = parseMoney(totals.discount_amount) !== 0

  return (
    <div className="relative space-y-8 text-sm">
      {isVoid ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
        >
          <span className="rotate-[-25deg] select-none text-[10rem] font-black uppercase tracking-widest text-red-600/25">
            Void
          </span>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-8">
        <div>
          <p className="text-lg font-bold">{settings.business_name}</p>
          {businessAddress.map((line, i) => (
            <p key={i} className="text-gray-700">
              {line}
            </p>
          ))}
          {settings.business_email ? <p className="text-gray-700">{settings.business_email}</p> : null}
          {settings.business_phone ? <p className="text-gray-700">{settings.business_phone}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tracking-tight">INVOICE</p>
          <p className="font-medium tabular-nums">{invoice.invoice_number}</p>
          <p className="text-gray-700">Issued {formatDate(invoice.issued_on)}</p>
          <p className="text-gray-700">Due {formatDate(invoice.due_on)}</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bill to</p>
        <p className="font-medium">{customer.name}</p>
        {customerAddress.map((line, i) => (
          <p key={i} className="text-gray-700">
            {line}
          </p>
        ))}
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-400 text-left">
            <th className="py-2 font-semibold">Description</th>
            <th className="py-2 text-right font-semibold">Qty</th>
            <th className="py-2 text-right font-semibold">Unit price</th>
            <th className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <Fragment key={order.id}>
              <tr>
                <td colSpan={4} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Order #{order.order_number} — delivered {formatDate(order.delivery_date)}
                </td>
              </tr>
              {order.order_items.map((item) => (
                <tr key={item.id} className="border-b border-gray-200">
                  {/* product_name is the order_items SNAPSHOT, never a join to
                      products — an invoice must reprint identically forever,
                      even after the product is renamed. */}
                  <td className="py-1.5">{item.product_name}</td>
                  <td className="py-1.5 text-right tabular-nums">{item.quantity}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(item.unit_price)}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(item.line_total)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end">
        <div className="w-64 space-y-1 text-right tabular-nums">
          <div className="flex justify-between">
            <span className="text-gray-600">Subtotal</span>
            <span>{money(totals.subtotal)}</span>
          </div>
          {hasDelivery ? (
            <div className="flex justify-between">
              <span className="text-gray-600">Delivery charge</span>
              <span>{money(totals.delivery_charge)}</span>
            </div>
          ) : null}
          {hasDiscount ? (
            <div className="flex justify-between">
              <span className="text-gray-600">Discount</span>
              <span>-{money(totals.discount_amount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-gray-400 pt-1 text-base font-bold">
            <span>Total</span>
            <span>{money(totals.total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Paid</span>
            <span>{money(totals.amount_paid)}</span>
          </div>
          <div className="flex justify-between border-t border-gray-400 pt-1 text-base font-bold">
            <span>Balance due</span>
            <span>{money(totals.balance)}</span>
          </div>
        </div>
      </div>

      {bankLines.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payment details</p>
          {bankLines.map((l) => (
            <p key={l.label} className="text-gray-700">
              <span className="font-medium text-black">{l.label}:</span> {l.value}
            </p>
          ))}
        </div>
      ) : null}

      <div className="text-gray-700">
        <p>Payment due within {settings.default_payment_terms_days} days.</p>
        {invoice.notes ? <p>{invoice.notes}</p> : null}
      </div>
    </div>
  )
}
