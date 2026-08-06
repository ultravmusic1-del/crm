import * as z from 'zod'
import { optionalText } from '@/lib/schemas/settings'

export const ORDER_STATUSES = [
  'draft', 'confirmed', 'in_production', 'delivered', 'cancelled',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  in_production: 'In production',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

/**
 * A line carries product_id and quantity. NOTHING ELSE.
 * The server resolves the unit price and writes the snapshot; a price
 * arriving from the browser is discarded. Zod's default object stripping is
 * what enforces that here — do not add .passthrough().
 */
export const orderItemSchema = z.object({
  product_id: z.uuid({ error: 'Pick a product' }),
  quantity: z.coerce
    .number({ error: 'Enter a quantity' })
    .int({ error: 'Whole units only' })
    .gt(0, { error: 'Must be at least 1' }),
})

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Pick a delivery date' })

export const orderSchema = z.object({
  customer_id: z.uuid({ error: 'Pick a customer' }),
  delivery_date: isoDate,
  status: z.enum(ORDER_STATUSES).default('confirmed'),
  notes: optionalText.optional().default(''),
  items: z
    .array(orderItemSchema)
    .min(1, { error: 'Add at least one product' })
    .refine(
      (items) => new Set(items.map((i) => i.product_id)).size === items.length,
      { error: 'The same product is on this order twice — combine the lines' },
    ),
})

export type OrderInput = z.input<typeof orderSchema>
export type OrderOutput = z.output<typeof orderSchema>

export const orderStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(ORDER_STATUSES),
})

export const RECURRENCE_FREQUENCIES = ['weekly', 'fortnightly', 'monthly'] as const

/** 0 = Sunday. Matches extract(dow) and date-fns getDay(). */
export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const

export const scheduleSchema = z
  .object({
    customer_id: z.uuid({ error: 'Pick a customer' }),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    day_of_week: z.coerce.number().int().min(0).max(6).nullable().optional(),
    day_of_month: z.coerce.number().int().min(1).max(28).nullable().optional(),
    starts_on: isoDate,
    ends_on: z
      .string()
      .transform((v) => (v.trim().length > 0 ? v.trim() : null))
      .nullable()
      .optional()
      .default(''),
    active: z.boolean().default(true),
    notes: optionalText.optional().default(''),
    items: z
      .array(orderItemSchema)
      .min(1, { error: 'Add at least one product' })
      .refine(
        (items) => new Set(items.map((i) => i.product_id)).size === items.length,
        { error: 'The same product is on this schedule twice' },
      ),
  })
  // Mirrors the recurring_orders_day_matches_frequency check constraint.
  .refine(
    (s) =>
      s.frequency === 'monthly'
        ? s.day_of_month !== null && s.day_of_month !== undefined
        : s.day_of_week !== null && s.day_of_week !== undefined,
    { error: 'Pick which day it repeats on', path: ['day_of_week'] },
  )
  .refine((s) => !s.ends_on || s.ends_on >= s.starts_on, {
    error: 'The end date must be on or after the start date',
    path: ['ends_on'],
  })

export type ScheduleInput = z.input<typeof scheduleSchema>
export type ScheduleOutput = z.output<typeof scheduleSchema>
