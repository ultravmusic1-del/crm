'use client'

import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { TextField, TextAreaField, SegmentedField } from '@/components/app/form-fields'
import { MarginReadout } from '@/components/app/margin-readout'
import { Button } from '@/components/ui/button'
import {
  productSchema,
  PRODUCT_UNITS,
  type ProductInput,
  type ProductOutput,
} from '@/lib/schemas/products'
import type { Product } from '@/lib/queries/products'
import { cn } from '@/lib/utils'

const UNIT_OPTIONS = PRODUCT_UNITS.map((u) => ({ value: u, label: u }))

function toDefaultValues(product?: Product): ProductInput {
  return {
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    description: product?.description ?? '',
    unit: (product?.unit as ProductInput['unit']) ?? 'bar',
    units_per_box: product?.units_per_box ?? 1,
    wholesale_price: product?.wholesale_price ?? 0,
    retail_price: product?.retail_price ?? 0,
    unit_cost: product?.unit_cost ?? 0,
  }
}

export function ProductForm({
  product,
  onSubmit,
  submitLabel,
}: {
  product?: Product
  onSubmit: (values: ProductOutput) => Promise<{ ok: boolean; error?: string }>
  submitLabel: string
}) {
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ProductInput, unknown, ProductOutput>({
    resolver: zodResolver(productSchema),
    mode: 'onTouched',
    defaultValues: toDefaultValues(product),
  })

  // Live, on every keystroke — that is the point. `useWatch` (not
  // `form.watch()`) deliberately: the React Compiler's lint rule flags
  // `useForm().watch` as an unmemoizable function from an incompatible
  // library (the one known warning this repo carries, for TanStack
  // Table); `useWatch` is a plain hook and does not trip it, so this
  // does not add a second one. The Zod schema coerces these fields from
  // a form string, so RHF's input type for them is `unknown`;
  // MarginReadout only ever receives what a money <input> actually
  // produces, a string or a number.
  const wholesale = useWatch({ control, name: 'wholesale_price' }) as number | string
  const retail = useWatch({ control, name: 'retail_price' }) as number | string
  const cost = useWatch({ control, name: 'unit_cost' }) as number | string

  async function handleFormSubmit(values: ProductOutput) {
    const result = await onSubmit(values)
    // Never clear the form on error — she should not have to retype.
    if (!result.ok) {
      toast.error(result.error ?? 'Something went wrong. Try again.')
    }
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6 pb-24 md:pb-0">
      <div className="space-y-4">
        <TextField control={control} name="name" label="Name" autoFocus />
        <TextField control={control} name="sku" label="SKU" className="max-w-48" />
        <TextAreaField control={control} name="description" label="Description" rows={2} />
        <SegmentedField control={control} name="unit" label="Sold by" options={UNIT_OPTIONS} />
        <TextField
          control={control}
          name="units_per_box"
          label="Units per box"
          inputMode="numeric"
          className="max-w-28"
          description="Display only. Every quantity in this app is counted in the unit above."
        />
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <TextField
          control={control}
          name="unit_cost"
          label="Cost per unit"
          inputMode="decimal"
          className="max-w-36"
        />
        <TextField
          control={control}
          name="wholesale_price"
          label="Wholesale price"
          inputMode="decimal"
          className="max-w-36"
        />
        <MarginReadout price={wholesale} cost={cost} label="Wholesale margin" />
        <TextField
          control={control}
          name="retail_price"
          label="Retail price"
          inputMode="decimal"
          className="max-w-36"
        />
        <MarginReadout price={retail} cost={cost} label="Retail margin" />
      </div>

      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-10 flex items-center justify-end gap-4 border-t bg-background/95 px-4 py-3 backdrop-blur',
          'md:static md:inset-auto md:z-auto md:border-t-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none',
        )}
      >
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
