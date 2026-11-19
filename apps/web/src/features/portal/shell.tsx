'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, use, useEffect, useRef, type ReactNode } from 'react'
import { Avatar } from '../../components/avatar'
import { FOCUS_RING } from '../../components/button'
import { Icon } from '../../components/icon'
import { ErrorState, LoadingState } from '../../components/states'
import { errorMessage } from '../../lib/messages'
import { activeEntry, MFA_VERIFY_PATH, withNext, type NavigationEntry } from '../../lib/navigation'
import { useResource } from '../../lib/use-resource'
import type { PortalMe, PortalProfile } from './types'

// P2 portal shell (sc_37 header + sc_18 bottom nav; PLAN B5 §5): phone = fixed top bar and bottom nav with labels,
// ≥ 768 px the T2 layout (the same items in the top bar, one centred column ≤ 720 px), ≥ 1024 px room for the
// line-explanation side panel.

export interface Portal {
  readonly me: PortalMe
  readonly profile: PortalProfile
  /** The participant's market zone: period bounds and dates read in it. */
  readonly zone: string
  /** Unread inbox notices (null while unknown). */
  readonly unread: number | null
  readonly refreshUnread: () => void
}

const PortalContext = createContext<Portal | null>(null)

/** The signed-in distributor inside PortalShell. */
export function usePortal(): Portal {
  const portal = use(PortalContext)
  if (portal === null) throw new Error('usePortal is only available inside PortalShell')
  return portal
}

/** Test and shell provider. */
export const PortalProvider = PortalContext

/** Client icon map by the server's portal navigation keys. */
const NAV_ICONS: Readonly<Record<string, string>> = {
  home: 'dashboard', earnings: 'receipt_long', rank: 'military_tech', customers: 'group', team: 'account_tree', more: 'more_horiz',
}

const SECTION_TITLES: Readonly<Record<string, string>> = {
  earnings: 'Earnings', rank: 'Rank', team: 'Team', customers: 'Customers', more: 'More',
}

/** The page one level up ("…/lines/<id>" goes back to its statement); none on the section pages. */
export function backPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length <= 2) return null
  const up = parts.at(-2) === 'lines' ? parts.slice(0, -2) : parts.slice(0, -1)
  return `/${up.join('/')}`
}

/** Where the shell sends this user instead of rendering: staff home for a staff session, the MFA step when pending. */
export function portalRedirect(me: PortalMe, current: string): string | null {
  if (me.realm !== 'portal') return '/'
  if (me.participant === null || (me.mfa.enrolled && !me.mfa.verified)) return withNext(MFA_VERIFY_PATH, current)
  return null
}

export function PortalShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const me = useResource<PortalMe>('/v1/me')
  const redirect = me.data === null ? null : portalRedirect(me.data, pathname)
  const ready = me.data !== null && redirect === null
  const unread = useResource<unknown>(ready ? '/v1/me/notifications' : null, { unread: true, limit: 1 })
  useEffect(() => {
    if (redirect !== null) router.replace(redirect)
  }, [redirect, router])
  if (me.error !== null) return <Centered><ErrorState message={errorMessage(me.error)} onRetry={me.reload} /></Centered>
  if (!ready || me.data === null || me.data.participant === null) return <Centered><LoadingState label="Loading your account" /></Centered>
  const count = unread.meta.unread_count
  const portal: Portal = {
    me: me.data, profile: me.data.participant, zone: me.data.participant.market.time_zone,
    unread: typeof count === 'number' ? count : null, refreshUnread: unread.reload,
  }
  return (
    <PortalContext value={portal}>
      <ShellLayout portal={portal} pathname={pathname}>{children}</ShellLayout>
    </PortalContext>
  )
}

function Centered({ children }: { readonly children: ReactNode }) {
  return <main className="bg-surface min-h-screen flex items-center justify-center p-space-md"><div className="w-full max-w-[480px]">{children}</div></main>
}

