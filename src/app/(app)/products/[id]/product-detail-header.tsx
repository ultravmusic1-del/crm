'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RecordSheet } from '@/components/app/record-sheet'
import { ProductForm } from '@/components/app/product-form'
import { MarginReadout } from '@/components/app/margin-readout'
import { archiveProduct, unarchiveProduct, updateProduct } from '@/lib/actions/products'
import type { Product } from '@/lib/queries/products'
import type { ProductOutput } from '@/lib/schemas/products'

export function ProductDetailHeader({ product }: { product: Product }) {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)

  async function handleEditSubmit(values: ProductOutput) {
    const result = await updateProduct(product.id, values)
    if (result.ok) {
      toast.success('Product saved')
      setEditOpen(false)
      router.refresh()
    }
    return result
  }

  // Archiving is reversible, so it gets an Undo toast rather than a
  // confirmation modal.
  async function handleArchive() {
    const result = await archiveProduct(product.id)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`${product.name} archived`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          await unarchiveProduct(product.id)
          router.refresh()
        },
      },
    })
    router.push('/products')
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold">{product.name}</h1>
        <MarginReadout
          price={product.wholesale_price}
          cost={product.unit_cost}
          label="Wholesale margin"
          className="mt-1"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => setEditOpen(true)}
        >
          <Pencil aria-hidden />
          <span className="sr-only">Edit product</span>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={handleArchive}
        >
          <Archive aria-hidden />
          <span className="sr-only">Archive product</span>
        </Button>
      </div>

      <RecordSheet open={editOpen} onOpenChange={setEditOpen} title={`Edit ${product.name}`}>
        <ProductForm product={product} submitLabel="Save changes" onSubmit={handleEditSubmit} />
      </RecordSheet>
    </div>
  )
}
