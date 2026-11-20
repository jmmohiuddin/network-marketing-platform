import Link from 'next/link'
import type { ReactNode } from 'react'
import { LinkButton } from '../../components/button'
import { Icon } from '../../components/icon'
import { EmptyState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { ApiError } from '../../lib/api'
import { CAPTION, CARD, ClosedNotice, Failure, LINK_CARD, LIST_TITLE, MONO, PAGE_TITLE, SECTION_TITLE, SHOW_FIRST, TEXT_LINK } from './blocks'
import { noticeView, paidAsText, payoutState, type L10n } from './format'
import { portalSession, serverGet, settle } from './i18n/server'
import type { BankDetails, Notice, Statement, StatementSummary } from './types'

// SC-37 distributor home (sc_37), server-rendered (D-BM-12): identity strip, the latest committed statement's net as the
// largest element with its payout state, alerts, module links. No activity snapshot, targets, leg counts or repeat
// rates (BR-HON-01, UI_UX §4.4).

const ALERT_TEMPLATES = new Set(['dispute.updated', 'plan.change_scheduled', 'tax_form.available'])
const ALERT_PAGE = 50

export async function PortalHome() {
  const session = await portalSession()
  if (session instanceof ApiError) return null
  const { me, profile, words } = session
  const { t } = words
  const [latest, bank, notices] = await Promise.all([
    settle(serverGet<StatementSummary[]>('/v1/me/statements', { limit: 1 })),
    settle(serverGet<BankDetails>('/v1/me/bank-details')),
    settle(serverGet<Notice[]>('/v1/me/notifications', { unread: 'true', limit: ALERT_PAGE })),
  ])
  const summary = latest instanceof ApiError ? null : latest.data[0] ?? null
  const statement = summary === null ? null : await settle(serverGet<Statement>(`/v1/me/statements/${summary.run_id}`))
  const position = profile.positions[0]
  // The rank of the position named in the strip, not of whichever position the statement lists first.
  const paidAs = statement === null || statement instanceof ApiError ? [] : statement.data.positions.find((row) => row.position_id === position?.id)?.paid_as ?? []
  const team = me.navigation.some((entry) => entry.key === 'team')
  // A migrated participant may have no name: greet without one, never by the e-mail address (BUG-138).
  const name = profile.display_name ?? me.user.display_name
  return (
    <>
      <section aria-labelledby="home-title" className={`${CARD} flex flex-col`}>
        <div className="flex items-start justify-between gap-space-sm flex-wrap">
          <div className="flex flex-col min-w-0">
            <div className={`flex items-center gap-space-xs flex-wrap ${CAPTION}`}>
              {position !== undefined && <span className={MONO}>{position.position_ref}</span>}
              {position !== undefined && <span className="text-outline" aria-hidden="true">•</span>}
              <span className="font-medium">{profile.market.code} · {profile.market.currency}</span>
            </div>
            <h1 id="home-title" className={`${PAGE_TITLE} mt-0.5 break-words`}>{name === null ? t('home.welcome_back') : t('home.welcome', { name })}</h1>
          </div>
          {paidAs.length > 0 && (
            <span className="flex items-center gap-1.5 px-space-xs py-1 rounded bg-surface-container-high text-primary font-section-heading text-caption shrink-0">
              <Icon name="military_tech" size={16} filled />
              <span>{paidAsText(paidAs, t)}</span>
            </span>
          )}
        </div>
      </section>
      {profile.terminated && <ClosedNotice t={t} />}
      {latest instanceof ApiError
        ? <Failure error={latest} t={t} section retry={<LinkButton href="/portal">{t('common.try_again')}</LinkButton>} />
        : <LatestStatement summary={summary} words={words} />}
      <Alerts bank={bank instanceof ApiError ? null : bank.data} notices={notices instanceof ApiError ? [] : notices.data} words={words} />
      {!profile.terminated && (
        <nav aria-label={t('home.records')} className="flex flex-col gap-space-xs">
          <ModuleLink href="/portal/rank" icon="military_tech" title={t('nav.rank')} text={t('home.rank_text')} />
          {team
            ? <ModuleLink href="/portal/team" icon="account_tree" title={t('nav.team')} text={t('home.team_text')} />
            : <ModuleLink href="/portal/customers" icon="group" title={t('nav.customers')} text={t('home.customers_text')} />}
        </nav>
      )}
    </>
  )
}

function LatestStatement({ summary, words }: { readonly summary: StatementSummary | null; readonly words: L10n }) {
  const { t } = words
  if (summary === null) return <EmptyState title={t('home.no_statement')}>{t('home.no_statement_text')}</EmptyState>
  const payout = payoutState(summary.payout_state, summary.net_minor, t)
  return (
    <section aria-labelledby="latest-title" data-testid="card" className={`${CARD} flex flex-col`}>
      <div className="flex items-center justify-between gap-space-sm flex-wrap">
        <h2 id="latest-title" className="text-caption font-caption uppercase tracking-wider text-secondary font-semibold">{t('home.net_of', { period: words.period(summary.period.starts_at, summary.period.ends_at) })}</h2>
        <StatusBadge state={payout.state} label={payout.label} />
      </div>
      <p className="mt-space-sm text-display font-display text-on-surface tracking-tight font-bold break-words">{words.money(summary.net_minor ?? '0', summary.market)}</p>
      <p className={`${CAPTION} mt-0.5`}>{t('home.committed_on', { at: words.time(summary.committed_at) })}</p>
      <div className="mt-space-md">
        <LinkButton href={`/portal/earnings/${summary.run_id}`} variant="primary" size="lg" className="w-full" data-testid="primary-action">{t('home.open_statement')}</LinkButton>
      </div>
    </section>
  )
}

/** Cooling-off of new bank details, and unread dispute, plan-change and tax-statement notices. */
function Alerts({ bank, notices, words }: { readonly bank: BankDetails | null; readonly notices: readonly Notice[]; readonly words: L10n }) {
  const { t } = words
  const coolingOff = bank?.current?.cooling_off_until ?? null
  const waiting = coolingOff !== null && new Date(coolingOff).getTime() > Date.now()
  const items = [
    ...(waiting
      ? [
        <Alert key="cooling-off" title={t('home.cooling_off_title')} href="/portal/more/payment-details" linkLabel={t('notice.link.payment')}>
          {t('home.cooling_off_text', { masked: bank?.current?.masked ?? '', until: words.time(coolingOff) })}
        </Alert>,
      ]
      : []),
    ...notices.filter((notice) => ALERT_TEMPLATES.has(notice.template)).map((notice) => {
      const view = noticeView(notice, words)
      return <Alert key={notice.id} title={view.title} href={view.href} linkLabel={view.linkLabel}>{view.text}</Alert>
    }),
  ]
  if (items.length === 0) return null
  return (
    <section aria-labelledby="alerts-title" className="flex flex-col gap-space-xs">
      <h2 id="alerts-title" className={LIST_TITLE}>{t('home.notices')}</h2>
      {items.slice(0, SHOW_FIRST)}
      {items.length > SHOW_FIRST && <Link href="/portal/more/notifications" className={`${TEXT_LINK} px-space-xs`}>{t('home.see_all')} <Icon name="chevron_right" size={14} /></Link>}
    </section>
  )
}

function Alert({ title, href, linkLabel, children }: { readonly title: string; readonly href: string | null; readonly linkLabel: string | null; readonly children: ReactNode }) {
  return (
    <div className="flex items-start gap-space-sm p-space-sm rounded-lg bg-surface-container-lowest shadow-sm">
      <div className="w-1 self-stretch bg-primary-container rounded-full shrink-0" />
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon name="info" size={18} className="text-primary-container" />
          <span className="text-body-lg font-body-lg font-semibold text-on-surface">{title}</span>
        </div>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-1 break-words">{children}</p>
        {href !== null && linkLabel !== null && (
          <Link href={href} className="inline-flex items-center gap-0.5 min-h-11 font-body-sm text-body-sm text-primary-container font-semibold hover:underline">
            {linkLabel} <Icon name="chevron_right" size={14} />
          </Link>
        )}
      </div>
    </div>
  )
}

function ModuleLink({ href, icon, title, text }: { readonly href: string; readonly icon: string; readonly title: string; readonly text: string }) {
  return (
    <Link href={href} className={`${LINK_CARD} group`}>
      <div className="flex items-start gap-space-sm min-w-0">
        <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center shrink-0 text-primary">
          <Icon name={icon} size={20} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className={SECTION_TITLE}>{title}</span>
          <span className="font-body-lg text-body-lg text-on-surface-variant mt-0.5">{text}</span>
        </div>
      </div>
      <Icon name="chevron_right" size={20} className="text-secondary group-hover:text-primary shrink-0" />
    </Link>
  )
}
