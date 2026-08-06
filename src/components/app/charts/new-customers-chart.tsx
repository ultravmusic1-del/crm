'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { format, parseISO } from 'date-fns'
import type { MonthlyCustomers } from '@/lib/queries/insights'
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart'

const config = {
  customers: { label: 'New customers', color: 'var(--chart-3)' },
} satisfies ChartConfig

export function NewCustomersChart({ data }: { data: MonthlyCustomers[] }) {
  const rows = data.map((d) => ({
    month: format(parseISO(d.month), 'MMM'),
    customers: d.new_customers,
  }))

  return (
    // min-h is NOT optional — see revenue-chart.tsx.
    <ChartContainer config={config} className="min-h-[300px] w-full">
      <BarChart data={rows} accessibilityLayer margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {/* Recharts 3 with shadcn: bare var(--chart-3) — no hsl(...) wrapper. */}
        <Bar dataKey="customers" fill="var(--color-customers)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
