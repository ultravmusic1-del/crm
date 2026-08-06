'use client'

import { useMemo, useRef, useState } from 'react'
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { ChevronsUpDown, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { Field, FieldContent, FieldLabel, FieldError } from '@/components/ui/field'
import { TextField, TextAreaField, SegmentedField } from '@/components/app/form-fields'
import { QuantityStepper } from '@/components/app/quantity-stepper'
import {
  scheduleSchema,
  RECURRENCE_FREQUENCIES,
  DAYS_OF_WEEK,
  type ScheduleInput,
  type ScheduleOutput,
} from '@/lib/schemas/orders'
import { nextOccurrences, type SchedulePattern } from '@/lib/recurrence'
import { formatDate } from '@/lib/format'
import type { OrderFormCustomer, OrderFormProduct } from '@/lib/queries/order-form'
import type { ScheduleWithItems } from '@/lib/queries/orders'
import type { ActionResult } from '@/lib/actions/auth'
import { cn } from '@/lib/utils'

const FREQUENCY_OPTIONS = RECURRENCE_FREQUENCIES.map((f) => ({
  value: f,
  label: f.charAt(0).toUpperCase() + f.slice(1),
}))

const DAY_OPTIONS = DAYS_OF_WEEK.map((d) => ({
  value: String(d.value),
  label: d.label.slice(0, 3),
}))

type ArrayError = { message?: string; root?: { message?: string } }
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function toDefaultValues(schedule?: ScheduleWithItems): ScheduleInput {
  return {
    customer_id: schedule?.customer_id ?? '',
    frequency: (schedule?.frequency as ScheduleInput['frequency']) ?? 'weekly',
    day_of_week: schedule?.day_of_week ?? null,
    day_of_month: schedule?.day_of_month ?? null,
    starts_on: schedule?.starts_on ?? '',
    ends_on: schedule?.ends_on ?? '',
    active: schedule?.active ?? true,
    notes: schedule?.notes ?? '',
    items:
      schedule?.recurring_order_items.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
      })) ?? [],
  }
}

