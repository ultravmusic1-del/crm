'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, Users } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/app/data-table/data-table'
import { ColumnHeader } from '@/components/app/data-table/column-header'
import { FilterChips, type ActiveFilter } from '@/components/app/data-table/filter-chips'
import { useTableUrlState } from '@/components/app/data-table/use-table-url-state'
import { NoDataYet, NoResults } from '@/components/app/empty-state'
import { StatusBadge } from '@/components/app/status-badge'
import { DateDisplay } from '@/components/app/date-display'
import { CUSTOMER_STATUSES } from '@/lib/schemas/customers'
import type { CustomerListRow } from '@/lib/queries/customers'

const columns: ColumnDef<CustomerListRow, unknown>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => <ColumnHeader column={column} title="Name" />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <ColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <StatusBadge status={row.original.status ?? 'lead'} />,
  },
  {
    accessorKey: 'type',
    header: ({ column }) => <ColumnHeader column={column} title="Type" />,
    cell: ({ row }) => (
      <span className="capitalize text-muted-foreground">{row.original.type ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'city',
    header: ({ column }) => <ColumnHeader column={column} title="City" />,
    cell: ({ row }) => row.original.city ?? '—',
  },
  {
    accessorKey: 'last_contacted_at',
    header: ({ column }) => <ColumnHeader column={column} title="Last contact" />,
    cell: ({ row }) => <DateDisplay value={row.original.last_contacted_at} />,
  },
]

export function CustomersTable({ customers }: { customers: CustomerListRow[] }) {
  const router = useRouter()
  const { get, setParams, clearAll } = useTableUrlState()

  const q = get('q')
  const status = get('status')
  const followup = get('followup')

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      if (status && c.status !== status) return false
      if (followup === 'due' && !c.open_follow_up_on) return false
      if (q) {
        const needle = q.toLowerCase()
        const haystack = [c.name, c.email, c.phone, c.city]
          .filter((v): v is string => Boolean(v))
          .map((v) => v.toLowerCase())
        if (!haystack.some((v) => v.includes(needle))) return false
      }
      return true
    })
  }, [customers, status, followup, q])

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const filters: ActiveFilter[] = []
    if (status) filters.push({ key: 'status', label: `Status: ${status}` })
    if (followup === 'due') filters.push({ key: 'followup', label: 'Follow-up due' })
    if (q) filters.push({ key: 'q', label: `"${q}"` })
    return filters
  }, [status, followup, q])

  const emptyState =
    customers.length === 0 ? (
      <NoDataYet
        icon={<Users className="size-10" aria-hidden />}
        title="No customers yet"
        description="Add the first café, gym or deli you want to sell to. A name is all you need to start."
        action={
          <Button asChild className="h-11">
            <Link href="/customers/new">Add your first customer</Link>
          </Button>
        }
      />
    ) : (
      <NoResults
        activeFilters={activeFilters.map((f) => f.label)}
        onClear={clearAll}
      />
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
          placeholder="Search customers…"
          aria-label="Search customers"
          value={q}
          onChange={(e) => setParams({ q: e.target.value })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {CUSTOMER_STATUSES.map((s) => (
          <Button
            key={s}
            type="button"
            variant={status === s ? 'default' : 'outline'}
            size="sm"
            className="h-9 capitalize"
            aria-pressed={status === s}
            onClick={() => setParams({ status: status === s ? null : s })}
          >
            {s}
          </Button>
        ))}
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
        onRowClick={(c) => router.push(`/customers/${c.id}`)}
        emptyState={emptyState}
        renderMobileCard={(c) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{c.name}</span>
              <StatusBadge status={c.status ?? 'lead'} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {c.city ?? 'No city'} · Last contact{' '}
              <DateDisplay value={c.last_contacted_at} />
            </p>
          </div>
        )}
      />
    </div>
  )
}
