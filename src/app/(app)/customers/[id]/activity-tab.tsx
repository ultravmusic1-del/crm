'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { parseISO } from 'date-fns'
import {
  Mail, Phone, MessageCircle, Handshake, Package, MoreHorizontal, type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { NoDataYet } from '@/components/app/empty-state'
import { InteractionSheet } from './interaction-sheet'
import { setFollowUpDone } from '@/lib/actions/interactions'
import {
  CHANNEL_LABELS, OUTCOME_LABELS, type Channel, type Outcome,
} from '@/lib/schemas/interactions'
import { BUSINESS_TIME_ZONE, formatDate } from '@/lib/format'
import type { Contact, InteractionWithContact } from '@/lib/queries/customers'
import { cn } from '@/lib/utils'

const CHANNEL_ICONS: Record<Channel, LucideIcon> = {
  email: Mail,
  phone: Phone,
  whatsapp: MessageCircle,
  in_person: Handshake,
  sample_drop: Package,
  other: MoreHorizontal,
}

// "Today" for the overdue check is the bakery's own calendar day, matching
// the same reasoning as the schema's own `todayInBusinessTimeZone` — the
// host process may run in UTC while it's already tomorrow in Bahrain.
function todayInBusinessTimeZone(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// `occurred_at` is a timestamptz — an instant — so it must be rendered in
// the business timezone regardless of where this component happens to
// render (a client component still gets an initial server-side pass, and
// that host is not guaranteed to be in Bahrain). Built from Intl parts with
// an explicit timeZone rather than date-fns' `format`, which always reads
// the host's local clock and would reproduce exactly the bug
// `lib/format.ts` exists to prevent.
function formatOccurredAt(iso: string): string {
  const d = parseISO(iso)
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TIME_ZONE, day: 'numeric' }).format(d)
  const month = new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TIME_ZONE, month: 'short' }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d)
  return `${day} ${month}, ${time}`
}

function monthGroupKey(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE, month: 'long', year: 'numeric',
  }).format(parseISO(iso))
}

function FollowUpLine({ interaction }: { interaction: InteractionWithContact }) {
  const [done, setDone] = useState(interaction.follow_up_done)

  if (!interaction.follow_up_on) return null
  const followUpOn = interaction.follow_up_on
  const overdue = !done && followUpOn < todayInBusinessTimeZone()

  async function toggle(next: boolean) {
    const previous = done
    setDone(next)
    const result = await setFollowUpDone({ id: interaction.id, done: next })
    if (!result.ok) {
      setDone(previous)
      toast.error('Could not update follow-up.', {
        duration: Infinity,
        action: { label: 'Retry', onClick: () => toggle(next) },
      })
    }
  }

  const label = done
    ? 'Followed up'
    : overdue
      ? `Overdue since ${formatDate(followUpOn)}`
      : `Follow up on ${formatDate(followUpOn)}`

  return (
    <label className="flex w-fit items-center gap-2 text-sm">
      <Checkbox checked={done} onCheckedChange={(v) => toggle(v === true)} />
      <span className={cn(overdue && 'font-medium text-destructive')}>{label}</span>
    </label>
  )
}

function ActivityEntry({ interaction }: { interaction: InteractionWithContact }) {
  const Icon = CHANNEL_ICONS[interaction.channel as Channel]
  return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-1 pb-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{CHANNEL_LABELS[interaction.channel as Channel]}</span>
          <span className="text-muted-foreground">{formatOccurredAt(interaction.occurred_at)}</span>
          {interaction.contacts ? (
            <span className="text-muted-foreground">{interaction.contacts.name}</span>
          ) : null}
          {interaction.direction === 'inbound' ? (
            <Badge variant="outline">They contacted us</Badge>
          ) : null}
          {interaction.outcome ? (
            <Badge variant="secondary">{OUTCOME_LABELS[interaction.outcome as Outcome]}</Badge>
          ) : null}
        </div>
        {interaction.subject ? <p className="font-medium">{interaction.subject}</p> : null}
        {interaction.notes ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{interaction.notes}</p>
        ) : null}
        <FollowUpLine interaction={interaction} />
      </div>
    </div>
  )
}

/**
 * Reverse chronological (the query already sorts descending), grouped by
 * month. This — not the customer's static details — is what turns a
 * contact list into a CRM, so it owns its own empty state and the
 * InteractionSheet that fills it.
 */
export function ActivityTab({
  customerId,
  contacts,
  interactions,
}: {
  customerId: string
  contacts: Contact[]
  interactions: InteractionWithContact[]
}) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<string, InteractionWithContact[]>()
    for (const interaction of interactions) {
      const key = monthGroupKey(interaction.occurred_at)
      const existing = map.get(key)
      if (existing) existing.push(interaction)
      else map.set(key, [interaction])
    }
    return Array.from(map.entries())
  }, [interactions])

  if (interactions.length === 0) {
    return (
      <>
        <NoDataYet
          icon={<Phone className="size-10" />}
          title="No outreach logged yet"
          description="Every call, email and sample drop goes here. It is what turns this from a contact list into a CRM."
          action={
            <Button type="button" className="h-11" onClick={() => setSheetOpen(true)}>
              Log interaction
            </Button>
          }
        />
        <InteractionSheet
          customerId={customerId}
          contacts={contacts}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />
      </>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map(([month, items]) => (
        <div key={month}>
          <h3 className="sticky top-14 z-10 bg-background py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {month}
          </h3>
          <div className="space-y-4 pt-2">
            {items.map((interaction) => (
              <ActivityEntry key={interaction.id} interaction={interaction} />
            ))}
          </div>
        </div>
      ))}
      <InteractionSheet
        customerId={customerId}
        contacts={contacts}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  )
}
