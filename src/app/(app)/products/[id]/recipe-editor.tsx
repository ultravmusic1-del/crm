'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Money } from '@/components/app/money'
import { deleteRecipeLine, upsertRecipeLine, updateProduct } from '@/lib/actions/products'
import { recipeCost } from '@/lib/pricing'
import { parseMoney } from '@/lib/format'
import type { Product, Ingredient, RecipeLine } from '@/lib/queries/products'

export function RecipeEditor({
  product,
  recipeCostFromDb,
  lines,
  ingredients,
}: {
  product: Product
  recipeCostFromDb: number
  lines: RecipeLine[]
  ingredients: Ingredient[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [newIngredientId, setNewIngredientId] = useState('')
  const [newQuantity, setNewQuantity] = useState('')

  // Live figure while she edits, mirroring v_product_costs. The SQL view
  // is authoritative — if these ever disagree, trust recipeCostFromDb.
  const computed = useMemo(() => {
    try {
      return recipeCost(
        lines.map((l) => ({
          quantity: l.quantity,
          packCost: l.ingredients?.pack_cost ?? 0,
          packSize: l.ingredients?.pack_size ?? 1,
        })),
      )
    } catch {
      return recipeCostFromDb
    }
  }, [lines, recipeCostFromDb])

  const stated = parseMoney(product.unit_cost)
  // A hundredth of a fils is rounding, not disagreement.
  const diverges = lines.length > 0 && Math.abs(computed - stated) > 0.0005

  const unused = ingredients.filter((i) => !lines.some((l) => l.ingredient_id === i.id))

  async function addLine() {
    const result = await upsertRecipeLine({
      product_id: product.id,
      ingredient_id: newIngredientId,
      quantity: newQuantity,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setNewIngredientId('')
    setNewQuantity('')
    setAdding(false)
    router.refresh()
  }

  async function removeLine(line: RecipeLine) {
    const result = await deleteRecipeLine(line.id, product.id)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    router.refresh()
  }

  async function fixUnitCost() {
    const result = await updateProduct(product.id, {
      ...product,
      // Serialising a number for a numeric(12,3) column, not display
      // formatting — this is not the banned money toFixed.
      unit_cost: computed.toFixed(3),
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Unit cost updated from the recipe')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Quantities are per <strong>one {product.unit}</strong>, not per box.
      </p>

      {lines.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">
          No recipe yet. Add ingredients to cost this product automatically.
        </p>
      ) : null}

      <ul className="space-y-2">
        {lines.map((line) => {
          const ing = line.ingredients
          const perUnit = ing ? parseMoney(ing.pack_cost) / parseMoney(ing.pack_size) : 0
          return (
            <li key={line.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{ing?.name ?? 'Unknown'}</div>
                <div className="text-sm text-muted-foreground">
                  {line.quantity} {ing?.unit} ·{' '}
                  <Money value={perUnit * parseMoney(line.quantity)} />
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                onClick={() => removeLine(line)}
              >
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only">Remove {ing?.name}</span>
              </Button>
            </li>
          )
        })}
      </ul>

      {adding ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-2">
            <Label htmlFor="new-ingredient">Ingredient</Label>
            <Select value={newIngredientId} onValueChange={setNewIngredientId}>
              <SelectTrigger id="new-ingredient" className="h-11 w-full">
                <SelectValue placeholder="Choose an ingredient" />
              </SelectTrigger>
              <SelectContent>
                {unused.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name} ({i.unit})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-quantity">Quantity per {product.unit}</Label>
            <Input
              id="new-quantity"
              inputMode="decimal"
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.target.value)}
              className="h-11 max-w-32"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={addLine}
              disabled={!newIngredientId || !newQuantity}
              className="h-11"
            >
              Add
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)} className="h-11">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => setAdding(true)}
          disabled={unused.length === 0}
          className="h-11 w-full"
        >
          <Plus className="size-4" aria-hidden />
          {unused.length === 0 ? 'Every ingredient is already in this recipe' : 'Add ingredient'}
        </Button>
      )}

      {lines.length > 0 ? (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Recipe cost per {product.unit}</span>
            <Money value={computed} className="font-semibold" />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Unit cost set on the product</span>
            <Money value={stated} />
          </div>

          {diverges ? (
            <div className="space-y-2 rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
              <p>
                Recipe cost is <Money value={computed} /> but unit cost is set to{' '}
                <Money value={stated} />.
              </p>
              <Button type="button" size="sm" className="h-11" onClick={fixUnitCost}>
                Update unit cost to <Money value={computed} />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
