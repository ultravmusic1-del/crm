'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, FileText } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DataTable } from '@/components/app/data-table/data-table'
import { ColumnHeader } from '@/components/app/data-table/column-header'
import { FilterChips, type ActiveFilter } from '@/components/app/data-table/filter-chips'
import { useTableUrlState } from '@/components/app/data-table/use-table-url-state'
import { NoDataYet, NoResults } from '@/components/app/empty-state'
import { Money } from '@/components/app/money'
import { DateDisplay } from '@/components/app/date-display'
import { InvoiceStatusBadge } from '@/components/app/invoice-status-badge'
import { parseMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { InvoiceListRow } from '@/lib/queries/invoices'

const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: '', label: 'Unpaid' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
  { value: 'all', label: 'All' },
]
const STATUS_LABELS = Object.fromEntries(STATUS_CHIPS.map((s) => [s.value, s.label]))

function invoiceRowId(row: InvoiceListRow): string {
  return row.invoice_id ?? ''
}

const columns: ColumnDef<InvoiceListRow, unknown>[] = [
  {
    accessorKey: 'invoice_number',
    header: ({ column }) => <ColumnHeader column={column} title="Invoice #" />,
    cell: ({ row }) => (
      <span className="tabular-nums font-medium">{row.original.invoice_number}</span>
    ),
  },
  {
    accessorKey: 'customer_name',
    header: ({ column }) => <ColumnHeader column={column} title="Customer" />,
  },
  {
    accessorKey: 'issued_on',
    header: ({ column }) => <ColumnHeader column={column} title="Issued" />,
    cell: ({ row }) => <DateDisplay value={row.original.issued_on} />,
  },
  {
    accessorKey: 'due_on',
    header: ({ column }) => <ColumnHeader column={column} title="Due" />,
    cell: ({ row }) => {
      const overdue = row.original.computed_status === 'overdue'
      const display = <DateDisplay value={row.original.due_on} />
      return overdue ? <span className="font-medium text-destructive">{display}</span> : display
    },
  },
  {
    accessorKey: 'total',
    header: ({ column }) => <ColumnHeader column={column} title="Total" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={row.original.total} />,
  },
  {
    accessorKey: 'amount_paid',
    header: ({ column }) => <ColumnHeader column={column} title="Paid" />,
    meta: { align: 'right' },
    cell: ({ row }) => <Money value={row.original.amount_paid} />,
  },
  {
    accessorKey: 'balance',
    header: ({ column }) => <ColumnHeader column={column} title="Balance" />,
    meta: { align: 'right' },
    cell: ({ row }) => {
      const balance = parseMoney(row.original.balance)
      return (
        <span className={cn(balance !== 0 && 'font-semibold')}>
          <Money value={row.original.balance} />
        </span>
      )
    },
  },
  {
    accessorKey: 'computed_status',
    header: ({ column }) => <ColumnHeader column={column} title="Status" />,
    cell: ({ row }) => <InvoiceStatusBadge status={row.original.computed_status ?? 'draft'} />,
  },
]

export function InvoicesTable({ invoices }: { invoices: InvoiceListRow[] }) {
  const router = useRouter()
  const { get, setParams, clearAll } = useTableUrlState()

  const status = get('status')
  const q = get('q')

  const filtered = useMemo(() => {
    let base = invoices

    if (!status) {
      base = base.filter(
        (i) => i.computed_status !== 'paid' && i.computed_status !== 'void',
      )
    } else if (status !== 'all') {
      base = base.filter((i) => i.computed_status === status)
    }

    if (q) {
      const needle = q.toLowerCase()
      base = base.filter((i) => {
        const haystack = [i.customer_name, i.invoice_number]
          .filter((v): v is string => Boolean(v))
          .map((v) => v.toLowerCase())
        return haystack.some((v) => v.includes(needle))
      })
    }

    return base
  }, [invoices, status, q])

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const filters: ActiveFilter[] = []
    if (status) filters.push({ key: 'status', label: `Status: ${STATUS_LABELS[status] ?? status}` })
    if (q) filters.push({ key: 'q', label: `"${q}"` })
    return filters
  }, [status, q])

  const summary = useMemo(() => {
    const outstanding = invoices.filter(
      (i) => i.computed_status !== 'paid' && i.computed_status !== 'void',
    )
    const overdue = invoices.filter((i) => i.computed_status === 'overdue')
    const sumBalance = (rows: InvoiceListRow[]) =>
      rows.reduce((sum, r) => sum + parseMoney(r.balance), 0)
    return {
      outstandingValue: sumBalance(outstanding),
      outstandingCount: outstanding.length,
      overdueValue: sumBalance(overdue),
      overdueCount: overdue.length,
    }
  }, [invoices])

  const emptyState =
    invoices.length === 0 ? (
      <NoDataYet
        icon={<FileText className="size-10" aria-hidden />}
        title="No invoices yet"
        description="Once you've delivered some orders you can bill them here — several orders can go on one invoice."
        action={
          <Button asChild className="h-11">
            <Link href="/invoices/new">Create the first invoice</Link>
          </Button>
        }
      />
    ) : (
      <NoResults activeFilters={activeFilters.map((f) => f.label)} onClear={clearAll} />
    )

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-baseline justify-between gap-2 py-4">
            <div>
              <p className="text-sm text-muted-foreground">Outstanding</p>
              <p className="text-2xl font-semibold tabular-nums">
                <Money value={summary.outstandingValue} />
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {summary.outstandingCount} invoice{summary.outstandingCount === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-baseline justify-between gap-2 py-4">
            <div>
              <p className="text-sm text-muted-foreground">Overdue</p>
              <p
                className={cn(
                  'text-2xl font-semibold tabular-nums',
                  summary.overdueValue > 0 && 'text-destructive',
                )}
              >
                <Money value={summary.overdueValue} />
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {summary.overdueCount} invoice{summary.overdueCount === 1 ? '' : 's'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          className="h-11 pl-9"
          placeholder="Search invoices…"
          aria-label="Search invoices"
          value={q}
          onChange={(e) => setParams({ q: e.target.value })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_CHIPS.map((s) => (
          <Button
            key={s.value || 'unpaid'}
            type="button"
            variant={status === s.value ? 'default' : 'outline'}
            size="sm"
            className="h-9"
            aria-pressed={status === s.value}
            onClick={() => setParams({ status: s.value || null })}
          >
            {s.label}
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
        initialSorting={[{ id: 'due_on', desc: false }]}
        onRowClick={(row) => router.push(`/invoices/${row.invoice_id}`)}
        emptyState={emptyState}
        getRowId={invoiceRowId}
        renderMobileCard={(row) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {row.invoice_number} · {row.customer_name}
              </span>
              <InvoiceStatusBadge status={row.computed_status ?? 'draft'} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Due <DateDisplay value={row.due_on} /> · <Money value={row.balance} />
            </p>
          </div>
        )}
      />
    </div>
  )
}
