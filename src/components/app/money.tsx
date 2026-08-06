'use client'

import { formatMoney } from '@/lib/format'
import { useSettings } from '@/components/app/settings-provider'
import { cn } from '@/lib/utils'

/**
 * ALL money rendering goes through here. No ad-hoc toFixed anywhere in the
 * codebase — a later phase greps for it and fails the build.
 */
export function Money({
  value,
  className,
}: {
  value: number | string | null | undefined
  className?: string
}) {
  const settings = useSettings()
  return (
    <span className={cn('tabular-nums', className)}>
      {formatMoney(value, settings)}
    </span>
  )
}
