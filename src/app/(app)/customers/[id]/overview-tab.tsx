import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NO_VALUE } from '@/lib/format'
import { ContactsList } from './contacts-list'
import { NotesField } from './notes-field'
import type { Customer, Contact } from '@/lib/queries/customers'

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

export function OverviewTab({
  customer,
  contacts,
}: {
  customer: Customer
  contacts: Contact[]
}) {
  const address =
    [customer.address_line1, customer.address_line2, customer.city, customer.postcode]
      .filter(Boolean)
      .join(', ') || NO_VALUE

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label="Email" value={customer.email ?? NO_VALUE} />
              <DetailRow label="Phone" value={customer.phone ?? NO_VALUE} />
              <DetailRow label="Address" value={address} />
              <DetailRow label="Delivery notes" value={customer.delivery_notes ?? NO_VALUE} />
              <DetailRow label="Source" value={customer.source ?? NO_VALUE} />
              <DetailRow label="Price tier" value={capitalize(customer.price_tier)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <ContactsList customerId={customer.id} contacts={contacts} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <NotesField customerId={customer.id} initialNotes={customer.notes} />
        </CardContent>
      </Card>
    </div>
  )
}
