'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2 } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { saveCustomerNotes } from '@/lib/actions/customers'

type SaveState = 'idle' | 'saving' | 'saved'

const DEBOUNCE_MS = 900
const SAVED_INDICATOR_MS = 2000

/**
 * The only autosaving field in the app. Free-text notes with a visible
 * saved indicator is the one permitted case for autosave — it never
 * triggers an irreversible side effect, unlike order creation or invoicing.
 */
export function NotesField({
  customerId,
  initialNotes,
}: {
  customerId: string
  initialNotes: string | null
}) {
  const [value, setValue] = useState(initialNotes ?? '')
  const [state, setState] = useState<SaveState>('idle')
  const lastSaved = useRef(initialNotes ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const clearSavedRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (value === lastSaved.current) return

    debounceRef.current = setTimeout(async () => {
      setState('saving')
      const result = await saveCustomerNotes({ id: customerId, notes: value })
      if (result.ok) {
        lastSaved.current = value
        setState('saved')
        clearSavedRef.current = setTimeout(() => setState('idle'), SAVED_INDICATOR_MS)
      } else {
        setState('idle')
        toast.error(result.error ?? 'Could not save notes. Try again.')
      }
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, customerId])

  // Belt and braces: the effect above already cancels the debounce timer
  // on every change and on unmount, but the "saved" indicator's timer is
  // started inside an async callback outside that effect's cleanup chain,
  // so it needs its own unmount guard.
  useEffect(() => {
    return () => {
      if (clearSavedRef.current) clearTimeout(clearSavedRef.current)
    }
  }, [])

  return (
    <div className="space-y-2">
      <Textarea
        rows={5}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Notes"
        placeholder="Anything worth remembering about this customer…"
      />
      <span
        aria-live="polite"
        className="flex h-5 items-center gap-1.5 text-sm text-muted-foreground"
      >
        {state === 'saving' ? (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Saving…
          </>
        ) : state === 'saved' ? (
          <>
            <Check className="size-3.5" aria-hidden />
            Saved
          </>
        ) : null}
      </span>
    </div>
  )
}
