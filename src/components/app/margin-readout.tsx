'use client'

import { marginPercent } from '@/lib/pricing'
import { Money } from '@/components/app/money'
import { cn } from '@/lib/utils'

/**
 * Margin is computed live from price and cost as she types, so mispricing
 * is visible immediately rather than at month end.
 */
export function MarginReadout({
  price,
  cost,
  label = 'Margin',
  className,
}: {
  price: number | string
  cost: number | string
  label?: string
  className?: string
}) {
  let pct: number | null
  try {
    pct = marginPercent(price, cost)
  } catch {
    pct = null
  }

  if (pct === null) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)} aria-live="polite">
        {label}: set a price to see it
      </p>
    )
  }

  const profit = Number(price) - Number(cost)

  const tone =
    pct < 0
      ? 'text-destructive'
      : pct < 20
        ? 'text-amber-600 dark:text-amber-500'
        : 'text-emerald-600 dark:text-emerald-500'

  return (
    <p className={cn('text-sm', className)} aria-live="polite">
      <span className="text-muted-foreground">{label}: </span>
      {/* pct is a PERCENTAGE, not money — toFixed here is not the money
          formatting the codebase bans; the actual currency figure below
          goes through <Money />. */}
      <span className={cn('font-semibold tabular-nums', tone)}>{pct.toFixed(1)}%</span>
      <span className="text-muted-foreground">
        {' '}
        · <Money value={profit} /> per unit
      </span>
      {pct < 0 ? (
        <span className="ml-2 font-medium text-destructive">You are selling below cost.</span>
      ) : null}
    </p>
  )
}