export function ScheduleForm({
  customers,
  products,
  initial,
  onSubmit,
  submitLabel,
}: {
  customers: OrderFormCustomer[]
  products: OrderFormProduct[]
  initial?: ScheduleWithItems
  onSubmit: (values: ScheduleOutput) => Promise<ActionResult & { id?: string }>
  submitLabel: string
}) {
  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<ScheduleInput, unknown, ScheduleOutput>({
    resolver: zodResolver(scheduleSchema),
    mode: 'onTouched',
    defaultValues: toDefaultValues(initial),
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  const customerId = useWatch({ control, name: 'customer_id' })
  const frequency = useWatch({ control, name: 'frequency' })
  const dayOfWeek = useWatch({ control, name: 'day_of_week' })
  const dayOfMonth = useWatch({ control, name: 'day_of_month' })
  const startsOn = useWatch({ control, name: 'starts_on' })
  const endsOn = useWatch({ control, name: 'ends_on' })
  const items = useWatch({ control, name: 'items' })

  const [submitError, setSubmitError] = useState<string | null>(null)
  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false)
  const [addPopoverOpen, setAddPopoverOpen] = useState(false)
  const addTriggerRef = useRef<HTMLButtonElement>(null)

  const selectedCustomer = customers.find((c) => c.id === customerId)

  // A schedule may reference a product archived AFTER it was created — that
  // product will not be in `products` (getOrderFormData filters archived
  // products out, correctly, so it cannot be ADDED to a new schedule) but
  // its name must still render for an existing line rather than silently
  // disappearing.
  const productLookup = useMemo(() => {
    const map = new Map<string, { id: string; name: string; unit?: string }>()
    for (const p of products) map.set(p.id, p)
    if (initial) {
      for (const item of initial.recurring_order_items) {
        if (!map.has(item.product_id) && item.products) {
          map.set(item.product_id, { id: item.products.id, name: item.products.name })
        }
      }
    }
    return map
  }, [products, initial])

  const selectedProductIds = new Set((items ?? []).map((i) => i?.product_id))
  const availableProducts = products.filter((p) => !selectedProductIds.has(p.id))

  const pattern: SchedulePattern = {
    frequency: (frequency as SchedulePattern['frequency']) ?? 'weekly',
    day_of_week:
      dayOfWeek === null || dayOfWeek === undefined || String(dayOfWeek) === ''
        ? null
        : Number(dayOfWeek),
    day_of_month:
      dayOfMonth === null || dayOfMonth === undefined || String(dayOfMonth) === ''
        ? null
        : Number(dayOfMonth),
    starts_on: typeof startsOn === 'string' ? startsOn : '',
    ends_on: endsOn ? String(endsOn) : null,
  }
  const validStart = ISO_DATE_RE.test(pattern.starts_on)
  const preview = validStart ? nextOccurrences(pattern, 8) : []

  const itemsError = errors.items as ArrayError | undefined
  const itemsErrorMessage = itemsError?.message ?? itemsError?.root?.message

  async function handleFormSubmit(values: ScheduleOutput) {
    setSubmitError(null)
    const result = await onSubmit(values)
    if (!result.ok) {
      const message = result.error ?? 'Something went wrong. Try again.'
      setSubmitError(message)
      toast.error(message)
    }
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6 pb-28 md:pb-24">
      <Field data-invalid={Boolean(errors.customer_id)}>
        <FieldLabel htmlFor="schedule-customer-combobox">Customer</FieldLabel>
        <FieldContent>
          <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                id="schedule-customer-combobox"
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={customerPopoverOpen}
                aria-invalid={Boolean(errors.customer_id)}
                className="h-11 w-full justify-between font-normal"
              >
                <span className="truncate">
                  {selectedCustomer ? selectedCustomer.name : (
                    <span className="text-muted-foreground">Pick a customer</span>
                  )}
                </span>
                <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search customers…" />
                <CommandList>
                  <CommandEmpty>No customer found.</CommandEmpty>
                  <CommandGroup>
                    {customers.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.name}
                        onSelect={() => {
                          setValue('customer_id', c.id, { shouldValidate: true, shouldDirty: true })
                          setCustomerPopoverOpen(false)
                        }}
                      >
                        {c.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <FieldError errors={errors.customer_id ? [errors.customer_id] : undefined} />
        </FieldContent>
      </Field>

      <SegmentedField control={control} name="frequency" label="Repeats" options={FREQUENCY_OPTIONS} />

      {frequency === 'monthly' ? (
        <TextField
          control={control}
          name="day_of_month"
          label="Day of month"
          inputMode="numeric"
          className="max-w-24"
          description="1 to 28. Capped at 28 so every month has that day."
        />
      ) : (
        <SegmentedField
          control={control}
          name="day_of_week"
          label="Day of week"
          options={DAY_OPTIONS}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField control={control} name="starts_on" label="Starts on" type="date" />
        <TextField
          control={control}
          name="ends_on"
          label="Ends on"
          type="date"
          description="Leave empty to run until you turn it off."
        />
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <h2 className="text-sm font-medium">Next 8 deliveries</h2>
        {preview.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {preview.map((d) => (
              <Badge key={d} variant="secondary">
                {formatDate(d)}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This pattern never comes due — check the day and the dates.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Items</h2>
        <p className="text-sm text-muted-foreground">
          Quantities only — a schedule holds no prices. Prices resolve when each order is
          generated, using whatever is current for this customer at that time.
        </p>

        {fields.map((field, index) => {
          const product = productLookup.get(field.product_id)
          const quantity = Number(items?.[index]?.quantity) || 0

          return (
            <div key={field.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{product?.name ?? 'Unknown product'}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                  onClick={() => remove(index)}
                >
                  <Trash2 aria-hidden />
                  <span className="sr-only">Remove {product?.name ?? 'product'}</span>
                </Button>
              </div>
              <div className="mt-3">
                <Controller
                  control={control}
                  name={`items.${index}.quantity`}
                  render={({ field: qField }) => (
                    <QuantityStepper
                      value={Number(qField.value) || quantity}
                      onChange={qField.onChange}
                      label={`${product?.name ?? 'Item'} quantity`}
                    />
                  )}
                />
              </div>
            </div>
          )
        })}

        <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              ref={addTriggerRef}
              type="button"
              variant="outline"
              className="h-11 w-full"
              disabled={availableProducts.length === 0}
            >
              <Plus aria-hidden />
              {availableProducts.length === 0
                ? 'Every product is already on this schedule'
                : 'Add product'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <Command>
              <CommandInput autoFocus placeholder="Search products…" />
              <CommandList>
                <CommandEmpty>No product found.</CommandEmpty>
                <CommandGroup>
                  {availableProducts.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.name}
                      onSelect={() => {
                        append({ product_id: p.id, quantity: 10 })
                        setAddPopoverOpen(false)
                        addTriggerRef.current?.focus()
                      }}
                    >
                      {p.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {itemsErrorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {itemsErrorMessage}
          </p>
        ) : null}
      </div>

      <TextAreaField control={control} name="notes" label="Notes" rows={2} />

      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
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
