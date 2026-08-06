'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { endOfWeek, format, startOfWeek } from 'date-fns'
import { Search, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable } from '@/components/app/data-table/data-table'
import { ColumnHeader } from '@/components/app/data-table/column-header'
import { FilterChips, type ActiveFilter } from '@/components/app/data-table/filter-chips'
import { useTableUrlState } from '@/components/app/data-table/use-table-url-state'
import { NoDataYet, NoResults } from '@/components/app/empty-state'
import { Money } from '@/components/app/money'
import { DateDisplay } from '@/components/app/date-display'
import { OrderStatusBadge } from '@/components/app/order-status-badge'
import { setOrderStatusBulk } from '@/lib/actions/orders'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/schemas/orders'
import { BUSINESS_TIME_ZONE } from '@/lib/format'
import type { OrderListRow } from '@/lib/queries/orders'

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'week', label: 'This week' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
]
const RANGE_LABELS = Object.fromEntries(RANGE_OPTIONS.map((r) => [r.value, r.label]))

/** "Today" as the bakery experiences it, not the browser's local clock —
 * same reasoning as lib/format.ts and the interaction sheet's date chips.
 * delivery_date is a plain 'YYYY-MM-DD' date column, so a same-shaped
 * string compares correctly without any Date parsing. */
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function orderRowId(o: OrderListRow): string {
  return o.order_id ?? ''
}

const columns: ColumnDef<OrderListRow, unknown>[] = [
  {
    id: 'select',
    enableSorting: false,
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false
        }
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(Boolean(v))}
        aria-label="Select all orders on this page"
        className="size-5"
      />
    ),
    cell: ({ row }) => (
      // Stop the click from bubbling to the row's onRowClick navigation.
      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(Boolean(v))}
          aria-label={`Select order #${row.original.order_number}`}
          className="size-5"
        />
      </div>
    ),
  },
  {
    accessorKey: 'order_number',
    header: ({ column }) => <ColumnHeader column={column} title="Order #" />,
    meta: { align: 'right' },
    cell: ({ row }) => <span className="tabular-nums">#{row.original.order_number}</span>,
  },
  {
    accessorKey: 'customer_name',
    header: ({ column }) => <ColumnHeader column={column} title="Customer" />,
    cell: ({ row }) => <span className="font-medium">{row.original.customer_name}</span>,
  },
  {
    accessorKey: 'delivery_date',
    header: ({ column }) => <ColumnHeader column={column} title="Delivery" />,
    cell: ({ row }) => <DateDisplay value={row.original.delivery_date} />,
  },
  {
    accessorKey: 'total_units',
    header: ({ column }) => <ColumnHeader column={column} title="Items" />,
    meta: { align: 'right' },
    cell: ({ row }) => (
      <span>
        {row.original.total_units ?? 0} units in {row.original.line_count ?? 0} lines
      </span>
    ),
  },
  {
    accessorKey: 'subtotal',
    header: ({ column }) => <ColumnHeader column={column} title="Total" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={row.original.subtotal} />,
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <ColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <OrderStatusBadge status={(row.original.status as OrderStatus) ?? 'draft'} />,
  },
]

export function OrdersTable({ orders }: { orders: OrderListRow[] }) {
  const router = useRouter()
  const { get, setParams, clearAll } = useTableUrlState()
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [isBulkPending, startBulkTransition] = useTransition()

  const range = get('range') || 'upcoming'
  const status = get('status')
  const q = get('q')

  const filtered = useMemo(() => {
    const today = todayISO()
    let base = orders

    if (range === 'upcoming') {
      base = base.filter((o) => (o.delivery_date ?? '') >= today)
    } else if (range === 'week') {
      const start = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const end = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
      base = base.filter(
        (o) => o.delivery_date !== null && o.delivery_date >= start && o.delivery_date <= end,
      )
    } else if (range === 'past') {
      base = base.filter((o) => (o.delivery_date ?? '') < today)
    }

    return base.filter((o) => {
      if (status && o.status !== status) return false
      if (q) {
        const needle = q.toLowerCase()
        const haystack = [o.customer_name, String(o.order_number ?? '')]
          .filter((v): v is string => Boolean(v))
          .map((v) => v.toLowerCase())
        if (!haystack.some((v) => v.includes(needle))) return false
      }
      return true
    })
  }, [orders, range, status, q])

  const filteredIds = useMemo(() => new Set(filtered.map(orderRowId)), [filtered])
  const selectedIds = Object.keys(rowSelection).filter(
    (id) => rowSelection[id] && filteredIds.has(id),
  )

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const filters: ActiveFilter[] = []
    if (range !== 'upcoming') filters.push({ key: 'range', label: `Range: ${RANGE_LABELS[range] ?? range}` })
    if (status) {
      filters.push({ key: 'status', label: `Status: ${ORDER_STATUS_LABELS[status as OrderStatus] ?? status}` })
    }
    if (q) filters.push({ key: 'q', label: `"${q}"` })
    return filters
  }, [range, status, q])

  async function bulkSetStatus(nextStatus: OrderStatus) {
    const result = await setOrderStatusBulk(selectedIds, nextStatus)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`${result.count ?? selectedIds.length} order(s) updated`)
    setRowSelection({})
    router.refresh()
  }

  const emptyState =
    orders.length === 0 ? (
      <NoDataYet
        icon={<ShoppingCart className="size-10" aria-hidden />}
        title="No orders yet"
        description="Record the first order and it will roll into your weekly bake list automatically."
        action={
          <Button asChild className="h-11">
            <Link href="/orders/new">Record your first order</Link>
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
          placeholder="Search orders…"
          aria-label="Search orders"
          value={q}
          onChange={(e) => setParams({ q: e.target.value })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {RANGE_OPTIONS.map((r) => (
          <Button
            key={r.value}
            type="button"
            variant={range === r.value ? 'default' : 'outline'}
            size="sm"
            className="h-9"
            aria-pressed={range === r.value}
            onClick={() => setParams({ range: r.value === 'upcoming' ? null : r.value })}
          >
            {r.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {ORDER_STATUSES.map((s) => (
          <Button
            key={s}
            type="button"
            variant={status === s ? 'default' : 'outline'}
            size="sm"
            className="h-9"
            aria-pressed={status === s}
            onClick={() => setParams({ status: status === s ? null : s })}
          >
            {ORDER_STATUS_LABELS[s]}
          </Button>
        ))}
      </div>

      <FilterChips
        filters={activeFilters}
        onRemove={(key) => setParams({ [key]: null })}
        onClearAll={clearAll}
      />

      {selectedIds.length > 0 ? (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3 shadow-md">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={isBulkPending}
              onClick={() => startBulkTransition(() => bulkSetStatus('in_production'))}
            >
              Mark in production
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={isBulkPending}
              onClick={() => startBulkTransition(() => bulkSetStatus('delivered'))}
            >
              Mark delivered
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={filtered}
        initialSorting={[{ id: 'delivery_date', desc: false }]}
        onRowClick={(o) => router.push(`/orders/${o.order_id}`)}
        emptyState={emptyState}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        getRowId={orderRowId}
        groupBy={range === 'upcoming' ? (o) => o.delivery_date ?? '' : undefined}
        renderGroupHeader={(dateKey) => <DateDisplay value={dateKey} />}
        renderMobileCard={(o) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                #{o.order_number} · {o.customer_name}
              </span>
              <OrderStatusBadge status={(o.status as OrderStatus) ?? 'draft'} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <DateDisplay value={o.delivery_date} /> · <Money value={o.subtotal} />
            </p>
          </div>
        )}
      />
    </div>
  )
}
