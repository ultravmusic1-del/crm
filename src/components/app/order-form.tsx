'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { addDays, format, nextFriday, nextTuesday } from 'date-fns'
import { ChevronsUpDown, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { Field, FieldContent, FieldLabel, FieldError } from '@/components/ui/field'
import { SelectField, TextAreaField } from '@/components/app/form-fields'
import { QuantityStepper } from '@/components/app/quantity-stepper'
import { Money } from '@/components/app/money'
import {
  orderSchema, ORDER_STATUSES, ORDER_STATUS_LABELS,
  type OrderInput, type OrderOutput,
} from '@/lib/schemas/orders'
import { fetchCustomerContext } from '@/lib/actions/orders'
import type { OrderFormCustomer, OrderFormProduct } from '@/lib/queries/order-form'
import type { OrderWithItems } from '@/lib/queries/orders'
import type { ActionResult } from '@/lib/actions/auth'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS = ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }))

const SOURCE_LABEL: Record<string, string> = {
  custom: 'Custom',
  wholesale: 'Wholesale',
  retail: 'Retail',
}

type PriceInfo = { price: number; source: string }
type ArrayError = { message?: string; root?: { message?: string } }

function toDefaultValues(order?: OrderWithItems): OrderInput {
  return {
    customer_id: order?.customer_id ?? '',
    delivery_date: order?.delivery_date ?? '',
    status: (order?.status as OrderInput['status']) ?? 'confirmed',
    notes: order?.notes ?? '',
    items:
      order?.order_items.map((i) => ({ product_id: i.product_id, quantity: i.quantity })) ?? [],
  }
}

