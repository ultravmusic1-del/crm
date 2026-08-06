import * as z from 'zod'

/**
 * Shared by every optional free-text column in this app: trims, then turns
 * a blank string into `null` so "cleared" and "never set" are the same
 * value in the database rather than an empty-string / null split.
 */
export const optionalText = z
  .string()
  .trim()
  .nullable()
  .transform((v) => (v === null || v === '' ? null : v))

/**
 * Same shape as `optionalText`, plus lowercasing (so lookups and display
 * are case-insensitive) and a refinement that a non-null value is a valid
 * email address.
 */
export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .nullable()
  .transform((v) => (v === null || v === '' ? null : v))
  .refine((v) => v === null || z.email().safeParse(v).success, {
    error: 'Enter a valid email address',
  })

const requiredText = z.string().trim().min(1, { error: 'Required' })

/**
 * `next_invoice_number` is deliberately absent: it is allocated atomically
 * inside a Postgres function in Phase 5, and a settings form that could
 * write it would be a lost-update race with a UI attached. Any caller that
 * passes it (e.g. by spreading a full `AppSettings` row) simply loses the
 * key — `z.object` strips unrecognised properties by default.
 */
export const settingsSchema = z.object({
  business_name: requiredText,
  business_email: optionalEmail,
  business_phone: optionalText,
  address_line1: optionalText,
  address_line2: optionalText,
  city: optionalText,
  postcode: optionalText,
  country: optionalText,

  timezone: requiredText,
  currency_code: requiredText,
  currency_symbol: requiredText,
  invoice_prefix: requiredText,
  currency_decimals: z.coerce
    .number()
    .int({ error: '0 to 3' })
    .min(0, { error: '0 to 3' })
    .max(3, { error: '0 to 3' }),
  default_payment_terms_days: z.coerce
    .number()
    .int({ error: '0 or more' })
    .min(0, { error: '0 or more' }),
  lapse_threshold_days: z.coerce
    .number()
    .int({ error: 'Must be at least 1 day' })
    .min(1, { error: 'Must be at least 1 day' }),

  bank_name: optionalText,
  bank_account_name: optionalText,
  bank_account_number: optionalText,
  bank_iban: optionalText,
  bank_swift: optionalText,
})

export type SettingsInput = z.input<typeof settingsSchema>
export type SettingsOutput = z.output<typeof settingsSchema>
