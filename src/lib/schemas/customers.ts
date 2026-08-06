import * as z from 'zod'
import { optionalEmail, optionalText } from '@/lib/schemas/settings'
import { normalisePhone } from '@/lib/format'

/** Pipeline order, not alphabetical. The UI shows them in this order. */
export const CUSTOMER_STATUSES = [
  'lead', 'contacted', 'sampling', 'active', 'lapsed', 'lost',
] as const
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number]

export const CUSTOMER_TYPES = ['business', 'individual'] as const
export const PRICE_TIERS = ['wholesale', 'retail'] as const

/** Suggested in a datalist, never enforced. `source` is free text by design. */
export const SOURCE_SUGGESTIONS = [
  'Walk-in', 'Instagram', 'Referral', 'Market stall',
  'Cold call', 'Sample drop', 'Event',
] as const

const optionalPhone = z
  .string()
  .transform((v) => normalisePhone(v))
  .nullable()

export const customerSchema = z.object({
  name: z.string().trim().min(1, { error: 'A name is required' }),
  type: z.enum(CUSTOMER_TYPES).default('business'),
  status: z.enum(CUSTOMER_STATUSES).default('lead'),
  email: optionalEmail.optional().default(''),
  phone: optionalPhone.optional().default(''),
  address_line1: optionalText.optional().default(''),
  address_line2: optionalText.optional().default(''),
  city: optionalText.optional().default(''),
  postcode: optionalText.optional().default(''),
  delivery_notes: optionalText.optional().default(''),
  source: optionalText.optional().default(''),
  price_tier: z.enum(PRICE_TIERS).default('wholesale'),
  notes: optionalText.optional().default(''),
})

export type CustomerInput = z.input<typeof customerSchema>
export type CustomerOutput = z.output<typeof customerSchema>

/** Inline status edit from the list and the detail header. */
export const customerStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(CUSTOMER_STATUSES),
})

/** Autosaving notes field on the detail page. */
export const customerNotesSchema = z.object({
  id: z.uuid(),
  notes: optionalText,
})
