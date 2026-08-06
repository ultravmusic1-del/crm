'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TextField, TextAreaField, SelectField, SegmentedField } from '@/components/app/form-fields'
import {
  customerSchema,
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  PRICE_TIERS,
  SOURCE_SUGGESTIONS,
  type CustomerInput,
  type CustomerOutput,
} from '@/lib/schemas/customers'
import type { Customer } from '@/lib/queries/customers'
import { cn } from '@/lib/utils'

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const TYPE_OPTIONS = CUSTOMER_TYPES.map((t) => ({ value: t, label: capitalize(t) }))
const STATUS_OPTIONS = CUSTOMER_STATUSES.map((s) => ({ value: s, label: capitalize(s) }))
const PRICE_TIER_OPTIONS = PRICE_TIERS.map((p) => ({ value: p, label: capitalize(p) }))

function toDefaultValues(customer?: Customer): CustomerInput {
  return {
    name: customer?.name ?? '',
    type: (customer?.type as CustomerInput['type']) ?? 'business',
    status: (customer?.status as CustomerInput['status']) ?? 'lead',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    address_line1: customer?.address_line1 ?? '',
    address_line2: customer?.address_line2 ?? '',
    city: customer?.city ?? '',
    postcode: customer?.postcode ?? '',
    delivery_notes: customer?.delivery_notes ?? '',
    source: customer?.source ?? '',
    price_tier: (customer?.price_tier as CustomerInput['price_tier']) ?? 'wholesale',
    notes: customer?.notes ?? '',
  }
}

export function CustomerForm({
  customer,
  onSubmit,
  submitLabel,
}: {
  customer?: Customer
  onSubmit: (values: CustomerOutput) => Promise<{ ok: boolean; error?: string }>
  submitLabel: string
}) {
  const [expanded, setExpanded] = useState(Boolean(customer))

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CustomerInput, unknown, CustomerOutput>({
    resolver: zodResolver(customerSchema),
    mode: 'onTouched',
    defaultValues: toDefaultValues(customer),
  })

  async function handleFormSubmit(values: CustomerOutput) {
    const result = await onSubmit(values)
    // Never clear the form on error — the user should not have to retype.
    if (!result.ok) {
      toast.error(result.error ?? 'Something went wrong. Try again.')
    }
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6 pb-24 md:pb-0">
      <div className="space-y-4">
        <TextField
          control={control}
          name="name"
          label="Name"
          autoComplete="organization"
          autoFocus
        />
        <SegmentedField control={control} name="type" label="Type" options={TYPE_OPTIONS} />
      </div>

      <Button
        type="button"
        variant="ghost"
        aria-expanded={expanded}
        aria-controls="customer-form-details"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? 'Hide' : 'Add'} contact details, address and pricing
      </Button>

      {expanded ? (
        <div id="customer-form-details" className="space-y-4">
          <SelectField
            control={control}
            name="status"
            label="Status"
            options={STATUS_OPTIONS}
          />
          <TextField
            control={control}
            name="email"
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
          />
          <TextField
            control={control}
            name="phone"
            label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
          <TextField
            control={control}
            name="address_line1"
            label="Address line 1"
            autoComplete="address-line1"
          />
          <TextField
            control={control}
            name="address_line2"
            label="Address line 2"
            autoComplete="address-line2"
          />
          <div className="grid grid-cols-2 gap-4">
            <TextField
              control={control}
              name="city"
              label="City"
              autoComplete="address-level2"
            />
            <TextField
              control={control}
              name="postcode"
              label="Postcode"
              autoComplete="postal-code"
            />
          </div>
          <TextAreaField
            control={control}
            name="delivery_notes"
            label="Delivery notes"
            rows={2}
            description="Back door, ask for Sam, before 9am — whatever you'd tell a driver."
          />
          <div>
            <TextField
              control={control}
              name="source"
              label="Source"
              list="source-suggestions"
            />
            <datalist id="source-suggestions">
              {SOURCE_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <SegmentedField
            control={control}
            name="price_tier"
            label="Price tier"
            options={PRICE_TIER_OPTIONS}
          />
          <TextAreaField control={control} name="notes" label="Notes" />
        </div>
      ) : null}

      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-10 flex items-center justify-end gap-4 border-t bg-background/95 px-4 py-3 backdrop-blur',
          'md:static md:inset-auto md:z-auto md:border-t-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none',
        )}
      >
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
