'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'

/**
 * List state lives in the URL: copying the address bar reproduces the view,
 * the back button works, a filtered list is shareable.
 * router.replace, not push — filtering should not fill the history stack.
 */
export function useTableUrlState() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString())

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') next.delete(key)
        else next.set(key, value)
      }

      // Changing any filter must reset paging, or you land on an empty page 7.
      if (!Object.hasOwn(updates, 'page')) next.delete('page')

      const qs = next.toString()
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router],
  )

  const clearAll = useCallback(() => {
    startTransition(() => router.replace(pathname, { scroll: false }))
  }, [pathname, router])

  return {
    params,
    setParams,
    clearAll,
    isPending,
    get: (key: string) => params.get(key) ?? '',
  }
}
