import {
  LayoutDashboard, Users, ShoppingCart, CalendarClock,
  ChefHat, FileText, Package, Carrot, TrendingUp, Settings,
} from 'lucide-react'

export type NavLink = {
  href: string
  label: string
  icon: typeof Users
  /** Phase 7 command palette: G-then-key. */
  shortcut?: string
}

export const NAV_LINKS: NavLink[] = [
  { href: '/',            label: 'Dashboard',   icon: LayoutDashboard, shortcut: 'd' },
  { href: '/customers',   label: 'Customers',   icon: Users,           shortcut: 'c' },
  { href: '/orders',      label: 'Orders',      icon: ShoppingCart,    shortcut: 'o' },
  { href: '/schedules',   label: 'Schedules',   icon: CalendarClock,   shortcut: 's' },
  { href: '/production',  label: 'Production',  icon: ChefHat,         shortcut: 'p' },
  { href: '/invoices',    label: 'Invoices',    icon: FileText,        shortcut: 'i' },
  { href: '/products',    label: 'Products',    icon: Package },
  { href: '/ingredients', label: 'Ingredients', icon: Carrot },
  { href: '/insights',    label: 'Insights',    icon: TrendingUp },
  { href: '/settings',    label: 'Settings',    icon: Settings },
]
