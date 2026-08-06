'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function ProductionError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 py-16">
      <h1 className="text-xl font-semibold">The bake list could not be built.</h1>
      <p className="text-sm text-muted-foreground">
        Trying again usually works. If it keeps happening, send this
        reference:{' '}
        <code className="rounded bg-muted px-1">{error.digest ?? 'none'}</code>
      </p>
      <Button onClick={reset} className="h-11">Try again</Button>
    </div>
  )
}
