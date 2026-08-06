import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getProduct, getProductCost, listRecipe, listIngredients } from '@/lib/queries/products'
import { ProductDetailHeader } from './product-detail-header'
import { RecipeEditor } from './recipe-editor'

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const product = await getProduct(id)
  if (!product) notFound()

  const [cost, recipe, ingredients] = await Promise.all([
    getProductCost(id),
    listRecipe(id),
    listIngredients(),
  ])

  return (
    <div className="space-y-6">
      <ProductDetailHeader product={product} />

      <Card>
        <CardHeader>
          <CardTitle>Recipe</CardTitle>
        </CardHeader>
        <CardContent>
          <RecipeEditor
            product={product}
            recipeCostFromDb={cost?.recipe_cost ?? 0}
            lines={recipe}
            ingredients={ingredients}
          />
        </CardContent>
      </Card>
    </div>
  )
}
