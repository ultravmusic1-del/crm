'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { setOrderStatusBulk } from '@/lib/actions/orders'
import { Button } from '@/components/ui/button'

/**
 * Not optimistic — it touches many objects at once, so we wait for the
 * server to confirm before updating the UI. Optimistic UI here is reserved
 * for single-object, reversible mutations.
 */
export function MarkInProduction({ orderIds }: { orderIds: string[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  if (orderIds.length === 0) return null

  return (
    <Button
      variant="outline"
      className="h-11"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        const result = await setOrderStatusBulk(orderIds, 'in_production')
        setBusy(false)
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        toast.success(`Marked ${result.count} order${result.count === 1 ? '' : 's'} in production`)
        router.refresh()
      }}
    >
      Mark this week&apos;s orders in production
    </Button>
  )
}
