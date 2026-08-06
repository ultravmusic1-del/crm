'use client'

import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export type ActiveFilter = { key: string; label: string }

/**
 * Filters must be visibly active with one-click clear.
 */
export function FilterChips({
  filters,
  onRemove,
  onClearAll,
}: {
  filters: ActiveFilter[]
  onRemove: (key: string) => void
  onClearAll: () => void
}) {
  if (filters.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => (
        <Badge key={f.key} variant="secondary" className="gap-1 py-1 pl-2 pr-1">
          {f.label}
          <button
            type="button"
            onClick={() => onRemove(f.key)}
            aria-label={`Remove filter ${f.label}`}
            className="rounded-full p-0.5 hover:bg-muted-foreground/20"
          >
            <X className="size-3" aria-hidden />
          </button>
        </Badge>
      ))}
      {filters.length > 1 ? (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearAll}>
          Clear all
        </Button>
      ) : null}
    </div>
  )
}
