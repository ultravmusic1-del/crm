import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/app/money'
import { formatDateRange } from '@/lib/format'
import type { WeekSummary } from '@/lib/queries/dashboard'

export function WeekSummaryCard({ summary }: { summary: WeekSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{formatDateRange(summary.from, summary.to)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{summary.orderCount}</p>
            <p className="text-sm text-muted-foreground">
              order{summary.orderCount === 1 ? '' : 's'}
            </p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              <Money value={summary.orderValue} />
            </p>
            <p className="text-sm text-muted-foreground">order value</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{summary.unitCount}</p>
            <p className="text-sm text-muted-foreground">units to bake</p>
          </div>
        </div>
        <Link
          href="/production"
          className="inline-block text-sm font-medium underline-offset-4 hover:underline"
        >
          See the bake list
        </Link>
      </CardContent>
    </Card>
  )
}
