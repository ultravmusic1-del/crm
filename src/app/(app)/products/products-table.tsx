'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, Package } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/app/data-table/data-table'
import { ColumnHeader } from '@/components/app/data-table/column-header'
import { FilterChips, type ActiveFilter } from '@/components/app/data-table/filter-chips'
import { useTableUrlState } from '@/components/app/data-table/use-table-url-state'
import { NoDataYet, NoResults } from '@/components/app/empty-state'
import { Money } from '@/components/app/money'
import { marginPercent } from '@/lib/pricing'
import { cn } from '@/lib/utils'
import type { ProductWithCost } from '@/lib/queries/products'

function marginTone(pct: number): string {
  if (pct < 0) return 'text-destructive'
  if (pct < 20) return 'text-amber-600 dark:text-amber-500'
  return 'text-emerald-600 dark:text-emerald-500'
}

function MarginCell({ price, cost }: { price: number | string; cost: number | string }) {
  const pct = marginPercent(price, cost)
  if (pct === null) return <span className="text-muted-foreground">—</span>
  // pct is a PERCENTAGE, not money — this is not the banned money toFixed.
  return <span className={cn('tabular-nums', marginTone(pct))}>{pct.toFixed(1)}%</span>
}

const columns: ColumnDef<ProductWithCost, unknown>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <ColumnHeader column={column} title="Name" />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: 'unit',
    header: ({ column }) => <ColumnHeader column={column} title="Unit" />,
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.unit}</span>,
  },
  {
    accessorKey: 'unit_cost',
    header: ({ column }) => <ColumnHeader column={column} title="Cost" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={row.original.unit_cost} />,
  },
  {
    accessorKey: 'wholesale_price',
    header: ({ column }) => <ColumnHeader column={column} title="Wholesale" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={row.original.wholesale_price} />,
  },
  {
    accessorKey: 'retail_price',
    header: ({ column }) => <ColumnHeader column={column} title="Retail" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={row.original.retail_price} />,
  },
  {
    id: 'margin',
    header: ({ column }) => <ColumnHeader column={column} title="Margin" />,
    meta: { align: 'right' },
    cell: ({ row }) => (
      <MarginCell price={row.original.wholesale_price} cost={row.original.unit_cost} />
    ),
  },
  {
    id: 'recipe',
    header: ({ column }) => <ColumnHeader column={column} title="Recipe" />,
    cell: ({ row }) =>
      row.original.ingredient_count > 0 ? (
        <span>{row.original.ingredient_count} ingredients</span>
      ) : (
        <span className="text-muted-foreground">Not costed</span>
      ),
  },
]

export function ProductsTable({ products }: { products: ProductWithCost[] }) {
  const router = useRouter()
  const { get, setParams, clearAll } = useTableUrlState()

  const q = get('q')

  const filtered = useMemo(() => {
    if (!q) return products
    const needle = q.toLowerCase()
    return products.filter((p) => {
      const haystack = [p.name, p.sku].filter((v): v is string => Boolean(v)).map((v) =>
        v.toLowerCase(),
      )
      return haystack.some((v) => v.includes(needle))
    })
  }, [products, q])

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const filters: ActiveFilter[] = []
    if (q) filters.push({ key: 'q', label: `"${q}"` })
    return filters
  }, [q])

  const emptyState =
    products.length === 0 ? (
      <NoDataYet
        icon={<Package className="size-10" aria-hidden />}
        title="No products yet"
        description="Add the bars you sell. You can add the recipe and cost later."
        action={
          <Button asChild className="h-11">
            <Link href="/products/new">Add your first product</Link>
          </Button>
        }
      />
    ) : (
      <NoResults activeFilters={activeFilters.map((f) => f.label)} onClear={clearAll} />
    )

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="h-11 pl-9"
          placeholder="Search products…"
          aria-label="Search products"
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
        onRowClick={(p) => router.push(`/products/${p.id}`)}
        emptyState={emptyState}
        renderMobileCard={(p) => (
          <div>
            <div className="font-medium">{p.name}</div>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Money value={p.wholesale_price} />
              <span>·</span>
              <MarginCell price={p.wholesale_price} cost={p.unit_cost} />
            </div>
          </div>
        )}
      />
    </div>
  )
}
