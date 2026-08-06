import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/queries/settings'
import { AppShell } from '@/components/app/app-shell'
import { SettingsProvider } from '@/components/app/settings-provider'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // Belt and braces behind the proxy: getClaims verifies the JWT locally.
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')

  const settings = await getSettings()
  const email = String(data.claims.email ?? '')

  return (
    <SettingsProvider settings={settings}>
      <AppShell email={email}>{children}</AppShell>
    </SettingsProvider>
  )
}
