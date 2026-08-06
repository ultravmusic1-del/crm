import { listCustomersWithUninvoicedOrders } from '@/lib/queries/invoices'
import { getSettings } from '@/lib/queries/settings'
import { InvoiceBuilder } from '@/components/app/invoice-builder'

export default async function NewInvoicePage() {
  const [customers, settings] = await Promise.all([
    listCustomersWithUninvoicedOrders(),
    getSettings(),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New invoice</h1>
      <InvoiceBuilder
        customers={customers}
        defaultTermsDays={settings.default_payment_terms_days}
      />
    </div>
  )
}
