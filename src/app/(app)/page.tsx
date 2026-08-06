import Link from 'next/link'
import { format, subDays } from 'date-fns'
import { DashboardSection } from '@/components/app/dashboard-section'
import { FollowUpsDue } from '@/components/app/follow-ups-due'
import { DeliveriesToday } from '@/components/app/deliveries-today'
import { WeekSummaryCard } from '@/components/app/week-summary-card'
import { MoneySummaryCards } from '@/components/app/money-summary-cards'
import { AtRiskCustomers } from '@/components/app/at-risk-customers'
import { RevenueChart } from '@/components/app/charts/revenue-chart'
import { ProductMixChart } from '@/components/app/charts/product-mix-chart'
import { NewCustomersChart } from '@/components/app/charts/new-customers-chart'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/app/money'
import { listFollowUpsDue } from '@/lib/queries/customers'
import { getWeekSummary, getMoneySummary } from '@/lib/queries/dashboard'
import {
  listAtRiskCustomers, getContactsFor,
  getRevenueByMonth, getProductPerformance, getNewCustomersByMonth,
} from '@/lib/queries/insights'

/**
 * Ordered as the answer to "what do I need to do today?". Each section is
 * filled by the phase named in its placeholder. Do not reorder them — the
 * order IS the design.
 */
export default async function DashboardPage() {
  const [followUps, weekSummary, moneySummary, atRisk, revenueSeries, productMix, newCustomers] =
    await Promise.all([
      listFollowUpsDue(),
      getWeekSummary(),
      getMoneySummary(),
      listAtRiskCustomers(),
      getRevenueByMonth(12),
      getProductPerformance(
        format(subDays(new Date(), 89), 'yyyy-MM-dd'),
        format(new Date(), 'yyyy-MM-dd'),
      ),
      getNewCustomersByMonth(12),
    ])
  const contactsByCustomer = await getContactsFor(
    atRisk.map((c) => c.customer_id).filter((id): id is string => id !== null),
  )

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

      <DashboardSection
        title="Needs attention"
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/insights">See all insights</Link>
          </Button>
        }
      >
        <AtRiskCustomers customers={atRisk} contactsByCustomer={contactsByCustomer} />
      </DashboardSection>

      <DashboardSection title="Trends">
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Revenue by month</CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueChart data={revenueSeries} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Product mix, last 90 days</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductMixChart data={productMix} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>New customers by month</CardTitle>
            </CardHeader>
            <CardContent>
              <NewCustomersChart data={newCustomers} />
            </CardContent>
          </Card>
        </div>
      </DashboardSection>
    </div>
  )
}
