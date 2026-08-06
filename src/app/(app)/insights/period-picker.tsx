'use client'

import { useTableUrlState } from '@/components/app/data-table/use-table-url-state'
import { PERIOD_OPTIONS, type Period, type PeriodKey } from '@/lib/period'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * State lives in the URL (?period=/?from=/?to=), same pattern as the list
 * pages — copying the address bar reproduces the view and a refresh
 * survives. The active tab and the custom-range disclosure both read the
 * raw `period` query param rather than the server-resolved `period` prop,
 * so picking "Custom" opens the date fields immediately even before a
 * valid range is chosen (resolvePeriod falls back to this month for the
 * DATA until then, which is the correct behaviour — it just should not
 * also yank the date pickers away).
 */
export function PeriodPicker({ period }: { period: Period }) {
  const { get, setParams } = useTableUrlState()

  const activeKey = (get('period') || period.key) as PeriodKey
  const fromValue = get('from') || (activeKey === period.key ? period.from : '')
  const toValue = get('to') || (activeKey === period.key ? period.to : '')

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PERIOD_OPTIONS.map((opt) => (
        <Button
          key={opt.key}
          type="button"
          variant={activeKey === opt.key ? 'default' : 'outline'}
          className="h-11"
          onClick={() => setParams({ period: opt.key, from: null, to: null })}
        >
          {opt.label}
        </Button>
      ))}

      {activeKey === 'custom' ? (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="h-11 w-40"
            aria-label="From date"
            value={fromValue}
            onChange={(e) => setParams({ period: 'custom', from: e.target.value })}
          />
          <span className="text-muted-foreground" aria-hidden>–</span>
          <Input
            type="date"
            className="h-11 w-40"
            aria-label="To date"
            value={toValue}
            onChange={(e) => setParams({ period: 'custom', to: e.target.value })}
          />
        </div>
      ) : null}
    </div>
  )
}
