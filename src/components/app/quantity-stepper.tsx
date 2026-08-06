'use client'

import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Order entry is mostly quantities, so this is the single biggest mobile
 * win in the app: one tap versus focus -> type -> dismiss keyboard. The
 * input stays real (not a display) so typing 240 directly still works —
 * tapping "+" forty-eight times would be absurd.
 */
export function QuantityStepper({
  value,
  onChange,
  step = 5,
  min = 1,
  max = 100000,
  label,
  className,
}: {
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  label: string
  className?: string
}) {
  function clamp(n: number): number {
    return Math.min(max, Math.max(min, n))
  }

  function handleInputChange(raw: string) {
    const digits = raw.replace(/[^0-9]/g, '')
    if (digits === '') {
      onChange(min)
      return
    }
    onChange(clamp(Number(digits)))
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11 shrink-0"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        aria-label={`Decrease ${label} by ${step}`}
      >
        <Minus aria-hidden />
      </Button>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="h-11 w-20 text-center tabular-nums"
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        aria-label={label}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11 shrink-0"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        aria-label={`Increase ${label} by ${step}`}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  )
}