function ShellLayout({ portal, pathname, children }: { readonly portal: Portal; readonly pathname: string; readonly children: ReactNode }) {
  const main = useRef<HTMLElement>(null)
  // Client navigation would leave focus on <body>: each page starts at its main content.
  useEffect(() => main.current?.focus({ preventScroll: true }), [pathname])
  const entries = portal.me.navigation
  const matched = activeEntry(pathname, entries)
  // A section without its own entry (Customers when Team holds that place) is reached from More: More is current, not Home.
  const active = matched?.key === 'home' && pathname !== matched.path ? entries.find((entry) => entry.key === 'more') ?? matched : matched
  const back = backPath(pathname)
  const section = SECTION_TITLES[pathname.split('/')[2] ?? ''] ?? 'Home'
  return (
    <div className="min-h-screen bg-surface font-body-lg text-body-lg text-on-surface antialiased flex flex-col">
      <a href="#portal-main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:px-space-sm focus:py-space-xs focus:rounded focus:bg-primary focus:text-on-primary">Skip to main content</a>
      <header data-testid="app-header" className="fixed top-0 w-full z-50 bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-safe">
        <div className="h-16 px-margin-mobile flex items-center justify-between gap-space-sm">
          <div className="flex items-center gap-space-xs min-w-0">
            {back !== null && (
              <Link href={back} aria-label="Back" className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-lg bg-surface-container-low text-primary hover:bg-surface-container transition-colors ${FOCUS_RING}`}>
                <Icon name="arrow_back" size={20} />
              </Link>
            )}
            <div className="flex md:hidden lg:flex flex-col justify-center min-w-0">
              <span className="text-caption font-caption text-primary-container font-semibold truncate">{portal.me.tenant?.legal_name ?? ''}</span>
              <span className="text-section-heading font-section-heading text-on-surface tracking-tight leading-none mt-space-xxs truncate">{section}</span>
            </div>
          </div>
          <nav aria-label="Portal sections" className="hidden md:flex items-center gap-space-xs">
            {entries.map((entry) => <TopItem key={entry.key} entry={entry} current={entry === active} />)}
          </nav>
          <div className="flex items-center gap-space-xs shrink-0">
            <Link href="/portal/more/notifications" aria-label={portal.unread ? `Notifications, ${portal.unread} unread` : 'Notifications'}
              className={`relative w-11 h-11 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface transition-colors ${FOCUS_RING}`}>
              <Icon name="notifications" size={20} />
              {portal.unread !== null && portal.unread > 0 && <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-error ring-2 ring-surface" />}
            </Link>
            <Avatar name={portal.profile.display_name ?? portal.me.user.display_name} email={portal.me.user.email} />
          </div>
        </div>
      </header>
      <main ref={main} id="portal-main" tabIndex={-1} className="flex-1 w-full px-margin-mobile pt-[calc(4rem+env(safe-area-inset-top,0px))] pb-[calc(6rem+env(safe-area-inset-bottom,0px))] md:pb-space-xl focus:outline-none">
        <div className="mx-auto w-full sm:max-w-[600px] md:max-w-[720px] lg:has-[[data-side-panel]]:max-w-[1104px] flex flex-col gap-space-md py-space-md">
          {children}
        </div>
      </main>
      <nav aria-label="Portal sections" className="md:hidden fixed bottom-0 w-full z-50 pb-safe bg-surface/90 backdrop-blur-xl shadow-[0_-2px_12px_rgba(13,28,46,0.05)]">
        <div className="flex justify-around items-center h-16 px-space-xs">
          {entries.map((entry) => (
            <Link key={entry.key} href={entry.path} aria-current={entry === active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-space-xxs min-w-[56px] h-11 transition-colors ${FOCUS_RING} ${entry === active ? 'text-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface'}`}>
              <Icon name={NAV_ICONS[entry.key] ?? 'circle'} size={20} />
              <span className="font-caption text-caption">{entry.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}

function TopItem({ entry, current }: { readonly entry: NavigationEntry; readonly current: boolean }) {
  return (
    <Link href={entry.path} aria-current={current ? 'page' : undefined}
      className={`flex items-center gap-space-xs h-11 px-space-sm rounded-lg transition-colors ${FOCUS_RING} ${current ? 'text-primary font-semibold bg-surface-container-low' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'}`}>
      <Icon name={NAV_ICONS[entry.key] ?? 'circle'} size={18} />
      <span className="font-body-lg text-body-lg">{entry.label}</span>
    </Link>
  )
}
