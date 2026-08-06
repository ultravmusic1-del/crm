import * as z from 'zod'
import { optionalEmail, optionalText } from '@/lib/schemas/settings'
import { normalisePhone } from '@/lib/format'

export const contactSchema = z.object({
  customer_id: z.uuid(),
  name: z.string().trim().min(1, { error: 'A name is required' }),
  role: optionalText.optional().default(''),
  email: optionalEmail.optional().default(''),
  phone: z.string().transform((v) => normalisePhone(v)).nullable().optional().default(''),
  is_primary: z.boolean().default(false),
  notes: optionalText.optional().default(''),
})

export type ContactInput = z.input<typeof contactSchema>
export type ContactOutput = z.output<typeof contactSchema>
