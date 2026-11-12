'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { errorMessage } from '../lib/messages'
import { activeEntry, withNext, type NavigationEntry, type Realm } from '../lib/navigation'
import { shellRedirect, type Me } from '../lib/me'
import { supportFrameOf, type SupportSessionFrame } from '../lib/support-session'
import { SessionContext, useMe } from '../lib/session'
import { Avatar } from './avatar'
import { FOCUS_RING } from './button'
import { Icon } from './icon'
import { SignOutButton } from './sign-out-button'
import { ErrorState, LoadingState, NotAvailable } from './states'
import { SupportFrame } from './support-frame'

const SHELL_TITLE: Readonly<Record<Realm, (me: Me) => string>> = {
  tenant: (me) => me.tenant?.legal_name ?? 'Staff application',
  vendor: () => 'Operations console',
}

/** Client icon map by server navigation key (guidelines §8.1); an unknown key gets no icon. */
const NAV_ICONS: Readonly<Record<string, string>> = {
  overview: 'dashboard', periods: 'history_toggle_off', plans: 'schema', people: 'account_tree', orders: 'receipt_long',
  cases: 'rule_folder', payouts: 'payments', finance: 'account_balance', compliance: 'verified_user', imports: 'sync_alt',
  settings: 'tune', users: 'admin_panel_settings', vendor_access: 'vpn_key', audit: 'history_edu',
}

interface SidebarItem {
  readonly key: string
  readonly href: string
  readonly label: string
  readonly icon?: string
  readonly current: boolean
}

/**
 * Vendor console sections: the API gives the console one navigation entry (/vendor); its sections are fixed here.
 * Every section is a vendor-realm route the API serves to every vendor user.
 */
const VENDOR_SECTIONS: readonly (Omit<SidebarItem, 'current'> & { readonly matches: (path: string) => boolean })[] = [
  { key: 'tenants', href: '/vendor', label: 'Tenants', icon: 'corporate_fare', matches: (path) => path === '/vendor' || path.startsWith('/vendor/tenants') || path.startsWith('/vendor/provisioning') },
  { key: 'support_sessions', href: '/vendor/support-sessions', label: 'Support sessions', icon: 'vpn_key', matches: (path) => path.startsWith('/vendor/support-sessions') },
  { key: 'vendor_users', href: '/vendor/users', label: 'Vendor users', icon: 'admin_panel_settings', matches: (path) => path.startsWith('/vendor/users') },
  { key: 'audit', href: '/vendor/audit', label: 'Audit log', icon: 'history_edu', matches: (path) => path.startsWith('/vendor/audit') },
]

function sidebarItems(me: Me, pathname: string, current: NavigationEntry | undefined): readonly SidebarItem[] {
  if (me.realm === 'vendor') return VENDOR_SECTIONS.map(({ matches, ...section }) => ({ ...section, current: matches(pathname) }))
  return me.navigation.map((entry) => ({ key: entry.key, href: entry.path, label: entry.label, icon: NAV_ICONS[entry.key], current: entry === current }))
}

const LINK = `flex items-center gap-space-sm px-space-sm py-1.5 rounded font-body-sm text-body-sm transition-colors lg:justify-center xl:justify-start ${FOCUS_RING}`
const ACTIVE = 'bg-primary-container text-on-primary font-semibold'
const IDLE = 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'

