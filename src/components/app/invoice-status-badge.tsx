import { Badge } from '@/components/ui/badge'
import { INVOICE_STATUS_LABELS } from '@/lib/schemas/invoices'
import { cn } from '@/lib/utils'

/**
 * Status is communicated by shape and label; colour only reinforces, so it
 * stays readable in greyscale and for colour-blind users. Mirrors
 * status-badge.tsx / order-status-badge.tsx's pattern.
 *
 * Takes `computed_status`, never the stored one — `invoices.status` only
 * ever moves draft -> sent -> void; `overdue` and `paid` are derived and
 * must never be read off the stored column.
 */
const TONE: Record<string, string> = {
  draft:   'bg-muted text-muted-foreground',
  sent:    'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  overdue: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  paid:    'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  void:    'bg-muted text-muted-foreground line-through',
}

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const tone = TONE[status] ?? TONE.draft

  return (
    <Badge variant="secondary" className={cn('gap-1.5 font-medium', tone, className)}>
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {INVOICE_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}
