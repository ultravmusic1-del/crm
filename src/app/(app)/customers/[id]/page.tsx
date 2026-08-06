import { notFound } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getCustomer, listContacts, listInteractions } from '@/lib/queries/customers'
import { CustomerHeader } from './customer-header'
import { OverviewTab } from './overview-tab'

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const customer = await getCustomer(id)
  if (!customer) notFound()

  const [contacts, interactions] = await Promise.all([
    listContacts(id),
    listInteractions(id),
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
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab customer={customer} contacts={contacts} />
        </TabsContent>

        <TabsContent value="activity">
          <p className="text-sm text-muted-foreground">
            Interaction logging arrives in the next task.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  )
}
