'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { deletePayment } from '@/lib/actions/invoices'

/** Deleting a recorded payment is reversible — re-recording it restores the
 * balance — so it gets an undo toast rather than a confirmation modal,
 * matching this app's convention for reversible single-object mutations. */
export function DeletePaymentButton({
  paymentId,
  invoiceId,
}: {
  paymentId: string
  invoiceId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:text-destructive"
      disabled={isPending}
      aria-label="Delete payment"
      onClick={() =>
        startTransition(async () => {
          const result = await deletePayment(paymentId, invoiceId)
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          toast.success('Payment deleted')
          router.refresh()
        })
      }
    >
      <Trash2 className="size-4" aria-hidden />
    </Button>
  )
}
