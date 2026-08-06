'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { setFollowUpDone, setFollowUpsDoneBulk } from '@/lib/actions/interactions'
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkPending, setBulkPending] = useState(false)

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

  function toggleSelected(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Bulk clear is NOT optimistic — spec §6.4 reserves optimistic UI for
  // single-object, reversible mutations, and this touches many at once.
  // The single-row "Done" button above stays optimistic with Undo.
  async function markSelectedDone() {
    const ids = [...selected]
    if (ids.length === 0) return

    setBulkPending(true)
    const result = await setFollowUpsDoneBulk(ids)
    setBulkPending(false)

    if (!result.ok) {
      toast.error(result.error ?? 'Could not update follow-ups. Try again.')
      return
    }

    toast.success(`Cleared ${result.count ?? ids.length} follow-ups`)
    setSelected(new Set())
    router.refresh()
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
      {selected.size > 0 ? (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3 shadow-md">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={bulkPending}
            onClick={markSelectedDone}
          >
            Mark all done
          </Button>
        </div>
      ) : null}

      {visible.map((item) => (
        <div
          key={item.id}
          className="flex items-start justify-between gap-3 rounded-lg border p-3"
        >
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <label className="flex min-h-11 shrink-0 items-center px-1">
              <Checkbox
                checked={selected.has(item.id)}
                onCheckedChange={(v) => toggleSelected(item.id, v === true)}
                aria-label={`Select follow-up for ${item.customer_name ?? 'unknown customer'}`}
              />
            </label>
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