/** sc_01 sidebar nav: labels at xl, a 56 px icon rail with tooltips at lg, an overlay below lg. */
function SidebarNav({ label, items, onNavigate }: { readonly label: string; readonly items: readonly SidebarItem[]; readonly onNavigate: () => void }) {
  return (
    <nav aria-label={label} className="py-space-sm px-space-xs">
      <ul className="space-y-space-xxs">
        {items.map((item) => (
          <li key={item.key}>
            <Link href={item.href} title={item.label} aria-current={item.current ? 'page' : undefined} onClick={onNavigate} className={`${LINK} ${item.current ? ACTIVE : IDLE}`}>
              {item.icon === undefined
                ? <span aria-hidden="true" className="hidden lg:inline xl:hidden w-[18px] text-center font-semibold">{item.label.charAt(0)}</span>
                : <Icon name={item.icon} size={18} />}
              <span className="lg:sr-only xl:not-sr-only">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** sc_01 header: menu (below lg), tenant name in place of the logo, user (initials, name, roles), sign out. */
function TopBar({ me, framed, menuOpen, onMenu, signOutRealm }: {
  readonly me: Me
  readonly framed: boolean
  readonly menuOpen: boolean
  readonly onMenu: () => void
  readonly signOutRealm: Realm
}) {
  const roles = me.roles.map((role) => role.name).join(', ')
  return (
    <header data-testid="app-header" className={`fixed ${framed ? 'top-8' : 'top-0'} left-0 right-0 h-12 bg-surface-container-lowest border-b border-outline-variant z-50 flex items-center justify-between gap-space-sm px-space-md select-none`}>
      <div className="flex items-center gap-space-sm min-w-0">
        <button type="button" aria-expanded={menuOpen} aria-controls="shell-nav" onClick={onMenu}
          className={`lg:hidden flex items-center gap-space-xs p-1 text-secondary hover:text-on-surface hover:bg-surface-container rounded transition-colors ${FOCUS_RING}`}>
          <Icon name={menuOpen ? 'close' : 'menu'} size={20} />
          <span className="font-body-sm text-body-sm">Menu</span>
        </button>
        <span className="font-section-heading text-section-heading text-primary font-bold tracking-tight truncate">{SHELL_TITLE[me.realm](me)}</span>
      </div>
      <div className="flex items-center gap-space-sm pl-space-xs">
        <Avatar name={me.user.display_name} email={me.user.email} />
        <div className="hidden lg:flex flex-col text-left leading-tight">
          <span className="font-body-sm text-body-sm text-on-surface font-semibold">{me.user.display_name ?? me.user.email}</span>
          {roles !== '' && <span className="font-caption text-caption text-secondary font-medium">{roles}</span>}
        </div>
        <div className="h-4 w-px bg-outline-variant" aria-hidden="true" />
        <SignOutButton realm={signOutRealm} />
      </div>
    </header>
  )
}

function ShellLayout({ me, frame, pathname, children }: {
  readonly me: Me
  readonly frame: SupportSessionFrame | null
  readonly pathname: string
  readonly children: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const main = useRef<HTMLElement>(null)
  const current = activeEntry(pathname, me.navigation)
  const framed = frame !== null
  // Client navigation (sign-in, links) would leave focus on <body>: start each page at its main content.
  useEffect(() => main.current?.focus({ preventScroll: true }), [pathname])
  function closeOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && menuOpen) setMenuOpen(false)
  }
  const shell = (
    <div className="bg-background font-body-md text-on-surface antialiased min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:px-space-sm focus:py-space-xs focus:rounded focus:bg-primary focus:text-on-primary">Skip to main content</a>
      <TopBar me={me} framed={framed} menuOpen={menuOpen} onMenu={() => setMenuOpen((open) => !open)} signOutRealm={framed ? 'vendor' : me.realm} />
      {menuOpen && <div aria-hidden="true" className={`lg:hidden fixed inset-x-0 bottom-0 ${framed ? 'top-20' : 'top-12'} z-30 bg-on-background/40`} onClick={() => setMenuOpen(false)} />}
      <aside id="shell-nav" data-testid="app-sidebar" onKeyDown={closeOnEscape}
        className={`fixed left-0 ${framed ? 'top-20' : 'top-12'} bottom-0 w-52 lg:w-14 xl:w-52 bg-surface-container-lowest border-r border-outline-variant z-40 flex-col overflow-y-auto ${menuOpen ? 'flex shadow-xl' : 'hidden'} lg:flex lg:shadow-none`}>
        <SidebarNav label={me.realm === 'vendor' ? 'Console' : 'Main'} items={sidebarItems(me, pathname, current)} onNavigate={() => setMenuOpen(false)} />
      </aside>
      <div className="lg:pl-14 xl:pl-52">
        <main ref={main} id="main" tabIndex={-1} className={`w-full ${framed ? 'pt-20' : 'pt-12'} min-h-screen bg-background focus:outline-none`}>
          <div className="flex flex-col w-full px-space-lg pt-space-md pb-space-2xl gap-space-md">
            {current === undefined ? <NotAvailable /> : children}
          </div>
        </main>
      </div>
    </div>
  )
  return frame === null ? shell : <SupportFrame frame={frame}>{shell}</SupportFrame>
}

function StatePage({ children }: { readonly children: ReactNode }) {
  return <main className="bg-background min-h-screen flex items-center justify-center p-space-lg"><div className="w-full max-w-[480px]">{children}</div></main>
}

/**
 * Staff (realm tenant) or vendor console (realm vendor) shell, sc_01: loads GET /v1/me, sends users with pending
 * MFA to the MFA pages and users of the other realm to their home, builds the sidebar from the server's navigation
 * entries (the vendor console from its fixed sections) and shows "Not found or not available to you" for pages
 * outside them. A vendor user inside a support session gets the tenant app, read-only, inside the support-session
 * frame. Pages read the user with useSession() and start with PageHeader.
 */
export function AppShell({ realm, children }: { readonly realm: Realm; readonly children: ReactNode }) {
  const { me, error, reload } = useMe()
  const frame = me === null ? null : supportFrameOf(me)
  const router = useRouter()
  const pathname = usePathname()
  const redirect = me === null ? null : shellRedirect(me, realm)
  useEffect(() => {
    // The query string comes back too (filters such as /settings/audit?action=...).
    if (redirect !== null) router.replace(redirect === '/' ? redirect : withNext(redirect, `${pathname}${window.location.search}`))
  }, [redirect, pathname, router])
  if (error !== null) return <StatePage><ErrorState message={errorMessage(error)} onRetry={reload} /></StatePage>
  if (me === null || redirect !== null) return <StatePage><LoadingState label="Loading your workspace" /></StatePage>
  return (
    <SessionContext value={me}>
      <ShellLayout me={me} frame={frame} pathname={pathname}>{children}</ShellLayout>
    </SessionContext>
  )
}