export function OrderForm({
  customers,
  products,
  initial,
  onSubmit,
  submitLabel,
}: {
  customers: OrderFormCustomer[]
  products: OrderFormProduct[]
  initial?: OrderWithItems
  onSubmit: (
    values: OrderOutput,
  ) => Promise<ActionResult & { id?: string; detachedFromSchedule?: boolean }>
  submitLabel: string
}) {
  const {
    control,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<OrderInput, unknown, OrderOutput>({
    resolver: zodResolver(orderSchema),
    mode: 'onTouched',
    defaultValues: toDefaultValues(initial),
  })

  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' })

  const customerId = useWatch({ control, name: 'customer_id' })
  const deliveryDate = useWatch({ control, name: 'delivery_date' })
  const items = useWatch({ control, name: 'items' })

  // Prices are NEVER computed or sent by the browser. They are fetched from
  // the server whenever the chosen customer changes, purely to show what
  // the order is expected to cost — resolvePrices() re-resolves them again,
  // authoritatively, on submit. There is no price input anywhere in this
  // form; if the map and the eventual invoice ever disagree, the database
  // is right.
  const [prices, setPrices] = useState<Map<string, PriceInfo>>(new Map())
  const [lastOrder, setLastOrder] = useState<{ product_id: string; quantity: number }[]>([])
  const [, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false)
  const [addPopoverOpen, setAddPopoverOpen] = useState(false)
  const addTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    startTransition(() => {
      if (!customerId) {
        setPrices(new Map())
        setLastOrder([])
        return
      }
      fetchCustomerContext(customerId).then(({ prices: p, lastOrderItems }) => {
        setPrices(
          new Map(
            p.map((row) => [row.product_id, { price: row.effective_price, source: row.price_source }]),
          ),
        )
        setLastOrder(lastOrderItems)
      })
    })
  }, [customerId])

  const selectedCustomer = customers.find((c) => c.id === customerId)
  const selectedProductIds = new Set((items ?? []).map((i) => i?.product_id))
  const availableProducts = products.filter((p) => !selectedProductIds.has(p.id))

  // Display only — a preview of what the invoice will likely be. The
  // authoritative total is `line_total`, a generated column in Postgres,
  // computed server-side from the snapshot unit_price on each order_item.
  const runningTotal = (items ?? []).reduce((sum, item) => {
    if (!item) return sum
    const info = prices.get(item.product_id)
    return sum + (info ? info.price * (Number(item.quantity) || 0) : 0)
  }, 0)

  const dateChips = [
    { label: 'Tomorrow', date: addDays(new Date(), 1) },
    { label: 'This Friday', date: nextFriday(new Date()) },
    { label: 'Next Tuesday', date: nextTuesday(new Date()) },
  ]

  const itemsError = errors.items as ArrayError | undefined
  const itemsErrorMessage = itemsError?.message ?? itemsError?.root?.message

  async function handleFormSubmit(values: OrderOutput) {
    setSubmitError(null)
    const result = await onSubmit(values)
    // Order creation has server-generated identity and a money consequence
    // — never optimistic, and the form is never cleared on error, so
    // nothing typed is lost.
    if (!result.ok) {
      const message = result.error ?? 'Something went wrong. Try again.'
      setSubmitError(message)
      toast.error(message)
    }
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6 pb-28 md:pb-24">
      <div className="space-y-4">
        <Field data-invalid={Boolean(errors.customer_id)}>
          <FieldLabel htmlFor="customer-combobox">Customer</FieldLabel>
          <FieldContent>
            <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="customer-combobox"
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={customerPopoverOpen}
                  aria-invalid={Boolean(errors.customer_id)}
                  className="h-11 w-full justify-between font-normal"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {selectedCustomer ? (
                      <>
                        <span className="truncate">{selectedCustomer.name}</span>
                        <Badge variant="secondary" className="shrink-0 capitalize">
                          {selectedCustomer.price_tier}
                        </Badge>
                      </>
                    ) : (
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
                          <span className="min-w-0 flex-1 truncate">{c.name}</span>
                          <Badge variant="secondary" className="shrink-0 capitalize">
                            {c.price_tier}
                          </Badge>
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

        {selectedCustomer && lastOrder.length > 0 && (items ?? []).length === 0 ? (
          <Button
            type="button"
            variant="secondary"
            className="h-11"
            onClick={() => replace(lastOrder)}
          >
            Repeat last order ({lastOrder.length} lines)
          </Button>
        ) : null}
      </div>

      <Field data-invalid={Boolean(errors.delivery_date)}>
        <FieldLabel htmlFor="delivery-date">Delivery date</FieldLabel>
        <FieldContent>
          <div className="flex flex-wrap gap-2">
            {dateChips.map((chip) => {
              const iso = format(chip.date, 'yyyy-MM-dd')
              const pressed = deliveryDate === iso
              return (
                <button
                  key={chip.label}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() =>
                    setValue('delivery_date', iso, { shouldValidate: true, shouldDirty: true })
                  }
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
          <Controller
            control={control}
            name="delivery_date"
            render={({ field }) => (
              <Input
                id="delivery-date"
                type="date"
                className="h-11 w-full"
                value={field.value ? String(field.value) : ''}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
                aria-invalid={Boolean(errors.delivery_date)}
              />
            )}
          />
          <FieldError errors={errors.delivery_date ? [errors.delivery_date] : undefined} />
        </FieldContent>
      </Field>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Items</h2>

        {fields.map((field, index) => {
          const product = products.find((p) => p.id === field.product_id)
          const info = prices.get(field.product_id)
          const quantity = Number(items?.[index]?.quantity) || 0

          return (
            <div key={field.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{product?.name ?? 'Unknown product'}</p>
                  {info ? (
                    <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                      <span>
                        <Money value={info.price} /> per {product?.unit ?? 'unit'}
                      </span>
                      <Badge variant="secondary">{SOURCE_LABEL[info.source] ?? info.source}</Badge>
                    </p>
                  ) : (
                    <p className="mt-0.5 text-sm text-destructive">No price set for this product</p>
                  )}
                </div>
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

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <Controller
                  control={control}
                  name={`items.${index}.quantity`}
                  render={({ field: qField }) => (
                    <QuantityStepper
                      value={Number(qField.value) || 0}
                      onChange={qField.onChange}
                      label={`${product?.name ?? 'Item'} quantity`}
                    />
                  )}
                />
                <span className="tabular-nums font-medium">
                  <Money value={info ? info.price * quantity : 0} />
                </span>
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
              disabled={!customerId || availableProducts.length === 0}
            >
              <Plus aria-hidden />
              {!customerId
                ? 'Pick a customer first'
                : availableProducts.length === 0
                  ? 'Every product is already on this order'
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

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name="status"
          label="Status"
          options={STATUS_OPTIONS}
          className="max-w-52"
        />
      </div>

      <TextAreaField control={control} name="notes" label="Notes" rows={2} />

      {submitError ? (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      ) : null}

      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-4 border-t bg-background/95 px-4 py-3 backdrop-blur',
          'md:static md:inset-auto md:z-auto md:border-t-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none',
        )}
      >
        <div className="text-sm">
          <span className="text-muted-foreground">Total </span>
          <span className="text-base font-semibold tabular-nums">
            <Money value={runningTotal} />
          </span>
        </div>
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
