'use client'

import { Mail, Phone, MessageCircle, Handshake, Package, MoreHorizontal, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CHANNELS, CHANNEL_LABELS, type Channel } from '@/lib/schemas/interactions'

const CHANNEL_ICONS: Record<Channel, LucideIcon> = {
  email: Mail,
  phone: Phone,
  whatsapp: MessageCircle,
  in_person: Handshake,
  sample_drop: Package,
  other: MoreHorizontal,
}

/**
 * A row of icon toggle buttons, never a dropdown — one tap instead of
 * open-scan-select. This is the first thing tapped on the most-repeated
 * action in the app, so it gets the largest touch targets in the sheet.
 */
export function ChannelPicker({
  value,
  onChange,
  invalid,
}: {
  value: Channel | ''
  onChange: (c: Channel) => void
  invalid?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label="How did you contact them?"
      aria-invalid={invalid}
      className="grid grid-cols-3 gap-2"
    >
      {CHANNELS.map((c) => {
        const Icon = CHANNEL_ICONS[c]
        const checked = value === c
        return (
          <Button
            key={c}
            type="button"
            role="radio"
            aria-checked={checked}
            variant={checked ? 'default' : 'outline'}
            className="h-16 flex-col gap-1 px-1"
            onClick={() => onChange(c)}
          >
            <Icon className="size-5" aria-hidden />
            <span className="text-xs">{CHANNEL_LABELS[c]}</span>
          </Button>
        )
      })}
    </div>
  )
}
