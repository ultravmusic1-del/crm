import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/schemas/orders'
import { cn } from '@/lib/utils'

/**
 * Status is communicated by shape and label; colour only reinforces, so
 * it stays readable in greyscale and for colour-blind users. Mirrors
 * status-badge.tsx's pattern for customers.
 */
const STATUS_TONES: Record<OrderStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  confirmed: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  in_production: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  delivered: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  cancelled: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
}

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus
  className?: string
}) {
  const tone = STATUS_TONES[status] ?? STATUS_TONES.draft

  return (
    <Badge variant="secondary" className={cn('gap-1.5 font-medium', tone, className)}>
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  )
}
