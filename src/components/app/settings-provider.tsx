'use client'

import { createContext, useContext } from 'react'
import type { AppSettings } from '@/lib/queries/settings'

const SettingsContext = createContext<AppSettings | null>(null)

export function SettingsProvider({
  settings,
  children,
}: {
  settings: AppSettings
  children: React.ReactNode
}) {
  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): AppSettings {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings must be used inside the (app) layout')
  }
  return ctx
}
