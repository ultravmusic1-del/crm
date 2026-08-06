'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { generateScheduledOrders, type GenerationResult } from '@/lib/actions/orders'

/**
 * A VISIBLE BUTTON, never a render-time call. Next 16 forbids writes
 * during a render, and a prefetch of this page would race a background
 * generation run — a button she understands beats a job she cannot see.
 */
export function GenerateButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<GenerationResult | null>(null)

  function handleClick() {
    startTransition(async () => {
      const response = await generateScheduledOrders(21)
      if (!response.ok) {
        toast.error(response.error)
        return
      }
      setResult(response.result ?? null)
      const created = response.result?.created_count ?? 0
      const skipped = response.result?.skipped_count ?? 0
      if (created === 0) {
        toast.info(`Nothing new — ${skipped} orders already existed`)
      } else {
        toast.success(`Created ${created} orders`)
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <Button type="button" className="h-11" onClick={handleClick} disabled={isPending}>
        {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Generate upcoming orders (21 days)
      </Button>

      {result ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Created {result.created_count}. Skipped {result.skipped_count} that already existed.
        </p>
      ) : null}

      {result && result.warnings.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Some lines were skipped</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
