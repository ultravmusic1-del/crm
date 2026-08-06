'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { addDays, format, parseISO } from 'date-fns'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Money } from '@/components/app/money'
import { DateDisplay } from '@/components/app/date-display'
import { OrderStatusBadge } from '@/components/app/order-status-badge'
import { NoDataYet } from '@/components/app/empty-state'
import { createInvoice, fetchUninvoicedOrders, setInvoiceAdjustment } from '@/lib/actions/invoices'
import { BUSINESS_TIME_ZONE } from '@/lib/format'
import type { OrderStatus } from '@/lib/schemas/orders'
import { cn } from '@/lib/utils'

type BillableCustomer = { id: string; name: string; count: number; value: number }
type BillableOrder = Awaited<ReturnType<typeof fetchUninvoicedOrders>>[number]

/** "Today" as the bakery experiences it, not the browser's local clock —
 * same reasoning as lib/format.ts and the orders list's date chips. */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function InvoiceBuilder({
  customers,
  defaultTermsDays,
}: {
  customers: BillableCustomer[]
  defaultTermsDays: number
}) {
  const router = useRouter()
  const [isLoadingOrders, startLoadOrders] = useTransition()
  const [isSubmitting, startSubmit] = useTransition()

  const [customerId, setCustomerId] = useState<string | null>(null)
  const [orders, setOrders] = useState<BillableOrder[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [issuedOn, setIssuedOn] = useState(todayISO())
  const [dueOn, setDueOn] = useState(() =>
    format(addDays(parseISO(todayISO()), defaultTermsDays), 'yyyy-MM-dd'),
  )
  const [dueTouched, setDueTouched] = useState(false)

  const [showAdjustment, setShowAdjustment] = useState(false)
  const [discountAmount, setDiscountAmount] = useState('0')
  const [deliveryCharge, setDeliveryCharge] = useState('0')

  const [error, setError] = useState<string | null>(null)

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null

  function pickCustomer(id: string) {
    setCustomerId(id)
    setError(null)
    startLoadOrders(async () => {
      const rows = await fetchUninvoicedOrders(id)
      setOrders(rows)
      setSelected(new Set(rows.map((r) => r.order_id)))
    })
  }

  function handleIssuedOnChange(value: string) {
    setIssuedOn(value)
    if (!dueTouched && value) {
      const parsed = parseISO(value)
      if (!Number.isNaN(parsed.getTime())) {
        setDueOn(format(addDays(parsed, defaultTermsDays), 'yyyy-MM-dd'))
      }
    }
  }

  function toggleOrder(orderId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(orderId)
      else next.delete(orderId)
      return next
    })
  }

  const allSelected = orders.length > 0 && selected.size === orders.length

  const selectedSubtotal = useMemo(
    () => orders.filter((o) => selected.has(o.order_id)).reduce((sum, o) => sum + o.subtotal, 0),
    [orders, selected],
  )

  const discount = Number(discountAmount) || 0
  const delivery = Number(deliveryCharge) || 0
  const runningTotal = Math.max(selectedSubtotal + delivery - discount, 0)

  async function handleSubmit() {
    if (!customerId || selected.size === 0) return
    setError(null)

    startSubmit(async () => {
      const result = await createInvoice({
        customer_id: customerId,
        order_ids: [...selected],
        issued_on: issuedOn,
        due_on: dueOn,
      })

      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }

      if (showAdjustment && (discount > 0 || delivery > 0)) {
        const adjustResult = await setInvoiceAdjustment({
          id: result.id,
          discount_amount: discount,
          delivery_charge: delivery,
        })
        if (!adjustResult.ok) {
          toast.error('Invoice created, but the adjustment did not save. Set it on the invoice page.')
          router.push(`/invoices/${result.id}`)
          return
        }
      }

      toast.success('Invoice created')
      router.push(`/invoices/${result.id}`)
    })
  }

  if (!customerId) {
    if (customers.length === 0) {
      return (
        <NoDataYet
          icon={<FileText className="size-10" aria-hidden />}
          title="Nothing to invoice"
          description="Every delivered order is already on an invoice. Record some orders first."
        />
      )
    }

    return (
      <div className="space-y-2">
        {customers.map((c) => (
          <Card
            key={c.id}
            role="button"
            tabIndex={0}
            onClick={() => pickCustomer(c.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') pickCustomer(c.id)
            }}
            className="cursor-pointer transition-colors hover:bg-accent/50"
          >
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted-foreground">
                  {c.count} uninvoiced order{c.count === 1 ? '' : 's'}
                </p>
              </div>
              <Money value={c.value} className="text-lg font-semibold" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-28">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Billing <span className="font-medium text-foreground">{selectedCustomer?.name}</span>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setCustomerId(null)
            setOrders([])
            setSelected(new Set())
          }}
        >
          Change customer
        </Button>
      </div>

      {isLoadingOrders ? (
        <p className="text-sm text-muted-foreground">Loading orders…</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) =>
                setSelected(checked ? new Set(orders.map((o) => o.order_id)) : new Set())
              }
              aria-label="Select all orders"
              className="size-5"
            />
            <span className="text-sm font-medium">Select all</span>
          </div>

          <div className="divide-y rounded-lg border">
            {orders.map((o) => (
              <label
                key={o.order_id}
                className="flex cursor-pointer items-center gap-3 p-3"
              >
                <Checkbox
                  checked={selected.has(o.order_id)}
                  onCheckedChange={(checked) => toggleOrder(o.order_id, Boolean(checked))}
                  aria-label={`Select order #${o.order_number}`}
                  className="size-5"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">#{o.order_number}</span>
                    <DateDisplay value={o.delivery_date} className="text-sm text-muted-foreground" />
                    <OrderStatusBadge status={o.status as OrderStatus} />
                  </div>
                  <p className="text-sm text-muted-foreground">{o.total_units} units</p>
                </div>
                <Money value={o.subtotal} className="tabular-nums font-medium" />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="issued_on" className="text-sm font-medium">
            Issued
          </label>
          <Input
            id="issued_on"
            type="date"
            className="h-11"
            value={issuedOn}
            onChange={(e) => handleIssuedOnChange(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="due_on" className="text-sm font-medium">
            Due
          </label>
          <Input
            id="due_on"
            type="date"
            className="h-11"
            value={dueOn}
            onChange={(e) => {
              setDueTouched(true)
              setDueOn(e.target.value)
            }}
          />
        </div>
      </div>

      {!showAdjustment ? (
        <Button type="button" variant="link" className="px-0" onClick={() => setShowAdjustment(true)}>
          Add a discount or delivery charge
        </Button>
      ) : (
        <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="delivery_charge" className="text-sm font-medium">
              Delivery charge
            </label>
            <Input
              id="delivery_charge"
              inputMode="decimal"
              className="h-11 max-w-36"
              value={deliveryCharge}
              onChange={(e) => setDeliveryCharge(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="discount_amount" className="text-sm font-medium">
              Discount
            </label>
            <Input
              id="discount_amount"
              inputMode="decimal"
              className="h-11 max-w-36"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
            />
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-4 border-t bg-background/95 px-4 py-3 backdrop-blur',
          'md:sticky md:inset-auto md:px-0',
        )}
      >
        <div>
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-xl font-semibold tabular-nums">
            <Money value={runningTotal} />
          </p>
        </div>
        <Button
          type="button"
          className="h-11"
          disabled={selected.size === 0 || isSubmitting}
          onClick={handleSubmit}
        >
          {isSubmitting ? 'Creating…' : 'Create invoice'}
        </Button>
      </div>
    </div>
  )
}
