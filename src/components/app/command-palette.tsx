'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { NAV_LINKS } from '@/components/app/nav-links'
import { NAV_ALIASES, matchesAlias } from '@/lib/aliases'
import { search, type SearchHit } from '@/lib/actions/search'
import { Button } from '@/components/ui/button'
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from '@/components/ui/command'

const CREATE_ACTIONS = [
  { label: 'New customer',    href: '/customers/new', shortcut: 'N C' },
  { label: 'New order',       href: '/orders/new',    shortcut: 'N O' },
  { label: 'New invoice',     href: '/invoices/new',  shortcut: 'N I' },
  { label: 'New schedule',    href: '/schedules/new', shortcut: 'N S' },
  { label: "Today's follow-ups", href: '/customers?followup=due', shortcut: '' },
]

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [, startTransition] = useTransition()

  // Cmd/Ctrl+K opens AND closes, restoring focus. Spec §6.5.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    // Below the minimum length, `visibleHits` below already hides
    // whatever is in `hits` — returning early here (rather than calling
    // setHits synchronously) avoids a setState-in-effect lint error.
    if (query.trim().length < 2) return
    const t = setTimeout(() => {
      startTransition(async () => setHits(await search(query)))
    }, 150)
    return () => clearTimeout(t)
  }, [query])

  const visibleHits = query.trim().length < 2 ? [] : hits

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      setQuery('')
      router.push(href)
    },
    [router],
  )

  const navMatches = NAV_LINKS.filter((l) =>
    matchesAlias(query, l.label, NAV_ALIASES[l.label]),
  )
  const createMatches = CREATE_ACTIONS.filter((a) => matchesAlias(query, a.label))

  return (
    <>
      {/* The palette is an ACCELERATOR. This visible trigger means a
          novice never has to know the shortcut exists. Spec §6.5. */}
      <Button
        id="global-search-trigger"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-11 w-full justify-start gap-2 text-muted-foreground sm:max-w-xs"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border px-1.5 text-xs sm:inline">⌘K</kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search and commands"
        description="Search customers, orders and products, or jump to a page."
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search, or type a page name…"
        />
        <CommandList>
          <CommandEmpty>Nothing found. Try a customer name or an order number.</CommandEmpty>

          {visibleHits.length > 0 ? (
            <>
              <CommandGroup heading="Results">
                {visibleHits.map((hit) => (
                  <CommandItem
                    key={`${hit.kind}-${hit.id}`}
                    value={`${hit.title} ${hit.subtitle}`}
                    onSelect={() => go(hit.href)}
                  >
                    <span className="font-medium">{hit.title}</span>
                    <span className="ml-2 truncate text-muted-foreground">{hit.subtitle}</span>
                    <CommandShortcut className="capitalize">{hit.kind}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          {createMatches.length > 0 ? (
            <CommandGroup heading="Create">
              {createMatches.map((a) => (
                <CommandItem key={a.href} value={a.label} onSelect={() => go(a.href)}>
                  {a.label}
                  {a.shortcut ? <CommandShortcut>{a.shortcut}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {navMatches.length > 0 ? (
            <CommandGroup heading="Go to">
              {navMatches.map((l) => (
                <CommandItem
                  key={l.href}
                  // Include the aliases in cmdk's own value so its internal
                  // filter agrees with ours.
                  value={`${l.label} ${(NAV_ALIASES[l.label] ?? []).join(' ')}`}
                  onSelect={() => go(l.href)}
                >
                  <l.icon className="size-4" aria-hidden />
                  {l.label}
                  {/* Displaying the shortcut is what TEACHES it. Spec §6.5. */}
                  {l.shortcut ? <CommandShortcut>G {l.shortcut.toUpperCase()}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  )
}
