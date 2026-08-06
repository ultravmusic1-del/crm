'use client'

import type { ReactNode } from 'react'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'

/**
 * A right-hand NON-MODAL sheet, so the list behind stays visible and
 * readable. NN/g's data-tables research found users routinely refer to
 * other records while editing one — a modal covers exactly the rows they
 * need. modal={false} is the whole point of this component; do not remove
 * it "to fix" the focus behaviour.
 *
 * Full pages are for multi-section creation (a new order with line items).
 * Real modals are ONLY for irreversible confirmation.
 */
export function RecordSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="px-4 pt-4">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="flex-1 px-4 pb-4 pt-2">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
