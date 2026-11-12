'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SECTIONS = [
  { href: '/vendor', label: 'Tenants', matches: (path: string) => path === '/vendor' || path.startsWith('/vendor/tenants') || path.startsWith('/vendor/provisioning') },
  { href: '/vendor/support-sessions', label: 'Support sessions', matches: (path: string) => path.startsWith('/vendor/support-sessions') },
  { href: '/vendor/users', label: 'Vendor users', matches: (path: string) => path.startsWith('/vendor/users') },
  { href: '/vendor/audit', label: 'Audit log', matches: (path: string) => path.startsWith('/vendor/audit') },
]

/**
 * Sections of the vendor console (UX-02 5). The API gives the console one navigation entry (/vendor); its sections
 * are listed here.
 */
export function ConsoleNav() {
  const pathname = usePathname()
  return (
    <nav className="console-nav" aria-label="Console sections">
      <ul>
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link href={section.href} aria-current={section.matches(pathname) ? 'page' : undefined}>{section.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
