import { resolveWeek } from '@/lib/week'
import { getBakeList, getDeliverySchedule, getShoppingList } from '@/lib/queries/production'
import { formatDateRange } from '@/lib/format'
import { WeekPicker } from './week-picker'
import { BakeList } from './bake-list'
import { ShoppingList } from './shopping-list'
import { DeliverySchedule } from './delivery-schedule'

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  // Next 16: searchParams is a Promise.
  const { week } = await searchParams
  const { from, to } = resolveWeek(week)

  const [bake, shopping, deliveries] = await Promise.all([
    getBakeList(from, to),
    getShoppingList(from, to),
    getDeliverySchedule(from, to),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-semibold">Production</h1>
        <WeekPicker from={from} />
      </div>

      {/* Only visible on paper: the printed sheet must say which week it is,
          or a sheet left on the counter is worse than no sheet. */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Bake list — {formatDateRange(from, to)}</h1>
      </div>

      <BakeList rows={bake} />
      <ShoppingList rows={shopping} />
      <DeliverySchedule rows={deliveries} />
    </div>
  )
}
