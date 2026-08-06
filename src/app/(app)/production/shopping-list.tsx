import type { ShoppingListRow } from '@/lib/queries/production'
import { Money } from '@/components/app/money'
import { NoDataYet } from '@/components/app/empty-state'
import { parseMoney } from '@/lib/format'

export function ShoppingList({ rows }: { rows: ShoppingListRow[] }) {
  if (rows.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-lg font-semibold">Shopping list</h2>
        <NoDataYet
          title="Nothing to buy"
          description="Add recipes to your products and this list builds itself from the bake list."
        />
      </section>
    )
  }

  // parseMoney is the only sanctioned way to turn a numeric(12,3) string
  // into a number outside lib/format.ts itself.
  const total = rows.reduce((s, r) => s + parseMoney(r.estimated_cost), 0)

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Shopping list</h2>
      <div className="overflow-hidden rounded-lg border print:border-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 print:bg-transparent">
            <tr>
              <th className="p-2 text-left font-medium">Ingredient</th>
              <th className="p-2 text-right font-medium">Needed</th>
              <th className="p-2 text-right font-medium">Packs</th>
              <th className="p-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.ingredient_id}>
                <td className="p-2">{r.ingredient_name}</td>
                <td className="p-2 text-right tabular-nums">
                  {Number(r.total_needed)} {r.unit}
                </td>
                {/* The number she acts on. Largest thing in the row. */}
                <td className="p-2 text-right text-base font-bold tabular-nums">
                  {r.packs_to_buy}
                </td>
                <td className="p-2 text-right"><Money value={r.estimated_cost} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2">
            <tr>
              <td className="p-2 font-semibold" colSpan={3}>Estimated total</td>
              <td className="p-2 text-right font-semibold"><Money value={total} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
