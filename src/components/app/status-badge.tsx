import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Status is communicated by shape and label; colour only reinforces, so
 * it stays readable in greyscale and for colour-blind users.
 */
const STATUS_TONES: Record<string, string> = {
  lead: 'bg-muted text-muted-foreground',
  contacted: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  sampling: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  active: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  lapsed: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
  lost: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
}

export function StatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const tone = STATUS_TONES[status] ?? STATUS_TONES.lead
  const label = status.charAt(0).toUpperCase() + status.slice(1)

  return (
    <Badge variant="secondary" className={cn('gap-1.5 font-medium', tone, className)}>
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {label}
    </Badge>
  )
}
