import { formatDate, formatDateTime } from '@/lib/format'

export function DateDisplay({
  value,
  withTime = false,
  className,
}: {
  value: string | Date | null | undefined
  withTime?: boolean
  className?: string
}) {
  const text = withTime ? formatDateTime(value) : formatDate(value)
  const iso = value
    ? typeof value === 'string'
      ? value
      : value.toISOString()
    : undefined
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  )
}
