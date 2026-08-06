import Link from 'next/link'
import {
  DashboardSection,
  SectionPlaceholder,
} from '@/components/app/dashboard-section'
import { FollowUpsDue } from '@/components/app/follow-ups-due'
import { DeliveriesToday } from '@/components/app/deliveries-today'
import { WeekSummaryCard } from '@/components/app/week-summary-card'
import { MoneySummaryCards } from '@/components/app/money-summary-cards'
import { Button } from '@/components/ui/button'
import { Money } from '@/components/app/money'
import { listFollowUpsDue } from '@/lib/queries/customers'
import { getWeekSummary, getMoneySummary } from '@/lib/queries/dashboard'

/**
 * Ordered as the answer to "what do I need to do today?". Each section is
 * filled by the phase named in its placeholder. Do not reorder them — the
 * order IS the design.
 */
export default async function DashboardPage() {
  const [followUps, weekSummary, moneySummary] = await Promise.all([
    listFollowUpsDue(),
    getWeekSummary(),
    getMoneySummary(),
  ])

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Today</h1>

      <DashboardSection
        title="Today"
        action={
          followUps.length > 0 ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/customers?followup=due">See all</Link>
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <FollowUpsDue items={followUps} />
          <DeliveriesToday items={weekSummary.deliveriesToday} />
        </div>
      </DashboardSection>

      <DashboardSection title="This week">
        <div className="space-y-3">
          <WeekSummaryCard summary={weekSummary} />
          {moneySummary.unbilledDeliveredCount > 0 ? (
            <Link
              href="/invoices/new"
              className="block rounded-lg border border-dashed p-3 text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              {moneySummary.unbilledDeliveredCount} delivered order
              {moneySummary.unbilledDeliveredCount === 1 ? '' : 's'} worth{' '}
              <Money value={moneySummary.unbilledDeliveredValue} /> not yet invoiced
            </Link>
          ) : null}
        </div>
      </DashboardSection>

      <DashboardSection title="Money">
        <MoneySummaryCards summary={moneySummary} />
      </DashboardSection>

      <DashboardSection title="Needs attention">
        <SectionPlaceholder phase="Phase 6" />
      </DashboardSection>
    </div>
  )
}
