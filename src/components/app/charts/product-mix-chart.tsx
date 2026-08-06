'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import type { ProductPerformance } from '@/lib/queries/insights'
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart'

const config = {
  units: { label: 'Units', color: 'var(--chart-2)' },
} satisfies ChartConfig

export function ProductMixChart({ data }: { data: ProductPerformance[] }) {
  const rows = data.map((d) => ({
    name: d.product_name,
    units: Number(d.units_sold),
  }))

  return (
    // min-h is NOT optional — see revenue-chart.tsx.
    <ChartContainer config={config} className="min-h-[300px] w-full">
      <BarChart
        data={rows}
        layout="vertical"
        accessibilityLayer
        margin={{ left: 4, right: 4 }}
      >
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          dataKey="name"
          type="category"
          width={110}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => `${Math.round(Number(value))} units`}
            />
          }
        />
        {/* Recharts 3 with shadcn: bare var(--chart-2) — no hsl(...) wrapper. */}
        <Bar dataKey="units" fill="var(--color-units)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
