import { resolvePeriod } from '@/lib/period'
import {
  getOutreachEffectiveness, getProductPerformance, listCustomerSummaries,
} from '@/lib/queries/insights'
import { formatDateRange } from '@/lib/format'
import { PeriodPicker } from './period-picker'
import { RevenueByCustomer } from './revenue-by-customer'
import { ProductPerformanceTable } from './product-performance-table'
import { OrderCadence } from './order-cadence'
import { OutreachTable } from './outreach-table'

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  const sp = await searchParams
  const period = resolvePeriod(sp.period, sp.from, sp.to)

  const [summaries, performance, outreach] = await Promise.all([
    listCustomerSummaries(),
    getProductPerformance(period.from, period.to),
    getOutreachEffectiveness(period.from, period.to),
  ])

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Insights</h1>
          <p className="text-sm text-muted-foreground">
            {formatDateRange(period.from, period.to)}
          </p>
        </div>
        <PeriodPicker period={period} />
      </div>

      <ProductPerformanceTable rows={performance} />
      <RevenueByCustomer rows={summaries} />
      <OrderCadence rows={summaries} />
      <OutreachTable rows={outreach} />
    </div>
  )
}
