'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { errorMessage } from '../lib/messages'
import { activeEntry, withNext, type Realm } from '../lib/navigation'
import { shellRedirect, type Me } from '../lib/me'
import { supportFrameOf, type SupportSessionFrame } from '../lib/support-session'
import { SessionContext, useMe } from '../lib/session'
import { Button } from './button'
import { SignOutButton } from './sign-out-button'
import { ErrorState, LoadingState, NotAvailable } from './states'
import { SupportFrame } from './support-frame'

const SHELL_TITLE: Readonly<Record<Realm, (me: Me) => string>> = {
  tenant: (me) => me.tenant?.legal_name ?? 'Staff application',
  vendor: () => 'Operations console',
}

function ShellLayout({ me, frame, pathname, children }: {
  readonly me: Me
  readonly frame: SupportSessionFrame | null
  readonly pathname: string
  readonly children: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const current = activeEntry(pathname, me.navigation)
  const shell = (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="shell-header">
        <Button variant="tertiary" className="shell-menu-button" aria-expanded={menuOpen} aria-controls="shell-nav" onClick={() => setMenuOpen((open) => !open)}>
          Menu
        </Button>
        <span className="shell-title">{SHELL_TITLE[me.realm](me)}</span>
        <div className="shell-user">
          <span className="shell-user-name">{me.user.display_name ?? me.user.email}</span>
          <SignOutButton realm={frame === null ? me.realm : 'vendor'} />
        </div>
      </header>
      <nav id="shell-nav" className="shell-nav" data-open={menuOpen} aria-label={me.realm === 'vendor' ? 'Console' : 'Main'}>
        <ul>
          {me.navigation.map((entry) => (
            <li key={entry.key}>
              <Link href={entry.path} aria-current={entry === current ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" className="shell-main" tabIndex={-1}>
        {current === undefined ? <NotAvailable /> : children}
      </main>
    </div>
  )
  return frame === null ? shell : <SupportFrame frame={frame}>{shell}</SupportFrame>
}

/**
 * Staff (realm tenant) or vendor console (realm vendor) shell: loads GET /v1/me, sends users with pending MFA
 * to the MFA pages and users of the other realm to their home, builds the sidebar from the server's navigation
 * entries and shows "Not found or not available to you" for pages outside them. A vendor user inside a support
 * session gets the tenant app, read-only, inside the support-session frame. Pages read the user with useSession().
 */
export function AppShell({ realm, children }: { readonly realm: Realm; readonly children: ReactNode }) {
  const { me: loaded, error, reload } = useMe()
  const frame = loaded === null ? null : supportFrameOf(loaded)
  // Inside a support session GET /v1/me has no user (the vendor user is not a tenant row): the frame carries it.
  const me = loaded === null || frame === null ? loaded : { ...loaded, user: frame.user }
  const router = useRouter()
  const pathname = usePathname()
  const redirect = me === null ? null : shellRedirect(me, realm)
  useEffect(() => {
    // The query string comes back too (filters such as /settings/audit?action=...).
    if (redirect !== null) router.replace(redirect === '/' ? redirect : withNext(redirect, `${pathname}${window.location.search}`))
  }, [redirect, pathname, router])
  if (error !== null) return <main className="state-page"><ErrorState message={errorMessage(error)} onRetry={reload} /></main>
  if (me === null || redirect !== null) return <main className="state-page"><LoadingState label="Loading your workspace" /></main>
  return (
    <SessionContext value={me}>
      <ShellLayout me={me} frame={frame} pathname={pathname}>{children}</ShellLayout>
    </SessionContext>
  )
}
