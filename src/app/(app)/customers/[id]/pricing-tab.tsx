'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Money } from '@/components/app/money'
import { NoDataYet } from '@/components/app/empty-state'
import { clearCustomerPrice, setCustomerPrice } from '@/lib/actions/products'
import { cn } from '@/lib/utils'
import type { EffectivePrice } from '@/lib/queries/pricing'

const SOURCE_LABEL: Record<string, string> = {
  custom: 'Custom',
  wholesale: 'Wholesale',
  retail: 'Retail',
}

export function PricingTab({
  customerId,
  priceTier,
  prices,
}: {
  customerId: string
  priceTier: string
  prices: EffectivePrice[]
}) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  async function save(productId: string) {
    const result = await setCustomerPrice({
      customer_id: customerId,
      product_id: productId,
      unit_price: draft,
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setEditingId(null)
    toast.success('Custom price set')
    router.refresh()
  }

  async function clear(productId: string) {
    const result = await clearCustomerPrice(customerId, productId)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Reverted to the tier price')
    router.refresh()
  }

  if (prices.length === 0) {
    return (
      <NoDataYet
        title="No products yet"
        description="Add products first and their prices for this customer will appear here."
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        This customer is on <strong>{priceTier}</strong> pricing. Set a price here to override it
        for one product; clear it to go back.
      </p>

      <ul className="space-y-2">
        {prices.map((p) => {
          const productId = p.product_id!
          const isEditing = editingId === productId
          const source = p.price_source ?? 'wholesale'

          return (
            <li
              key={productId}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-lg border p-3',
                // The row must LOOK different in edit mode, so an
                // accidental edit is obvious.
                isEditing && 'border-2 border-primary bg-accent/30',
              )}
            >
              <span className="min-w-0 flex-1 font-medium">{p.product_name}</span>

              {isEditing ? (
                <>
                  <Input
                    autoFocus
                    inputMode="decimal"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void save(productId)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="h-11 w-28"
                  />
                  <Button className="h-11" onClick={() => save(productId)}>
                    Save
                  </Button>
                  <Button variant="ghost" className="h-11" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Badge variant={source === 'custom' ? 'default' : 'secondary'}>
                    {SOURCE_LABEL[source] ?? source}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(productId)
                      setDraft(String(p.effective_price ?? ''))
                    }}
                    className="min-h-11 rounded px-2 tabular-nums hover:bg-accent"
                  >
                    <Money value={p.effective_price} />
                  </button>
                  {source === 'custom' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      onClick={() => clear(productId)}
                    >
                      <X className="size-4" aria-hidden />
                      <span className="sr-only">Clear custom price for {p.product_name}</span>
                    </Button>
                  ) : null}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
