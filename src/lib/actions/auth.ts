'use server'

import * as z from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { loginSchema } from '@/lib/schemas/auth'

/**
 * The return shape every Server Action in this app uses. Defined here
 * because auth is the first action written; import it from
 * '@/lib/actions/auth' everywhere else.
 */
export type ActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

export async function login(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  // Client-side Zod is a UX affordance. This is the security boundary.
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the details below.',
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Deliberately vague: never reveal whether the address has an account.
    return { ok: false, error: 'Those details did not work. Try again.' }
  }

  const next = String(formData.get('next') ?? '/')
  // Only ever redirect within this app — an open redirect here is free
  // credential phishing.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'

  revalidatePath('/', 'layout')
  redirect(safeNext)
}

export async function logout(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
