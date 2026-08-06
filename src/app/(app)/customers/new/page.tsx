'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CustomerForm } from '@/components/app/customer-form'
import { createCustomer } from '@/lib/actions/customers'
import type { CustomerOutput } from '@/lib/schemas/customers'

export default function NewCustomerPage() {
  const router = useRouter()

  async function onSubmit(values: CustomerOutput) {
    const result = await createCustomer(values)
    if (result.ok) {
      toast.success(`${values.name} added`)
      router.push(`/customers/${result.id}`)
    }
    return result
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New customer</h1>
      <CustomerForm submitLabel="Create customer" onSubmit={onSubmit} />
    </div>
  )
}
