import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 py-16">
      <h1 className="text-xl font-semibold">Order not found</h1>
      <p className="text-sm text-muted-foreground">
        That order does not exist. It may have been created on another
        device, or the link may be wrong.
      </p>
      <Button asChild className="h-11"><Link href="/orders">All orders</Link></Button>
    </div>
  )
}
