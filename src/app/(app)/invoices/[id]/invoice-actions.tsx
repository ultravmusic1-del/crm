'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Printer, Send, Ban, Plus } from 'lucide-react'
import { markInvoiceSent, voidInvoice } from '@/lib/actions/invoices'
import { PaymentForm } from '@/components/app/payment-form'
import { RecordSheet } from '@/components/app/record-sheet'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  computedStatus,
  balance,
}: {
  invoiceId: string
  invoiceNumber: string
  computedStatus: string
  balance: number
}) {
  const router = useRouter()
  const [paying, setPaying] = useState(false)

  const isVoid = computedStatus === 'void'

  return (
    <div className="flex flex-wrap gap-2">
      {!isVoid && computedStatus === 'draft' ? (
        <Button
          className="h-11"
          onClick={async () => {
            const result = await markInvoiceSent(invoiceId)
            if (!result.ok) { toast.error(result.error); return }
            toast.success('Marked as sent')
            router.refresh()
          }}
        >
          <Send className="size-4" aria-hidden /> Mark sent
        </Button>
      ) : null}

      {!isVoid && balance > 0 ? (
        <Button variant="outline" className="h-11" onClick={() => setPaying(true)}>
          <Plus className="size-4" aria-hidden /> Record payment
        </Button>
      ) : null}

      <Button asChild variant="outline" className="h-11">
        <Link href={`/invoices/${invoiceId}/print`} target="_blank">
          <Printer className="size-4" aria-hidden /> Print
        </Link>
      </Button>

      {!isVoid ? (
        // Voiding is IRREVERSIBLE, so it gets a real modal confirmation.
        // Everywhere else in this app, reversible actions get an Undo
        // toast instead.
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="h-11 text-destructive">
              <Ban className="size-4" aria-hidden /> Void
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Void invoice {invoiceNumber}?</AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone. The invoice keeps its number and total
                for the record, and the orders it covers are released so you
                can invoice them again. Any payments recorded against it stay
                attached to the voided invoice.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11">Keep it</AlertDialogCancel>
              <AlertDialogAction
                className="h-11"
                onClick={async () => {
                  const result = await voidInvoice(invoiceId)
                  if (!result.ok) { toast.error(result.error); return }
                  toast.success(`${invoiceNumber} voided`)
                  router.refresh()
                }}
              >
                Void it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      <RecordSheet open={paying} onOpenChange={setPaying} title="Record a payment">
        <PaymentForm
          invoiceId={invoiceId}
          defaultAmount={balance}
          onDone={() => { setPaying(false); router.refresh() }}
        />
      </RecordSheet>
    </div>
  )
}
