import { listIngredients } from '@/lib/queries/products'
import { IngredientsTable } from './ingredients-table'

export default async function IngredientsPage() {
  const ingredients = await listIngredients()

  return <IngredientsTable ingredients={ingredients} />
}
