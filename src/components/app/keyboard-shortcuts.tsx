'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NAV_LINKS } from '@/components/app/nav-links'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** Where "N" (new-in-context) goes, per section. */
const NEW_IN_CONTEXT: { prefix: string; href: string }[] = [
  { prefix: '/customers', href: '/customers/new' },
  { prefix: '/orders',    href: '/orders/new' },
  { prefix: '/schedules', href: '/schedules/new' },
  { prefix: '/invoices',  href: '/invoices/new' },
  { prefix: '/products',  href: '/products/new' },
]

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable ||
    el.getAttribute('role') === 'combobox'
  )
}

export function KeyboardShortcuts() {
  const router = useRouter()
  const pathname = usePathname()
  const [helpOpen, setHelpOpen] = useState(false)
  const pendingG = useRef(false)
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never hijack a key while she is typing into something.
      if (isTypingTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      // G then a key.
      if (pendingG.current) {
        pendingG.current = false
        if (gTimer.current) clearTimeout(gTimer.current)
        const link = NAV_LINKS.find((l) => l.shortcut === e.key.toLowerCase())
        if (link) { e.preventDefault(); router.push(link.href) }
        return
      }

      if (e.key.toLowerCase() === 'g') {
        pendingG.current = true
        // A chord that never times out is a trap: press G, wander off,
        // come back, press C, and you teleport.
        gTimer.current = setTimeout(() => { pendingG.current = false }, 1500)
        return
      }

      if (e.key.toLowerCase() === 'n') {
        const target = NEW_IN_CONTEXT.find((t) => pathname.startsWith(t.prefix))
        if (target) { e.preventDefault(); router.push(target.href) }
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        // Header's FIRST <button> is the mobile nav hamburger (present in
        // the DOM even when md:hidden) — target the search trigger by id
        // so this does not accidentally open the nav sheet instead.
        const search = document.getElementById('global-search-trigger')
        search?.click()
        return
      }

      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (gTimer.current) clearTimeout(gTimer.current)
    }
  }, [pathname, router])

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press ? any time to see this again.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt><kbd className="rounded border px-1.5">⌘K</kbd></dt>
          <dd>Search and commands</dd>
          <dt><kbd className="rounded border px-1.5">/</kbd></dt>
          <dd>Focus search</dd>
          <dt><kbd className="rounded border px-1.5">N</kbd></dt>
          <dd>New, in whatever section you are in</dd>
          <dt><kbd className="rounded border px-1.5">Esc</kbd></dt>
          <dd>Close a panel or dialog</dd>
          {NAV_LINKS.filter((l) => l.shortcut).map((l) => (
            <div key={l.href} className="contents">
              <dt>
                <kbd className="rounded border px-1.5">G</kbd>{' '}
                <kbd className="rounded border px-1.5">{l.shortcut!.toUpperCase()}</kbd>
              </dt>
              <dd>{l.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
