'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RecordSheet } from '@/components/app/record-sheet'
import { CustomerForm } from '@/components/app/customer-form'
import { updateCustomer } from '@/lib/actions/customers'
import type { CustomerOutput } from '@/lib/schemas/customers'
import type { Customer } from '@/lib/queries/customers'

export function CustomerEditSheet({
  customer,
  open,
  onOpenChange,
}: {
  customer: Customer
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  async function onSubmit(values: CustomerOutput) {
    const result = await updateCustomer(customer.id, values)
    if (result.ok) {
      toast.success('Customer saved')
      onOpenChange(false)
      router.refresh()
    }
    return result
  }

  return (
    <RecordSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${customer.name}`}
    >
      <CustomerForm customer={customer} submitLabel="Save changes" onSubmit={onSubmit} />
    </RecordSheet>
  )
}
