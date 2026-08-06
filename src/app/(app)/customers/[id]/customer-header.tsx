'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/app/status-badge'
import { CustomerEditSheet } from './customer-edit-sheet'
import { setCustomerStatus, archiveCustomer, unarchiveCustomer } from '@/lib/actions/customers'
import { CUSTOMER_STATUSES, type CustomerStatus } from '@/lib/schemas/customers'
import type { Customer, Contact } from '@/lib/queries/customers'

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function CustomerHeader({
  customer,
}: {
  customer: Customer
  contacts: Contact[]
}) {
  const router = useRouter()
  const [status, setStatus] = useState<CustomerStatus>(customer.status as CustomerStatus)
  const [editOpen, setEditOpen] = useState(false)

  // Reversible single-object mutation: update local state first, then
  // confirm with the server. A failure must be visible and retryable, not
  // silently reverted — hence the persistent toast with a Retry action
  // rather than a plain rollback.
  async function applyStatus(next: CustomerStatus) {
    const previous = status
    setStatus(next)
    const result = await setCustomerStatus({ id: customer.id, status: next })
    if (!result.ok) {
      setStatus(previous)
      toast.error('Could not update status.', {
        duration: Infinity,
        action: {
          label: 'Retry',
          onClick: () => applyStatus(next),
        },
      })
    }
  }

  // Archiving is reversible, so it gets an Undo toast rather than a
  // confirmation modal — modals are reserved for irreversible actions.
  async function handleArchive() {
    const result = await archiveCustomer(customer.id)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`${customer.name} archived`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          await unarchiveCustomer(customer.id)
          router.refresh()
        },
      },
    })
    router.push('/customers')
  }

  const subtitle = [
    capitalize(customer.type),
    customer.city,
    `${capitalize(customer.price_tier)} pricing`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold">{customer.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(v) => applyStatus(v as CustomerStatus)}>
          <SelectTrigger className="h-11 w-40" aria-label="Customer status">
            <StatusBadge status={status} />
          </SelectTrigger>
          <SelectContent>
            {CUSTOMER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {capitalize(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => {
            // TODO(next task): open InteractionSheet
            console.log('TODO: open InteractionSheet')
          }}
        >
          Log interaction
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => setEditOpen(true)}
        >
          <Pencil aria-hidden />
          <span className="sr-only">Edit customer</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={handleArchive}
        >
          <Archive aria-hidden />
          <span className="sr-only">Archive customer</span>
        </Button>
      </div>

      <CustomerEditSheet customer={customer} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  )
}
