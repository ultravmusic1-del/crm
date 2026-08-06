'use client'

import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { RecordSheet } from '@/components/app/record-sheet'
import { ChannelPicker } from '@/components/app/channel-picker'
import { TextField, SelectField } from '@/components/app/form-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldContent, FieldLabel, FieldError } from '@/components/ui/field'
import { logInteraction } from '@/lib/actions/interactions'
import {
  interactionSchema,
  OUTCOMES,
  OUTCOME_LABELS,
  FOLLOW_UP_CHIPS,
  followUpOffsetToDate,
  type Channel,
  type InteractionInput,
  type InteractionOutput,
} from '@/lib/schemas/interactions'
import { BUSINESS_TIME_ZONE } from '@/lib/format'
import type { Contact } from '@/lib/queries/customers'
import { cn } from '@/lib/utils'

// `channel` is a required enum with no blank/default in interactionSchema —
// on purpose, so the resolver rejects an unpicked channel. "Nothing chosen
// yet" is still a real UI state though, so the sentinel below stands in for
// it in defaultValues; ChannelPicker's own `value: Channel | ''` prop type
// makes that contract explicit at the call site.
const EMPTY_CHANNEL = '' as unknown as Channel

/**
 * `occurred_at`/the follow-up date picker's `min` both need "now"/"today"
 * as the bakery experiences it, not the host process's local clock — same
 * reasoning as `lib/format.ts` and the schema's own
 * `todayInBusinessTimeZone`. Kept local rather than exported from the
 * schema file, which is off-limits for this task.
 */
