'use server'

import * as z from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { settingsSchema } from '@/lib/schemas/settings'
import type { ActionResult } from '@/lib/actions/auth'

/**
 * Client-side Zod (in settings-form.tsx) is a UX affordance. This
 * re-validation is the actual boundary.
 */
export async function updateSettings(raw: unknown): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(raw)

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the fields below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('app_settings')
    .update(parsed.data)
    .eq('id', 1)

  if (error) {
    return { ok: false, error: 'Could not save settings. Try again.' }
  }

  // Currency lives in the (app) layout via SettingsProvider, so a narrower
  // revalidate leaves <Money /> rendering the old symbol everywhere.
  revalidatePath('/', 'layout')
  return { ok: true }
}
