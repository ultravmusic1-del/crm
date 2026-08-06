import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { listInvoices } from '@/lib/queries/invoices'
import { InvoicesTable } from './invoices-table'

export default async function InvoicesPage() {
  const invoices = await listInvoices()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <Button asChild className="h-11">
          <Link href="/invoices/new">New invoice</Link>
        </Button>
      </div>
      <InvoicesTable invoices={invoices} />
    </div>
  )
}
