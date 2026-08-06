'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RecordSheet } from '@/components/app/record-sheet'
import { ScheduleForm } from '@/components/app/schedule-form'
import { setScheduleActive, upsertSchedule } from '@/lib/actions/orders'
import { formatDate } from '@/lib/format'
import { nextOccurrences, type SchedulePattern } from '@/lib/recurrence'
import { DAYS_OF_WEEK, type ScheduleOutput } from '@/lib/schemas/orders'
import type { ScheduleWithItems } from '@/lib/queries/orders'
import type { OrderFormCustomer, OrderFormProduct } from '@/lib/queries/order-form'

function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`
}

function describePattern(s: ScheduleWithItems): string {
  if (s.frequency === 'monthly') return `The ${ordinal(s.day_of_month ?? 1)} of each month`
  const dayLabel = DAYS_OF_WEEK.find((d) => d.value === s.day_of_week)?.label ?? 'a day'
  return s.frequency === 'fortnightly' ? `Every other ${dayLabel}` : `Every ${dayLabel}`
}

export function ScheduleDetail({
  schedule,
  customers,
  products,
}: {
  schedule: ScheduleWithItems
  customers: OrderFormCustomer[]
  products: OrderFormProduct[]
}) {
  const router = useRouter()
  const [active, setActive] = useState(schedule.active)
  const [editOpen, setEditOpen] = useState(false)

  async function toggle(next: boolean) {
    const previous = active
    setActive(next)
    const result = await setScheduleActive(schedule.id, next)
    if (!result.ok) {
      setActive(previous)
      toast.error('Could not update schedule.', {
        duration: Infinity,
        action: { label: 'Retry', onClick: () => toggle(next) },
      })
    }
  }

  async function onEditSubmit(values: ScheduleOutput) {
    const result = await upsertSchedule(schedule.id, values)
    if (result.ok) {
      toast.success('Schedule saved')
      setEditOpen(false)
      router.refresh()
    }
    return result
  }

  const pattern: SchedulePattern = {
    frequency: schedule.frequency as SchedulePattern['frequency'],
    day_of_week: schedule.day_of_week,
    day_of_month: schedule.day_of_month,
    starts_on: schedule.starts_on,
    ends_on: schedule.ends_on,
  }
  const preview = nextOccurrences(pattern, 8)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">
              {schedule.customers?.name ?? 'Unknown customer'}
            </h1>
            {!active ? <Badge variant="secondary">Paused</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{describePattern(schedule)}</p>
          <Link href={`/customers/${schedule.customer_id}`} className="text-sm hover:underline">
            View customer
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            Active
            <Switch checked={active} onCheckedChange={toggle} aria-label="Schedule active" />
          </label>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => setEditOpen(true)}
          >
            <Pencil aria-hidden />
            Edit
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {schedule.recurring_order_items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
              >
                <span className="font-medium">
                  {item.products?.name ?? 'Unknown product'}
                  {item.products?.archived_at ? (
                    <Badge variant="destructive" className="ml-2">
                      Archived
                    </Badge>
                  ) : null}
                </span>
                <span className="tabular-nums text-muted-foreground">{item.quantity}</span>
              </div>
            ))}
            {schedule.notes ? (
              <p className="pt-2 text-sm text-muted-foreground">{schedule.notes}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next 8 deliveries</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>

      <RecordSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        title={`Edit schedule for ${schedule.customers?.name ?? 'customer'}`}
      >
        <ScheduleForm
          customers={customers}
          products={products}
          initial={schedule}
          submitLabel="Save changes"
          onSubmit={onEditSubmit}
        />
      </RecordSheet>
    </div>
  )
}
