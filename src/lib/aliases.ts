/** Diacritic-insensitive, case-insensitive, whitespace-normalised. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Spec §6.5: forgiving matching. She will not learn our vocabulary, and
 * she should not have to.
 */
export const NAV_ALIASES: Record<string, string[]> = {
  Dashboard:   ['home', 'today', 'overview', 'start'],
  Customers:   ['client', 'clients', 'cafe', 'account', 'accounts', 'contact', 'contacts', 'lead', 'leads'],
  Orders:      ['order', 'sale', 'sales', 'delivery', 'deliveries'],
  Schedules:   ['recurring', 'standing', 'repeat', 'weekly', 'subscription'],
  Production:  ['bake', 'baking', 'kitchen', 'shopping', 'ingredients needed', 'prep'],
  Invoices:    ['bill', 'billing', 'invoice', 'payment', 'payments', 'money owed'],
  Products:    ['bar', 'bars', 'catalogue', 'catalog', 'item', 'items', 'sku'],
  Ingredients: ['stock', 'supplies', 'oats', 'raw'],
  Insights:    ['report', 'reports', 'analytics', 'stats', 'numbers', 'revenue'],
  Settings:    ['config', 'preferences', 'currency', 'bank', 'business details'],
}

export function matchesAlias(
  query: string,
  label: string,
  aliases: string[] = [],
): boolean {
  const q = fold(query)
  if (q === '') return true
  if (fold(label).includes(q)) return true
  return aliases.some((a) => fold(a).includes(q))
}
