'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { setFollowUpDone } from '@/lib/actions/interactions'
import { formatDate } from '@/lib/format'
import type { FollowUpDue } from '@/lib/queries/customers'

function hasId(item: FollowUpDue): item is FollowUpDue & { id: string } {
  return item.id !== null
}

/**
 * "Reversible action → Undo toast, never a confirm dialog." Marking a
 * follow-up done is trivially reversible, so it clears optimistically and
 * offers Undo rather than asking "are you sure?" up front.
 */
export function FollowUpsDue({ items }: { items: FollowUpDue[] }) {
  const router = useRouter()
  const [cleared, setCleared] = useState<Set<string>>(new Set())

  const visible = items.filter(hasId).filter((item) => !cleared.has(item.id))

  function clear(id: string) {
    setCleared((prev) => new Set(prev).add(id))
  }

  function unclear(id: string) {
    setCleared((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function markDone(item: FollowUpDue & { id: string }) {
    clear(item.id)

    const result = await setFollowUpDone({ id: item.id, done: true })
    if (!result.ok) {
      unclear(item.id)
      toast.error('Could not update follow-up.', {
        duration: Infinity,
        action: { label: 'Retry', onClick: () => markDone(item) },
      })
      return
    }

    toast.success('Follow-up done', {
      action: {
        label: 'Undo',
        onClick: async () => {
          await setFollowUpDone({ id: item.id, done: false })
          unclear(item.id)
          router.refresh()
        },
      },
    })
  }

  if (visible.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
        <CheckCircle2 className="size-5" aria-hidden />
        No follow-ups due. Nice.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {visible.map((item) => (
        <div
          key={item.id}
          className="flex items-start justify-between gap-3 rounded-lg border p-3"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/customers/${item.customer_id ?? ''}`}
                className="font-medium hover:underline"
              >
                {item.customer_name ?? 'Unknown customer'}
              </Link>
              {item.is_overdue ? (
                <Badge variant="destructive">
                  Overdue &middot; {formatDate(item.follow_up_on)}
                </Badge>
              ) : (
                <Badge variant="secondary">Today</Badge>
              )}
            </div>
            {item.notes ? (
              <p className="truncate text-sm text-muted-foreground">{item.notes}</p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            onClick={() => markDone(item)}
          >
            Done
          </Button>
        </div>
      ))}
    </div>
  )
}
