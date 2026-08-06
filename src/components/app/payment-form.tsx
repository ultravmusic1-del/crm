'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { TextField, SegmentedField } from '@/components/app/form-fields'
import { Button } from '@/components/ui/button'
import {
  paymentSchema, PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
  type PaymentInput, type PaymentOutput,
} from '@/lib/schemas/invoices'
import { recordPayment } from '@/lib/actions/invoices'

const METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))

export function PaymentForm({
  invoiceId,
  defaultAmount,
  onDone,
}: {
  invoiceId: string
  defaultAmount: number
  onDone: () => void
}) {
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<PaymentInput, unknown, PaymentOutput>({
    resolver: zodResolver(paymentSchema),
    mode: 'onTouched',
    defaultValues: {
      invoice_id: invoiceId,
      amount: defaultAmount,
      paid_on: format(new Date(), 'yyyy-MM-dd'),
      method: 'bank_transfer',
      reference: '',
    },
  })

  async function handleFormSubmit(values: PaymentOutput) {
    // Not optimistic — a money consequence.
    const result = await recordPayment(values)
    if (!result.ok) {
      toast.error(result.error ?? 'Something went wrong. Try again.')
      return
    }
    toast.success('Payment recorded')
    onDone()
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      <TextField
        control={control}
        name="amount"
        label="Amount"
        inputMode="decimal"
        className="max-w-40"
        description="Change it for a part payment."
        autoFocus
      />
      <TextField control={control} name="paid_on" label="Date" type="date" />
      <SegmentedField control={control} name="method" label="Method" options={METHOD_OPTIONS} />
      <TextField control={control} name="reference" label="Reference" />

      <Button type="submit" className="h-11 w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Record payment'}
      </Button>
    </form>
  )
}
