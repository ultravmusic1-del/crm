import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type CustomerListRow = Tables<'v_customer_list'>
export type Customer = Tables<'customers'>
export type Contact = Tables<'contacts'>
export type Interaction = Tables<'interactions'>
export type FollowUpDue = Tables<'v_follow_ups_due'>

/**
 * Everything, unpaginated. Sorting, filtering and pagination are
 * client-side: this dataset stays in the low thousands for years and
 * server pagination would add latency for nothing. Do not "optimise" this
 * into server pagination without ALSO moving sort and filter — half a
 * migration sorts only the current page, which is worse than either.
 */
export async function listCustomers(): Promise<CustomerListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_customer_list')
    .select('*')
    .is('archived_at', null)
    .order('name', { ascending: true })

  if (error) throw new Error(`Could not load customers: ${error.message}`)
  return data ?? []
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('customers').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Could not load customer: ${error.message}`)
  return data
}

export async function listContacts(customerId: string): Promise<Contact[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('customer_id', customerId)
    .order('is_primary', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw new Error(`Could not load contacts: ${error.message}`)
  return data ?? []
}

export type InteractionWithContact = Interaction & {
  contacts: Pick<Contact, 'id' | 'name'> | null
}

export async function listInteractions(
  customerId: string,
): Promise<InteractionWithContact[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('interactions')
    .select('*, contacts ( id, name )')
    .eq('customer_id', customerId)
    .order('occurred_at', { ascending: false })

  if (error) throw new Error(`Could not load interactions: ${error.message}`)
  return data ?? []
}

export async function listFollowUpsDue(): Promise<FollowUpDue[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_follow_ups_due')
    .select('*')
    .order('follow_up_on', { ascending: true })

  if (error) throw new Error(`Could not load follow-ups: ${error.message}`)
  return data ?? []
}
