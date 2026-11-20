import type { ReactNode } from 'react'
import { ApiError } from '../../lib/api'
import { Failure } from '../../features/portal/blocks'
import { CATALOGUES, translator } from '../../features/portal/i18n'
import { portalSession, requestLocale, serverGet, settle } from '../../features/portal/i18n/server'
import { PortalShell } from '../../features/portal/shell'

/**
 * Distributor portal (portal realm, PLAN B5 §5, B-MKT D-BM-12): GET /v1/me and the unread count are read on the server
 * once per request and handed to the shell; every /portal page except sign-in lives under app/(portal)/portal/.
 */
export default async function PortalLayout({ children }: { readonly children: ReactNode }) {
  const session = await portalSession()
  if (session instanceof ApiError) {
    const locale = await requestLocale()
    return (
      <main lang={locale} className="bg-surface min-h-screen flex items-center justify-center p-space-md">
        <div className="w-full max-w-[480px]"><Failure error={session} t={translator(locale)} /></div>
      </main>
    )
  }
  const unread = await settle(serverGet<unknown>('/v1/me/notifications', { unread: 'true', limit: 1 }))
  const count = unread instanceof ApiError ? null : unread.meta.unread_count
  const { locale } = session.words
  return <PortalShell me={session.me} locale={locale} catalogue={CATALOGUES[locale]} unread={typeof count === 'number' ? count : null}>{children}</PortalShell>
}
