import type { ReactNode } from 'react'

export function DashboardSection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function SectionPlaceholder({ phase }: { phase: string }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      Arrives in {phase}.
    </div>
  )
}
