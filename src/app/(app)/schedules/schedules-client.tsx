'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CalendarClock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { NoDataYet } from '@/components/app/empty-state'
import { formatDate } from '@/lib/format'
import { nextOccurrences, type SchedulePattern } from '@/lib/recurrence'
import { setScheduleActive } from '@/lib/actions/orders'
import { DAYS_OF_WEEK } from '@/lib/schemas/orders'
import type { ScheduleWithItems } from '@/lib/queries/orders'
import { cn } from '@/lib/utils'

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

function ScheduleCard({ schedule }: { schedule: ScheduleWithItems }) {
  const [active, setActive] = useState(schedule.active)

  // Reversible single-object mutation: local state first, then confirm —
  // a failed toggle rolls back with a persistent Retry toast rather than
  // silently reverting.
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

  const pattern: SchedulePattern = {
    frequency: schedule.frequency as SchedulePattern['frequency'],
    day_of_week: schedule.day_of_week,
    day_of_month: schedule.day_of_month,
    starts_on: schedule.starts_on,
    ends_on: schedule.ends_on,
  }
  const next = nextOccurrences(pattern, 1)[0]

  return (
    <li className={cn('rounded-lg border p-4', !active && 'opacity-60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Link href={`/schedules/${schedule.id}`} className="min-w-0 flex-1">
          <p className="font-medium hover:underline">
            {schedule.customers?.name ?? 'Unknown customer'}
          </p>
          <p className="text-sm text-muted-foreground">{describePattern(schedule)}</p>
        </Link>
        <div className="flex items-center gap-2">
          {!active ? <Badge variant="secondary">Paused</Badge> : null}
          <Switch
            checked={active}
            onCheckedChange={toggle}
            aria-label={`${schedule.customers?.name ?? 'Schedule'} active`}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{schedule.recurring_order_items.length} item(s)</span>
        <span>Next: {next ? formatDate(next) : 'Never — check the day and dates'}</span>
      </div>
    </li>
  )
}

export function SchedulesClient({ schedules }: { schedules: ScheduleWithItems[] }) {
  if (schedules.length === 0) {
    return (
      <NoDataYet
        icon={<CalendarClock className="size-10" aria-hidden />}
        title="No standing orders yet"
        description="If a café takes the same thing every Tuesday, set it up once here and generate the orders with one button."
      />
    )
  }

  return (
    <ul className="space-y-3">
      {schedules.map((s) => (
        <ScheduleCard key={s.id} schedule={s} />
      ))}
    </ul>
  )
}
