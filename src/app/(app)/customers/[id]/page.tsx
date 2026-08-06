import { notFound } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getCustomer, listContacts, listInteractions } from '@/lib/queries/customers'
import { listEffectivePrices } from '@/lib/queries/pricing'
import { listOrdersForCustomer } from '@/lib/queries/orders'
import { CustomerHeader } from './customer-header'
import { OverviewTab } from './overview-tab'
import { ActivityTab } from './activity-tab'
import { PricingTab } from './pricing-tab'
import { OrdersTab } from './orders-tab'

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const customer = await getCustomer(id)
  if (!customer) notFound()

  const [contacts, interactions, prices, orders] = await Promise.all([
    listContacts(id),
    listInteractions(id),
    listEffectivePrices(id),
    listOrdersForCustomer(id),
  ])

  return (
    <div className="space-y-6">
      <CustomerHeader customer={customer} contacts={contacts} />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="min-h-11">
            Overview
          </TabsTrigger>
          <TabsTrigger value="activity" className="min-h-11">
            Activity
            {interactions.length > 0 ? (
              <span className="text-muted-foreground">{interactions.length}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="pricing" className="min-h-11">
            Pricing
          </TabsTrigger>
          <TabsTrigger value="orders" className="min-h-11">
            Orders
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab customer={customer} contacts={contacts} />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityTab customerId={customer.id} contacts={contacts} interactions={interactions} />
        </TabsContent>

        <TabsContent value="pricing">
          <PricingTab customerId={customer.id} priceTier={customer.price_tier} prices={prices} />
        </TabsContent>

        <TabsContent value="orders">
          <OrdersTab orders={orders} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
