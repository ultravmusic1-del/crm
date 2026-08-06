import Link from 'next/link'
import {
  DashboardSection,
  SectionPlaceholder,
} from '@/components/app/dashboard-section'
import { FollowUpsDue } from '@/components/app/follow-ups-due'
import { Button } from '@/components/ui/button'
import { listFollowUpsDue } from '@/lib/queries/customers'

/**
 * Ordered as the answer to "what do I need to do today?". Each section is
 * filled by the phase named in its placeholder. Do not reorder them — the
 * order IS the design.
 */
export default async function DashboardPage() {
  const followUps = await listFollowUpsDue()

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
        <FollowUpsDue items={followUps} />
      </DashboardSection>

      <DashboardSection title="This week">
        <SectionPlaceholder phase="Phase 3" />
      </DashboardSection>

      <DashboardSection title="Money">
        <SectionPlaceholder phase="Phase 5" />
      </DashboardSection>

      <DashboardSection title="Needs attention">
        <SectionPlaceholder phase="Phase 6" />
      </DashboardSection>
    </div>
  )
}
