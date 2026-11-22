'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, use, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Avatar } from '../../components/avatar'
import { FOCUS_RING } from '../../components/button'
import { Icon } from '../../components/icon'
import { activeEntry, type NavigationEntry } from '../../lib/navigation'
import { l10n, type L10n } from './format'
import type { Catalogue, Locale, Translate } from './i18n'
import { knownMessage, translate } from './i18n/translate'
import type { PortalMe, PortalProfile } from './types'

// P2 portal shell (sc_37 header + sc_18 bottom nav; PLAN B5 §5): phone = fixed top bar and bottom nav with labels,
// ≥ 768 px the T2 layout (the same items in the top bar, one centred column ≤ 720 px), ≥ 1024 px room for the
// line-explanation side panel. The layout reads GET /v1/me on the server (D-BM-12) and hands it in; every word comes
// from the catalogue of the effective locale (bottom-nav labels by navigation key, D-BM-11). Links do not prefetch: on a
// 1.6 Mbit/s line every page load would also fetch the sections it links to (NFR-PERF-06, BUG-132).

export interface Portal {
  readonly me: PortalMe
  readonly profile: PortalProfile
  /** The participant's market zone: period bounds and dates read in it. */
  readonly zone: string
  /** The effective locale's words and formats in the market zone. */
  readonly words: L10n
  /** D-V1A-07: offboarding confirmed or archived; write controls are hidden (the API refuses them with TENANT_READ_ONLY), the data-subject request form stays (C-V1A-18). */
  readonly readOnly: boolean
  /** Unread inbox notices (null while unknown). */
  readonly unread: number | null
  /** Renders the server parts again (unread count, language). */
  readonly refresh: () => void
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

/** A navigation entry's label from the catalogue by its key (the API's English label is not shown). */
export function navLabel(key: string, t: Translate): string {
  return knownMessage(t, `nav.${key}`) ?? key
}

/** The page one level up ("…/lines/<id>" goes back to its statement); none on the section pages. */
export function backPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length <= 2) return null
  const up = parts.at(-2) === 'lines' ? parts.slice(0, -2) : parts.slice(0, -1)
  return `/${up.join('/')}`
}

/** `catalogue` is the effective locale's only (the server hands it in, so the page scripts carry no catalogue). */
export function PortalShell({ me, locale, catalogue, unread, children }: {
  readonly me: PortalMe
  readonly locale: Locale
  readonly catalogue: Catalogue
  readonly unread: number | null
  readonly children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const profile = me.participant!
  const zone = profile.market.time_zone
  const words = useMemo(() => l10n(locale, zone, translate(catalogue, locale)), [locale, zone, catalogue])
  const portal: Portal = { me, profile, zone, words, readOnly: me.tenant?.read_only === true, unread, refresh: router.refresh }
  return (
    <PortalContext value={portal}>
      <ShellLayout portal={portal} pathname={pathname}>{children}</ShellLayout>
    </PortalContext>
  )
}

function ShellLayout({ portal, pathname, children }: { readonly portal: Portal; readonly pathname: string; readonly children: ReactNode }) {
  const main = useRef<HTMLElement>(null)
  const { t, locale } = portal.words
  // Client navigation would leave focus on <body>: each page starts at its main content.
  useEffect(() => main.current?.focus({ preventScroll: true }), [pathname])
  const entries = portal.me.navigation
  const matched = activeEntry(pathname, entries)
  // A section without its own entry (Customers when Team holds that place) is reached from More: More is current, not Home.
  const active = matched?.key === 'home' && pathname !== matched.path ? entries.find((entry) => entry.key === 'more') ?? matched : matched
  const back = backPath(pathname)
  const section = navLabel(pathname.split('/')[2] ?? 'home', t)
  return (
    <div lang={locale} className="min-h-screen bg-surface font-body-lg text-body-lg text-on-surface antialiased flex flex-col">
      <a href="#portal-main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:px-space-sm focus:py-space-xs focus:rounded focus:bg-primary focus:text-on-primary">{t('shell.skip')}</a>
      <header data-testid="app-header" className="fixed top-0 w-full z-50 bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] pt-safe">
        <div className="h-16 px-margin-mobile flex items-center justify-between gap-space-sm">
          <div className="flex items-center gap-space-xs min-w-0">
            {back !== null && (
              <Link href={back} prefetch={false} aria-label={t('shell.back')} className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-lg bg-surface-container-low text-primary hover:bg-surface-container transition-colors ${FOCUS_RING}`}>
                <Icon name="arrow_back" size={20} />
              </Link>
            )}
            <div className="flex md:hidden lg:flex flex-col justify-center min-w-0">
              <span className="text-caption font-caption text-primary-container font-semibold truncate">{portal.me.tenant?.legal_name ?? ''}</span>
              <span className="text-section-heading font-section-heading text-on-surface tracking-tight leading-none mt-space-xxs truncate">{section}</span>
            </div>
          </div>
          <nav aria-label={t('shell.sections')} className="hidden md:flex items-center gap-space-xs min-w-0">
            {entries.map((entry) => <TopItem key={entry.key} entry={entry} label={navLabel(entry.key, t)} current={entry === active} />)}
          </nav>
          <div className="flex items-center gap-space-xs shrink-0">
            <Link href="/portal/more/notifications" prefetch={false} aria-label={portal.unread ? t('shell.notifications_unread', { count: portal.unread }) : t('shell.notifications')}
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
          {portal.readOnly && (
            // D-V1A-07: not dismissable while the account is read-only (the API refuses changes with TENANT_READ_ONLY).
            <p role="status" data-testid="read-only-notice" className="flex items-start gap-space-xs p-space-sm rounded-lg bg-primary-fixed text-primary font-body-sm text-body-sm">
              <Icon name="info" size={18} className="shrink-0 mt-0.5" />{t('shell.read_only')}
            </p>
          )}
          {children}
        </div>
      </main>
      <nav aria-label={t('shell.sections')} className="md:hidden fixed bottom-0 w-full z-50 pb-safe bg-surface/90 backdrop-blur-xl shadow-[0_-2px_12px_rgba(13,28,46,0.05)]">
        <div className="flex justify-around items-center h-16 px-space-xs">
          {entries.map((entry) => (
            <Link key={entry.key} href={entry.path} prefetch={false} aria-current={entry === active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-space-xxs min-w-[56px] h-11 transition-colors ${FOCUS_RING} ${entry === active ? 'text-primary font-semibold' : 'text-on-surface-variant hover:text-on-surface'}`}>
              <Icon name={NAV_ICONS[entry.key] ?? 'circle'} size={20} />
              <span className="font-caption text-caption">{navLabel(entry.key, t)}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}

function TopItem({ entry, label, current }: { readonly entry: NavigationEntry; readonly label: string; readonly current: boolean }) {
  return (
    <Link href={entry.path} prefetch={false} aria-current={current ? 'page' : undefined}
      className={`flex items-center gap-space-xs h-11 px-space-sm rounded-lg transition-colors ${FOCUS_RING} ${current ? 'text-primary font-semibold bg-surface-container-low' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'}`}>
      <Icon name={NAV_ICONS[entry.key] ?? 'circle'} size={18} />
      <span className="font-body-lg text-body-lg">{label}</span>
    </Link>
  )
}
