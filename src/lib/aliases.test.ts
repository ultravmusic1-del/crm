import { describe, expect, it } from 'vitest'
import { fold, matchesAlias, NAV_ALIASES } from '@/lib/aliases'

describe('fold', () => {
  it('strips diacritics so cafe matches café', () => {
    expect(fold('Café Lila')).toBe('cafe lila')
  })

  it('lowercases and trims', () => {
    expect(fold('  Iron GYM ')).toBe('iron gym')
  })

  it('collapses internal whitespace', () => {
    expect(fold('Iron   Gym')).toBe('iron gym')
  })

  it('handles an empty string', () => {
    expect(fold('')).toBe('')
  })
})

describe('matchesAlias', () => {
  it('finds customers when you type client', () => {
    expect(matchesAlias('client', 'Customers', NAV_ALIASES.Customers)).toBe(true)
  })

  it('finds customers when you type the real word', () => {
    expect(matchesAlias('cust', 'Customers', NAV_ALIASES.Customers)).toBe(true)
  })

  it('finds production when you type bake', () => {
    expect(matchesAlias('bake', 'Production', NAV_ALIASES.Production)).toBe(true)
  })

  it('finds invoices when you type bill', () => {
    expect(matchesAlias('bill', 'Invoices', NAV_ALIASES.Invoices)).toBe(true)
  })

  it('finds schedules when you type recurring', () => {
    expect(matchesAlias('recurring', 'Schedules', NAV_ALIASES.Schedules)).toBe(true)
  })

  it('does not match an unrelated word', () => {
    expect(matchesAlias('zebra', 'Customers', NAV_ALIASES.Customers)).toBe(false)
  })

  it('matches everything on an empty query', () => {
    expect(matchesAlias('', 'Customers', NAV_ALIASES.Customers)).toBe(true)
  })
})
