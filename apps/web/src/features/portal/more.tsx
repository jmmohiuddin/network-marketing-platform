import Link from 'next/link'
import { Icon } from '../../components/icon'
import { ApiError } from '../../lib/api'
import { LINK_CARD, PAGE_TITLE, SECTION_TITLE } from './blocks'
import { portalSession, serverGet, settle } from './i18n/server'
import type { TaxForm } from './types'
import { PortalSignOut } from './ui'

// More (UI_UX §4.4, sc_38 patterns), server-rendered: payment details and tax profile, tax statements (only when the
// distributor has one), notifications and profile, language (D-BM-11), my data, Customers when Team took its place in
// the bottom bar, sign out.

export async function MorePage() {
  const session = await portalSession()
  if (session instanceof ApiError) return null
  const { me, words: { t } } = session
  const forms = await settle(serverGet<TaxForm[]>('/v1/me/tax-forms'))
  const customersMoved = me.navigation.some((entry) => entry.key === 'team')
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('nav.more')}</h1>
      <nav aria-label={t('nav.more')} className="flex flex-col gap-space-xs">
        <MenuLink href="/portal/more/payment-details" icon="account_balance" title={t('payment.title')} />
        {/* Hidden only when the read succeeded with none: the page itself shows a failed read with Try again. */}
        {(forms instanceof ApiError || forms.data.length > 0) && <MenuLink href="/portal/more/tax-statements" icon="description" title={t('tax_forms.title')} />}
        <MenuLink href="/portal/more/notifications" icon="notifications" title={t('notifications.title')} />
        <MenuLink href="/portal/more/language" icon="translate" title={t('language.title')} />
        <MenuLink href="/portal/more/my-data" icon="shield_person" title={t('my_data.title')} />
        {customersMoved && <MenuLink href="/portal/customers" icon="group" title={t('nav.customers')} />}
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
        <span className={`${SECTION_TITLE} break-words min-w-0`}>{title}</span>
      </span>
      <Icon name="chevron_right" size={20} className="text-secondary shrink-0" />
    </Link>
  )
}
