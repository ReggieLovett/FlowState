'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: 'bi-grid-1x2' },
  { href: '/dashboard/schedule', label: 'Schedule', icon: 'bi-calendar2-week' },
  { href: '/dashboard/subjects', label: 'Subjects', icon: 'bi-collection' },
  { href: '/dashboard/rewards', label: 'Rewards', icon: 'bi-trophy' },
  { href: '/dashboard/settings', label: 'Settings', icon: 'bi-gear' },
] as const

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="d-flex flex-column gap-1">
      {ITEMS.map((item) => {
        // Exact match for the index route, prefix match for the rest, so
        // /dashboard does not stay highlighted on every child page.
        const active =
          item.href === '/dashboard'
            ? pathname === item.href
            : pathname.startsWith(item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`app-nav-link${active ? ' active' : ''}`}
          >
            <i className={`bi ${item.icon} app-nav-icon`} aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
