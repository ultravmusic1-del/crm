import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ExportButton } from '@/components/app/export-button'
import { listInvoices } from '@/lib/queries/invoices'
import { InvoicesTable } from './invoices-table'

export default async function InvoicesPage() {
  const invoices = await listInvoices()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <div className="flex gap-2">
          <ExportButton entity="invoices" />
          <Button asChild className="h-11">
            <Link href="/invoices/new">New invoice</Link>
          </Button>
        </div>
      </div>
      <InvoicesTable invoices={invoices} />
    </div>
  )
}
