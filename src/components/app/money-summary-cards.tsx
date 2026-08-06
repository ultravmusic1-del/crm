import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Money } from '@/components/app/money'
import { cn } from '@/lib/utils'
import type { MoneySummary } from '@/lib/queries/dashboard'

function revenueDelta(thisMonth: number, lastMonth: number): string {
  if (lastMonth === 0) return '—'
  const pct = ((thisMonth - lastMonth) / lastMonth) * 100
  const sign = pct > 0 ? '+' : ''
  // pct is a PERCENTAGE, not money — this is not the banned money toFixed.
  return `${sign}${pct.toFixed(0)}%`
}

export function MoneySummaryCards({ summary }: { summary: MoneySummary }) {
  const delta = revenueDelta(summary.revenueThisMonth, summary.revenueLastMonth)
  const deltaUp = summary.revenueThisMonth >= summary.revenueLastMonth

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Card>
        <CardContent className="space-y-1 py-4">
          <p className="text-sm text-muted-foreground">Revenue this month</p>
          <p className="text-2xl font-semibold tabular-nums">
            <Money value={summary.revenueThisMonth} />
          </p>
          {delta !== '—' ? (
            <p className={cn('text-sm', deltaUp ? 'text-emerald-600' : 'text-destructive')}>
              {delta} vs last month
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">— vs last month</p>
          )}
        </CardContent>
      </Card>

      <Link href="/invoices">
        <Card className="h-full transition-colors hover:bg-accent/50">
          <CardContent className="space-y-1 py-4">
            <p className="text-sm text-muted-foreground">Outstanding</p>
            <p className="text-2xl font-semibold tabular-nums">
              <Money value={summary.outstanding} />
            </p>
            <p className="text-sm text-muted-foreground">
              {summary.outstandingCount} invoice{summary.outstandingCount === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>
      </Link>

      <Link href="/invoices?status=overdue">
        <Card className="h-full transition-colors hover:bg-accent/50">
          <CardContent className="space-y-1 py-4">
            <p className="text-sm text-muted-foreground">Overdue</p>
            <p
              className={cn(
                'text-2xl font-semibold tabular-nums',
                summary.overdue > 0 && 'text-destructive',
              )}
            >
              <Money value={summary.overdue} />
            </p>
            <p className="text-sm text-muted-foreground">
              {summary.overdueCount} invoice{summary.overdueCount === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>
      </Link>
    </div>
  )
}
