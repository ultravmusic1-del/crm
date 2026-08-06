import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { listProducts } from '@/lib/queries/products'
import { ProductsTable } from './products-table'

export default async function ProductsPage() {
  const products = await listProducts()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Products</h1>
        <Button asChild className="h-11">
          <Link href="/products/new">
            <Plus aria-hidden />
            New product
          </Link>
        </Button>
      </div>
      <ProductsTable products={products} />
    </div>
  )
}
