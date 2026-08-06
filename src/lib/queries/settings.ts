import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type AppSettings = Tables<'app_settings'>

/**
 * React cache() deduplicates this across a single render pass, so a page
 * with twenty <Money /> instances still issues one query.
 */
export const getSettings = cache(async (): Promise<AppSettings> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .single()

  if (error) throw new Error(`Could not load app settings: ${error.message}`)
  return data
})
