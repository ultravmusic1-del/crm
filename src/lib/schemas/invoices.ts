import * as z from 'zod'
import { optionalText } from '@/lib/schemas/settings'

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'other'] as const
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank transfer', card: 'Card', other: 'Other',
}

export const INVOICE_STATUSES = ['draft', 'sent', 'overdue', 'paid', 'void'] as const
export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', overdue: 'Overdue', paid: 'Paid', void: 'Void',
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Pick a date' })

const money = z.coerce
  .number({ error: 'Enter an amount' })
  .min(0, { error: 'Cannot be negative' })
  .multipleOf(0.001, { error: 'At most three decimal places' })

export const createInvoiceSchema = z
  .object({
    customer_id: z.uuid({ error: 'Pick a customer' }),
    order_ids: z
      .array(z.uuid())
      .min(1, { error: 'Select at least one order' })
      .refine((ids) => new Set(ids).size === ids.length, {
        error: 'The same order is selected twice',
      }),
    issued_on: isoDate,
    due_on: isoDate,
  })
  .refine((v) => v.due_on >= v.issued_on, {
    error: 'The due date cannot be before the issue date',
    path: ['due_on'],
  })

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>

export const paymentSchema = z.object({
  invoice_id: z.uuid(),
  amount: money.refine((v) => v > 0, { error: 'Enter an amount above zero' }),
  paid_on: isoDate,
  method: z
    .string()
    .transform((v) => (v.trim().length > 0 ? v.trim() : null))
    .nullable()
    .refine((v) => v === null || (PAYMENT_METHODS as readonly string[]).includes(v), {
      error: 'Pick a payment method',
    }),
  reference: optionalText,
})

export type PaymentInput = z.input<typeof paymentSchema>
export type PaymentOutput = z.output<typeof paymentSchema>

export const adjustmentSchema = z.object({
  id: z.uuid(),
  discount_amount: money,
  delivery_charge: money,
})
