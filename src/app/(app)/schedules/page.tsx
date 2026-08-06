import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { listSchedules } from '@/lib/queries/orders'
import { GenerateButton } from './generate-button'
import { SchedulesClient } from './schedules-client'

export default async function SchedulesPage() {
  const schedules = await listSchedules()

  // Rendered PERMANENTLY, not only after a generation run — otherwise a
  // schedule broken by a product being archived after the fact stays
  // broken until someone happens to press the generate button.
  const archivedWarnings = schedules.flatMap((s) =>
    s.recurring_order_items
      .filter((i) => i.products?.archived_at)
      .map(
        (i) =>
          `${s.customers?.name ?? 'A customer'}'s schedule includes "${i.products?.name}", which is archived.`,
      ),
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Schedules</h1>
        <Button asChild variant="outline" className="h-11">
          <Link href="/schedules/new">New schedule</Link>
        </Button>
      </div>

      <GenerateButton />

      {archivedWarnings.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Some schedules reference archived products</AlertTitle>
          <AlertDescription>
            <ul className="ml-4 list-disc space-y-1">
              {archivedWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <SchedulesClient schedules={schedules} />
    </div>
  )
}
