'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { addDays, format, nextFriday, nextTuesday } from 'date-fns'
import { ChevronLeft, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { QuantityStepper } from '@/components/app/quantity-stepper'
import { Money } from '@/components/app/money'
import { createOrder, fetchCustomerContext } from '@/lib/actions/orders'
import type { OrderFormCustomer, OrderFormProduct } from '@/lib/queries/order-form'
import { fold } from '@/lib/aliases'
import { cn } from '@/lib/utils'

type Line = { product_id: string; quantity: number }
type PriceInfo = { price: number; source: string }
type CustomerContext = { prices: Map<string, PriceInfo>; lastOrderItems: Line[] }

/**
 * Two screens in one component, driven by `step`. Reuses QuantityStepper
 * and Money but deliberately does NOT reuse OrderForm — its status field,
 * notes field and product-source badges are exactly what this flow strips
 * out. Completable entirely with steppers: no keyboard required.
 */
export function QuickOrderClient({
  customers,
  products,
}: {
  customers: OrderFormCustomer[]
  products: OrderFormProduct[]
}) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [contextByCustomer, setContextByCustomer] = useState<Record<string, CustomerContext>>({})
  const [linesByCustomer, setLinesByCustomer] = useState<Record<string, Line[]>>({})
  const [loadingCustomer, setLoadingCustomer] = useState(false)
  const [deliveryDate, setDeliveryDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'))
  const [addPopoverOpen, setAddPopoverOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const filteredCustomers = customerSearch.trim()
    ? customers.filter((c) => fold(c.name).includes(fold(customerSearch)))
    : customers

  async function selectCustomer(id: string) {
    setCustomerId(id)
    setStep(2)
    // Returning to the same customer keeps whatever she already adjusted —
    // only fetch (and only seed from the last order) the first time.
    if (!contextByCustomer[id]) {
      setLoadingCustomer(true)
      const ctx = await fetchCustomerContext(id)
      const priceMap = new Map(
        ctx.prices.map((p) => [p.product_id, { price: p.effective_price, source: p.price_source }]),
      )
      setContextByCustomer((prev) => ({
        ...prev,
        [id]: { prices: priceMap, lastOrderItems: ctx.lastOrderItems },
      }))
      setLinesByCustomer((prev) => ({
        ...prev,
        [id]: ctx.lastOrderItems.map((i) => ({ ...i })),
      }))
      setLoadingCustomer(false)
    }
  }

  const customer = customers.find((c) => c.id === customerId)
  const context = customerId ? contextByCustomer[customerId] : undefined
  const lines = customerId ? (linesByCustomer[customerId] ?? []) : []
  const prices = context?.prices ?? new Map<string, PriceInfo>()
  const selectedProductIds = new Set(lines.map((l) => l.product_id))
  const availableProducts = products.filter((p) => !selectedProductIds.has(p.id))

  function updateLines(fn: (lines: Line[]) => Line[]) {
    if (!customerId) return
    setLinesByCustomer((prev) => ({ ...prev, [customerId]: fn(prev[customerId] ?? []) }))
  }

  function setQuantity(productId: string, quantity: number) {
    updateLines((ls) => ls.map((l) => (l.product_id === productId ? { ...l, quantity } : l)))
  }

  function removeLine(productId: string) {
    updateLines((ls) => ls.filter((l) => l.product_id !== productId))
  }

  function addProduct(productId: string) {
    updateLines((ls) => [...ls, { product_id: productId, quantity: 5 }])
    setAddPopoverOpen(false)
  }

  // Display only, exactly like OrderForm — the authoritative price is
  // resolved server-side again inside createOrder.
  const runningTotal = lines.reduce((sum, l) => {
    const info = prices.get(l.product_id)
    return sum + (info ? info.price * l.quantity : 0)
  }, 0)

  const dateChips = [
    { label: 'Tomorrow', date: addDays(new Date(), 1) },
    { label: 'This Friday', date: nextFriday(new Date()) },
    { label: 'Next Tuesday', date: nextTuesday(new Date()) },
  ]

  async function handleSave() {
    if (!customerId || lines.length === 0) return
    setSubmitting(true)
    const result = await createOrder({
      customer_id: customerId,
      delivery_date: deliveryDate,
      status: 'confirmed',
      notes: '',
      items: lines,
    })
    setSubmitting(false)
    if (!result.ok) {
      toast.error(result.error ?? 'Could not save the order. Try again.')
      return
    }
    toast.success('Order saved')
    router.push(`/orders/${result.id}`)
  }

  if (step === 1) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Quick order</h1>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder="Search customers…"
            className="h-11 pl-9"
          />
        </div>
        <div className="space-y-2">
          {filteredCustomers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No customers match.</p>
          ) : (
            filteredCustomers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCustomer(c.id)}
                className="flex min-h-16 w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted"
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-sm capitalize text-muted-foreground">{c.price_tier}</span>
              </button>
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          onClick={() => setStep(1)}
        >
          <ChevronLeft aria-hidden />
          <span className="sr-only">Back to customer list</span>
        </Button>
        <h1 className="truncate text-xl font-semibold">{customer?.name ?? 'Quick order'}</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {dateChips.map((chip) => {
          const iso = format(chip.date, 'yyyy-MM-dd')
          const pressed = deliveryDate === iso
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={pressed}
              onClick={() => setDeliveryDate(iso)}
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

      {loadingCustomer ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading her usual order…</p>
      ) : (
        <div className="space-y-3">
          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No previous order to start from. Add a product below.
            </p>
          ) : null}

          {lines.map((line) => {
            const product = products.find((p) => p.id === line.product_id)
            const info = prices.get(line.product_id)
            return (
              <div key={line.product_id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{product?.name ?? 'Unknown product'}</p>
                    {info ? (
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        <Money value={info.price} /> per {product?.unit ?? 'unit'}
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
                    onClick={() => removeLine(line.product_id)}
                  >
                    <Trash2 aria-hidden />
                    <span className="sr-only">Remove {product?.name ?? 'product'}</span>
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <QuantityStepper
                    value={line.quantity}
                    onChange={(v) => setQuantity(line.product_id, v)}
                    step={5}
                    label={`${product?.name ?? 'Item'} quantity`}
                  />
                  <span className="tabular-nums font-medium">
                    <Money value={info ? info.price * line.quantity : 0} />
                  </span>
                </div>
              </div>
            )
          })}

          <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full"
                disabled={availableProducts.length === 0}
              >
                <Plus aria-hidden />
                {availableProducts.length === 0 ? 'Every product is already on this order' : 'Add product'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <Command>
                <CommandInput autoFocus placeholder="Search products…" />
                <CommandList>
                  <CommandEmpty>No product found.</CommandEmpty>
                  <CommandGroup>
                    {availableProducts.map((p) => (
                      <CommandItem key={p.id} value={p.name} onSelect={() => addProduct(p.id)}>
                        {p.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <div className="text-sm">
          <span className="text-muted-foreground">Total </span>
          <span className="text-base font-semibold tabular-nums">
            <Money value={runningTotal} />
          </span>
        </div>
        <Button
          type="button"
          size="lg"
          className="h-14 text-base"
          disabled={submitting || lines.length === 0}
          onClick={handleSave}
        >
          {submitting ? 'Saving…' : 'Save order'}
        </Button>
      </div>
    </div>
  )
}
