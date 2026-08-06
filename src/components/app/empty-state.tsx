'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * "No data yet" and "no results for these filters" are two DIFFERENT
 * screens. Conflating them is the single most common internal-tool
 * mistake, so they are two exported components, not one with a flag.
 */
export function NoDataYet({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}

export function NoResults({
  activeFilters,
  onClear,
}: {
  activeFilters: string[]
  onClear: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <h2 className="text-base font-semibold">Nothing matches these filters</h2>
      {activeFilters.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Filtering by {activeFilters.join(', ')}.
        </p>
      ) : null}
      <Button variant="outline" onClick={onClear} className="h-11">
        Clear filters
      </Button>
    </div>
  )
}
