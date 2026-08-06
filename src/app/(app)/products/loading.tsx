import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-11 w-36" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-11 w-64" />
        <Skeleton className="h-9 w-24" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  )
}
