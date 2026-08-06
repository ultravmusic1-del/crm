import * as z from 'zod'
import { addDays, addWeeks, format } from 'date-fns'
import { optionalText } from '@/lib/schemas/settings'
import { BUSINESS_TIME_ZONE } from '@/lib/format'

export const CHANNELS = [
  'email', 'phone', 'whatsapp', 'in_person', 'sample_drop', 'other',
] as const
export type Channel = (typeof CHANNELS)[number]

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  in_person: 'In person',
  sample_drop: 'Sample drop',
  other: 'Other',
}

export const OUTCOMES = [
  'no_response', 'interested', 'not_interested', 'ordered', 'follow_up', 'other',
] as const
export type Outcome = (typeof OUTCOMES)[number]

export const OUTCOME_LABELS: Record<Outcome, string> = {
  no_response: 'No response',
  interested: 'Interested',
  not_interested: 'Not interested',
  ordered: 'Ordered',
  follow_up: 'Follow up',
  other: 'Other',
}

export const DIRECTIONS = ['outbound', 'inbound'] as const

/**
 * "Today" for the past-follow-up-date check is the bakery's own calendar
 * day, not the server's. The server can run in UTC while it is already
 * tomorrow in Bahrain (or still yesterday) — using the business timezone
 * keeps the boundary where the bakery actually experiences it.
 */
function todayInBusinessTimeZone(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Turns a blank string ("nothing chosen" from a select or date input)
 * into null so downstream refinements only ever see a real value or null. */
function blankToNull(v: string): string | null {
  return v.trim() === '' ? null : v
}

export const interactionSchema = z.object({
  customer_id: z.uuid(),
  contact_id: z
    .string()
    .transform(blankToNull)
    .nullable()
    .optional()
    .default(null)
    .refine((v) => v === null || z.uuid().safeParse(v).success, {
      error: 'Pick a valid contact',
    }),
  occurred_at: z.string().trim().min(1, { error: 'Required' }),
  channel: z.enum(CHANNELS, { error: 'Pick how you contacted them' }),
  direction: z.enum(DIRECTIONS).default('outbound'),
  subject: optionalText.optional().default(''),
  notes: optionalText.optional().default(''),
  outcome: z
    .string()
    .transform(blankToNull)
    .nullable()
    .optional()
    .default(null)
    .refine((v) => v === null || OUTCOMES.includes(v as Outcome), {
      error: 'Pick a valid outcome',
    }),
  follow_up_on: z
    .string()
    .transform(blankToNull)
    .nullable()
    .optional()
    .default(null)
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), {
      error: 'Use YYYY-MM-DD',
    })
    .refine((v) => v === null || v >= todayInBusinessTimeZone(), {
      error: 'Follow-up date cannot be in the past',
    }),
})

export type InteractionInput = z.input<typeof interactionSchema>
export type InteractionOutput = z.output<typeof interactionSchema>

/** Marking a follow-up done from the dashboard's "due" list. */
export const followUpDoneSchema = z.object({
  id: z.uuid(),
  done: z.boolean(),
})

export type FollowUpOffset = 'tomorrow' | '3d' | '1w' | '2w'

export const FOLLOW_UP_CHIPS: { value: FollowUpOffset; label: string }[] = [
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: '3d', label: 'In 3 days' },
  { value: '1w', label: 'Next week' },
  { value: '2w', label: 'In 2 weeks' },
]

/**
 * Pure and injectable so it is testable without mocking the clock: given
 * `from`, resolves a chip offset to a plain YYYY-MM-DD date. `addDays` /
 * `addWeeks` and `format` all operate on `from`'s own local calendar
 * representation, so the day-count math is stable across host timezones —
 * it is the same three days later wherever the process happens to run.
 */
export function followUpOffsetToDate(
  offset: FollowUpOffset,
  from: Date = new Date(),
): string {
  switch (offset) {
    case 'tomorrow':
      return format(addDays(from, 1), 'yyyy-MM-dd')
    case '3d':
      return format(addDays(from, 3), 'yyyy-MM-dd')
    case '1w':
      return format(addWeeks(from, 1), 'yyyy-MM-dd')
    case '2w':
      return format(addWeeks(from, 2), 'yyyy-MM-dd')
  }
}
