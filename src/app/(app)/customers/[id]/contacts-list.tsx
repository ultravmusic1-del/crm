'use client'

import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Plus, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { TextField } from '@/components/app/form-fields'
import { contactSchema, type ContactInput, type ContactOutput } from '@/lib/schemas/contacts'
import { createContact, updateContact, deleteContact } from '@/lib/actions/contacts'
import type { Contact } from '@/lib/queries/customers'

function toDefaultValues(customerId: string, contact?: Contact): ContactInput {
  return {
    customer_id: customerId,
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    is_primary: contact?.is_primary ?? false,
    notes: contact?.notes ?? '',
  }
}

function ContactFormRow({
  customerId,
  contact,
  onDone,
  onCancel,
}: {
  customerId: string
  contact?: Contact
  onDone: () => void
  onCancel: () => void
}) {
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ContactInput, unknown, ContactOutput>({
    resolver: zodResolver(contactSchema),
    mode: 'onTouched',
    defaultValues: toDefaultValues(customerId, contact),
  })

  async function onSubmit(values: ContactOutput) {
    const result = contact
      ? await updateContact(contact.id, values)
      : await createContact(values)
    if (result.ok) {
      toast.success(contact ? 'Contact saved' : 'Contact added')
      onDone()
    } else {
      toast.error(result.error ?? 'Something went wrong. Try again.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-lg border p-3">
      <TextField control={control} name="name" label="Name" autoFocus />
      <TextField control={control} name="role" label="Role" />
      <TextField
        control={control}
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
      />
      <TextField
        control={control}
        name="phone"
        label="Phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
      />

      <Controller
        control={control}
        name="is_primary"
        render={({ field }) => (
          <div className="flex items-center gap-2">
            <Switch
              id="is_primary"
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
            />
            <Label htmlFor="is_primary">Main contact</Label>
          </div>
        )}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="h-11" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

export function ContactsList({
  customerId,
  contacts,
}: {
  customerId: string
  contacts: Contact[]
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  async function handleDelete(id: string) {
    const result = await deleteContact(id, customerId)
    if (result.ok) {
      toast.success('Contact removed')
    } else {
      toast.error(result.error ?? 'Could not remove contact. Try again.')
    }
  }

  if (contacts.length === 0 && !adding) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          No contacts yet. Add the person you actually talk to.
        </p>
        <Button type="button" variant="outline" className="h-11" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Add contact
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {contacts.map((c) =>
        editingId === c.id ? (
          <ContactFormRow
            key={c.id}
            customerId={customerId}
            contact={c}
            onDone={() => setEditingId(null)}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div key={c.id} className="flex items-center gap-2 rounded-lg border p-3">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => setEditingId(c.id)}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{c.name}</span>
                {c.is_primary ? (
                  <Badge variant="secondary" className="gap-1">
                    <Star className="size-3" aria-hidden />
                    Main
                  </Badge>
                ) : null}
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {[c.role, c.email, c.phone].filter(Boolean).join(' · ') || 'No details'}
              </p>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              onClick={() => handleDelete(c.id)}
            >
              <Trash2 aria-hidden />
              <span className="sr-only">Remove contact</span>
            </Button>
          </div>
        ),
      )}

      {adding ? (
        <ContactFormRow
          customerId={customerId}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button type="button" variant="outline" className="h-11" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          Add contact
        </Button>
      )}
    </div>
  )
}
