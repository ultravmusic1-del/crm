'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Search, Carrot, Plus, Trash2 } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/app/data-table/data-table'
import { ColumnHeader } from '@/components/app/data-table/column-header'
import { FilterChips, type ActiveFilter } from '@/components/app/data-table/filter-chips'
import { useTableUrlState } from '@/components/app/data-table/use-table-url-state'
import { NoDataYet, NoResults } from '@/components/app/empty-state'
import { RecordSheet } from '@/components/app/record-sheet'
import { TextField } from '@/components/app/form-fields'
import { Money } from '@/components/app/money'
import { parseMoney } from '@/lib/format'
import { deleteIngredient, upsertIngredient } from '@/lib/actions/products'
import {
  ingredientSchema,
  INGREDIENT_UNITS,
  type IngredientInput,
  type IngredientOutput,
} from '@/lib/schemas/products'
import type { Ingredient } from '@/lib/queries/products'

function unitCost(ingredient: Ingredient): number {
  return parseMoney(ingredient.pack_cost) / parseMoney(ingredient.pack_size)
}

function IngredientFormSheet({
  ingredient,
  open,
  onOpenChange,
}: {
  ingredient: Ingredient | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<IngredientInput, unknown, IngredientOutput>({
    resolver: zodResolver(ingredientSchema),
    mode: 'onTouched',
    values: {
      name: ingredient?.name ?? '',
      unit: ingredient?.unit ?? '',
      pack_size: ingredient?.pack_size ?? 1,
      pack_cost: ingredient?.pack_cost ?? 0,
    },
  })

  async function handleFormSubmit(values: IngredientOutput) {
    const result = await upsertIngredient(ingredient?.id ?? null, values)
    if (!result.ok) {
      toast.error(result.error ?? 'Something went wrong. Try again.')
      return
    }
    toast.success(ingredient ? 'Ingredient saved' : 'Ingredient added')
    onOpenChange(false)
    router.refresh()
  }

  return (
    <RecordSheet
      open={open}
      onOpenChange={onOpenChange}
      title={ingredient ? `Edit ${ingredient.name}` : 'New ingredient'}
    >
      <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4 pb-24 md:pb-0">
        <TextField control={control} name="name" label="Name" autoFocus />
        <div>
          <TextField control={control} name="unit" label="Unit" list="ingredient-units" />
          <datalist id="ingredient-units">
            {INGREDIENT_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <TextField
          control={control}
          name="pack_size"
          label="Pack size"
          inputMode="decimal"
          className="max-w-36"
        />
        <TextField
          control={control}
          name="pack_cost"
          label="Pack cost"
          inputMode="decimal"
          className="max-w-36"
        />
        <div className="flex justify-end">
          <Button type="submit" className="h-11" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : ingredient ? 'Save changes' : 'Add ingredient'}
          </Button>
        </div>
      </form>
    </RecordSheet>
  )
}

export function IngredientsTable({ ingredients }: { ingredients: Ingredient[] }) {
  const router = useRouter()
  const { get, setParams, clearAll } = useTableUrlState()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Ingredient | null>(null)

  const q = get('q')

  const filtered = useMemo(() => {
    if (!q) return ingredients
    const needle = q.toLowerCase()
    return ingredients.filter((i) => i.name.toLowerCase().includes(needle))
  }, [ingredients, q])

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const filters: ActiveFilter[] = []
    if (q) filters.push({ key: 'q', label: `"${q}"` })
    return filters
  }, [q])

  function openEdit(ingredient: Ingredient) {
    setEditing(ingredient)
    setSheetOpen(true)
  }

  function openNew() {
    setEditing(null)
    setSheetOpen(true)
  }

  async function handleDelete(ingredient: Ingredient) {
    const result = await deleteIngredient(ingredient.id)
    if (!result.ok) {
      // The action already converts 23503 into a specific, actionable
      // message — show it verbatim rather than a generic one.
      toast.error(result.error)
      return
    }
    toast.success(`${ingredient.name} deleted`)
    router.refresh()
  }

  const columns: ColumnDef<Ingredient, unknown>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => <ColumnHeader column={column} title="Ingredient" />,
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: 'unit',
      header: ({ column }) => <ColumnHeader column={column} title="Unit" />,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.unit}</span>,
    },
    {
      accessorKey: 'pack_size',
      header: ({ column }) => <ColumnHeader column={column} title="Pack size" />,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span>
          {row.original.pack_size} {row.original.unit}
        </span>
      ),
    },
    {
      accessorKey: 'pack_cost',
      header: ({ column }) => <ColumnHeader column={column} title="Pack cost" />,
      meta: { align: 'right' },
      cell: ({ row }) => <Money value={row.original.pack_cost} />,
    },
    {
      id: 'unit_cost',
      header: ({ column }) => <ColumnHeader column={column} title="Cost per unit" />,
      meta: { align: 'right' },
      cell: ({ row }) => <Money value={unitCost(row.original)} />,
    },
    {
      id: 'actions',
      header: () => null,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={(e) => {
            e.stopPropagation()
            handleDelete(row.original)
          }}
        >
          <Trash2 className="size-4" aria-hidden />
          <span className="sr-only">Delete {row.original.name}</span>
        </Button>
      ),
    },
  ]

  const emptyState =
    ingredients.length === 0 ? (
      <NoDataYet
        icon={<Carrot className="size-10" aria-hidden />}
        title="No ingredients yet"
        description="Add oats, dates, almonds — whatever goes into a bar. Pack size and pack cost turn a recipe into a shopping list."
        action={
          <Button className="h-11" onClick={openNew}>
            Add your first ingredient
          </Button>
        }
      />
    ) : (
      <NoResults activeFilters={activeFilters.map((f) => f.label)} onClear={clearAll} />
    )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Ingredients</h1>
        <Button className="h-11" onClick={openNew}>
          <Plus aria-hidden />
          New ingredient
        </Button>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="h-11 pl-9"
          placeholder="Search ingredients…"
          aria-label="Search ingredients"
          value={q}
          onChange={(e) => setParams({ q: e.target.value })}
        />
      </div>

      <FilterChips
        filters={activeFilters}
        onRemove={(key) => setParams({ [key]: null })}
        onClearAll={clearAll}
      />

      <DataTable
        columns={columns}
        data={filtered}
        initialSorting={[{ id: 'name', desc: false }]}
        onRowClick={openEdit}
        emptyState={emptyState}
        renderMobileCard={(i) => (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">{i.name}</div>
              <div className="text-sm text-muted-foreground">
                {i.pack_size} {i.unit} · <Money value={i.pack_cost} /> ·{' '}
                <Money value={unitCost(i)} /> per {i.unit}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                handleDelete(i)
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Delete {i.name}</span>
            </Button>
          </div>
        )}
      />

      <IngredientFormSheet ingredient={editing} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  )
}
