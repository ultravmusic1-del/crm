'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { shiftWeek } from '@/lib/week'
import { Button } from '@/components/ui/button'
import { BUSINESS_TIME_ZONE } from '@/lib/format'

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

export function WeekPicker({ from }: { from: string }) {
  const router = useRouter()
  const params = useSearchParams()

  function go(week: string) {
    const next = new URLSearchParams(params.toString())
    next.set('week', week)
    router.replace(`/production?${next.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        className="size-11"
        onClick={() => go(shiftWeek(from, -1))}
      >
        <ChevronLeft className="size-4" aria-hidden />
        <span className="sr-only">Previous week</span>
      </Button>
      <Button variant="outline" className="h-11" onClick={() => go(todayISO())}>
        This week
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-11"
        onClick={() => go(shiftWeek(from, 1))}
      >
        <ChevronRight className="size-4" aria-hidden />
        <span className="sr-only">Next week</span>
      </Button>
      <Button className="h-11" onClick={() => window.print()}>
        <Printer className="size-4" aria-hidden />
        Print
      </Button>
    </div>
  )
}