function nowForDateTimeLocal(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

function todayForDateInput(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function blank(
  customerId: string,
  contacts: Contact[],
  prefillSubject?: string,
): InteractionInput {
  const primary = contacts.find((c) => c.is_primary) ?? contacts[0]
  return {
    customer_id: customerId,
    contact_id: primary?.id ?? '',
    occurred_at: nowForDateTimeLocal(),
    channel: EMPTY_CHANNEL,
    direction: 'outbound',
    subject: prefillSubject ?? '',
    notes: '',
    outcome: '',
    follow_up_on: '',
  }
}

/**
 * The most-repeated action in the app: log an interaction with a follow-up
 * in under 20 seconds on a phone. Field order is the design — channel
 * (icon taps), contact, notes (autofocused — it's what she came here to
 * type), outcome, follow-up, then a disclosure for the rarely-touched
 * fields.
 */
export function InteractionSheet({
  customerId,
  contacts,
  open,
  onOpenChange,
  prefillSubject,
}: {
  customerId: string
  contacts: Contact[]
  open: boolean
  onOpenChange: (open: boolean) => void
  prefillSubject?: string
}) {
  const {
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { isSubmitting },
  } = useForm<InteractionInput, unknown, InteractionOutput>({
    resolver: zodResolver(interactionSchema),
    mode: 'onTouched',
    defaultValues: blank(customerId, contacts, prefillSubject),
  })

  useEffect(() => {
    if (open) reset(blank(customerId, contacts, prefillSubject))
    // Reset only when the sheet transitions open, not on every prop change —
    // re-running for e.g. a contacts refetch while open would blow away
    // whatever the user has already typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function submitAndClose(values: InteractionOutput) {
    const result = await logInteraction(values)
    if (!result.ok) {
      toast.error(result.error ?? 'Could not log interaction. Try again.')
      return
    }
    toast.success('Interaction logged')
    onOpenChange(false)
  }

  async function submitAndLogAnother(values: InteractionOutput) {
    const result = await logInteraction(values)
    if (!result.ok) {
      toast.error(result.error ?? 'Could not log interaction. Try again.')
      return
    }
    toast.success('Logged. Ready for the next one.')
    // She is usually logging several of the same kind in a row — keep the
    // channel, clear everything else.
    const channel = getValues('channel')
    reset({ ...blank(customerId, contacts), channel })
  }

  const contactOptions = contacts.map((c) => ({ value: c.id, label: c.name }))

  return (
    <RecordSheet open={open} onOpenChange={onOpenChange} title="Log interaction">
      <form className="flex flex-col gap-5 pb-2">
        <Controller
          control={control}
          name="channel"
          render={({ field, fieldState }) => (
            <div className="space-y-1.5">
              <ChannelPicker
                value={field.value as Channel | ''}
                onChange={field.onChange}
                invalid={fieldState.invalid}
              />
              <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
            </div>
          )}
        />

        {contacts.length > 0 ? (
          <SelectField
            control={control}
            name="contact_id"
            label="Who did you speak to?"
            options={contactOptions}
            placeholder="Nobody in particular"
          />
        ) : null}

        <Controller
          control={control}
          name="notes"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="interaction-notes">What happened?</FieldLabel>
              <FieldContent>
                <Textarea
                  id="interaction-notes"
                  rows={4}
                  autoFocus
                  placeholder="Dropped two samples with Sam. Wants a price list."
                  value={field.value ? String(field.value) : ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
              </FieldContent>
            </Field>
          )}
        />

        <Controller
          control={control}
          name="outcome"
          render={({ field }) => (
            <Field>
              <FieldLabel id="outcome-label">Outcome</FieldLabel>
              <FieldContent>
                <div
                  role="radiogroup"
                  aria-labelledby="outcome-label"
                  className="grid grid-cols-2 gap-2"
                >
                  {OUTCOMES.map((o) => {
                    const checked = field.value === o
                    return (
                      <button
                        key={o}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        onClick={() => field.onChange(checked ? '' : o)}
                        className={cn(
                          'h-11 rounded-lg border border-input px-3 text-sm font-medium transition-colors',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'bg-transparent hover:bg-muted',
                        )}
                      >
                        {OUTCOME_LABELS[o]}
                      </button>
                    )
                  })}
                </div>
              </FieldContent>
            </Field>
          )}
        />

        <Controller
          control={control}
          name="follow_up_on"
          render={({ field, fieldState }) => {
            const value = field.value ? String(field.value) : ''
            return (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="follow-up-date">Follow up on</FieldLabel>
                <FieldContent>
                  <div className="flex flex-wrap gap-2">
                    {FOLLOW_UP_CHIPS.map((chip) => {
                      const date = followUpOffsetToDate(chip.value)
                      const pressed = value === date
                      return (
                        <button
                          key={chip.value}
                          type="button"
                          aria-pressed={pressed}
                          onClick={() => field.onChange(pressed ? '' : date)}
                          className={cn(
                            'h-11 rounded-lg border border-input px-3 text-sm font-medium transition-colors',
                            pressed
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'bg-transparent hover:bg-muted',
                          )}
                        >
                          {chip.label}
                        </button>
                      )
                    })}
                  </div>
                  <Input
                    id="follow-up-date"
                    type="date"
                    min={todayForDateInput()}
                    className="h-11 w-full"
                    value={value}
                    onChange={(e) => field.onChange(e.target.value)}
                    onBlur={field.onBlur}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
                </FieldContent>
              </Field>
            )
          }}
        />

        <details className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer select-none text-sm font-medium">
            Change the date or add a subject
          </summary>
          <div className="mt-3 space-y-4">
            <TextField
              control={control}
              name="occurred_at"
              label="When"
              type="datetime-local"
            />
            <TextField control={control} name="subject" label="Subject" />
          </div>
        </details>
      </form>

      <div className="sticky bottom-0 -mx-4 mt-4 flex justify-end gap-2 border-t bg-background px-4 py-3">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={isSubmitting}
          onClick={handleSubmit(submitAndLogAnother)}
        >
          Save and log another
        </Button>
        <Button
          type="button"
          className="h-11"
          disabled={isSubmitting}
          onClick={handleSubmit(submitAndClose)}
        >
          Save
        </Button>
      </div>
    </RecordSheet>
  )
}
