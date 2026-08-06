'use client'

import type { Column } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: {
  column: Column<TData, TValue>
  title: string
  className?: string
}) {
  if (!column.getCanSort()) {
    return <span className={cn('text-xs font-medium', className)}>{title}</span>
  }

  const sorted = column.getIsSorted()

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('-ml-2 h-8 gap-1 px-2 text-xs font-medium', className)}
      onClick={() => column.toggleSorting(sorted === 'asc')}
      aria-label={`Sort by ${title}, currently ${sorted || 'unsorted'}`}
    >
      {title}
      {sorted === 'asc' ? (
        <ArrowUp className="size-3.5" aria-hidden />
      ) : sorted === 'desc' ? (
        <ArrowDown className="size-3.5" aria-hidden />
      ) : (
        <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
      )}
    </Button>
  )
}
