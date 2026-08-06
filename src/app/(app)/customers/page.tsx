import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { listCustomers } from '@/lib/queries/customers'
import { CustomersTable } from './customers-table'

export default async function CustomersPage() {
  const customers = await listCustomers()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <Button asChild className="h-11">
          <Link href="/customers/new">
            <Plus aria-hidden />
            Add customer
          </Link>
        </Button>
      </div>
      <CustomersTable customers={customers} />
    </div>
  )
}
