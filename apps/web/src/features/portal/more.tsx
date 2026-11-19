'use client'

import Link from 'next/link'
import { Button } from '../../components/button'
import { Icon } from '../../components/icon'
import { useSignOut } from '../../components/sign-out-button'
import { usePortal } from './shell'
import { LINK_CARD, PAGE_TITLE, SECTION_TITLE } from './ui'

// More (UI_UX §4.4, sc_38 patterns): payment details and tax profile, notifications and profile, my data, Customers when
// Team took its place in the bottom bar, sign out. No language list (one locale, C-B5-13).

export function MorePage() {
  const { me } = usePortal()
  const customersMoved = me.navigation.some((entry) => entry.key === 'team')
  return (
    <>
      <h1 className={PAGE_TITLE}>More</h1>
      <nav aria-label="More" className="flex flex-col gap-space-xs">
        <MenuLink href="/portal/more/payment-details" icon="account_balance" title="Payment details and tax profile" />
        <MenuLink href="/portal/more/notifications" icon="notifications" title="Notifications and profile" />
        <MenuLink href="/portal/more/my-data" icon="shield_person" title="My data" />
        {customersMoved && <MenuLink href="/portal/customers" icon="group" title="Customers" />}
      </nav>
      <PortalSignOut />
    </>
  )
}

function MenuLink({ href, icon, title }: { readonly href: string; readonly icon: string; readonly title: string }) {
  return (
    <Link href={href} className={LINK_CARD}>
      <span className="flex items-center gap-space-sm min-w-0">
        <span className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center shrink-0 text-primary"><Icon name={icon} size={20} /></span>
        <span className={SECTION_TITLE}>{title}</span>
      </span>
      <Icon name="chevron_right" size={20} className="text-secondary shrink-0" />
    </Link>
  )
}

/** sc_38 sign-out: ends the session and opens the portal sign-in of this company. */
export function PortalSignOut() {
  const { me } = usePortal()
  const { busy, error, signOut } = useSignOut('portal', me.tenant?.slug ?? null)
  return (
    <div className="flex flex-col gap-space-xs">
      <Button size="lg" variant="destructive" icon="logout" loading={busy} onClick={signOut}>Sign out</Button>
      {error !== null && <p role="alert" className="font-body-sm text-body-sm text-error">{error}</p>}
    </div>
  )
}
