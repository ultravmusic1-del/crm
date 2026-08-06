import {
  DashboardSection,
  SectionPlaceholder,
} from '@/components/app/dashboard-section'

/**
 * Ordered as the answer to "what do I need to do today?". Each section is
 * filled by the phase named in its placeholder. Do not reorder them — the
 * order IS the design.
 */
export default async function DashboardPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Today</h1>

      <DashboardSection title="Today">
        <SectionPlaceholder phase="Phase 1" />
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
