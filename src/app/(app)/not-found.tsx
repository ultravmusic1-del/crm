import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 py-16">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        That record does not exist, or it was archived.
      </p>
      <Button asChild className="h-11"><Link href="/">Back to dashboard</Link></Button>
    </div>
  )
}
