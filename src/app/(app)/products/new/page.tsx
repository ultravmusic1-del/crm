'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ProductForm } from '@/components/app/product-form'
import { createProduct } from '@/lib/actions/products'
import type { ProductOutput } from '@/lib/schemas/products'

export default function NewProductPage() {
  const router = useRouter()

  async function onSubmit(values: ProductOutput) {
    const result = await createProduct(values)
    if (result.ok) {
      toast.success(`${values.name} added`)
      router.push(`/products/${result.id}`)
    }
    return result
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New product</h1>
      <ProductForm submitLabel="Create product" onSubmit={onSubmit} />
    </div>
  )
}
