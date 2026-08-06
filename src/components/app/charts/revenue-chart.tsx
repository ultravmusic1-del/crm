'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { format, parseISO } from 'date-fns'
import type { MonthlyRevenue } from '@/lib/queries/insights'
import { formatMoney } from '@/lib/format'
import { useSettings } from '@/components/app/settings-provider'
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart'

const config = {
  revenue: { label: 'Revenue', color: 'var(--chart-1)' },
} satisfies ChartConfig

export function RevenueChart({ data }: { data: MonthlyRevenue[] }) {
  const settings = useSettings()

  const rows = data.map((d) => ({
    month: format(parseISO(d.month), 'MMM'),
    revenue: Number(d.revenue),
  }))

  return (
    // min-h is NOT optional. An unmeasured ChartContainer is the top cause
    // of a blank chart and of layout shift on first paint. Spec §7 Phase 6.
    <ChartContainer config={config} className="min-h-[300px] w-full">
      <BarChart data={rows} accessibilityLayer margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(v: number) => formatMoney(v, settings)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => formatMoney(Number(value), settings)}
            />
          }
        />
        {/* Recharts 3 with shadcn: bare var(--chart-1) — no hsl(...) wrapper. */}
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
