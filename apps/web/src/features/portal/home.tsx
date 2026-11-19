'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { LinkButton } from '../../components/button'
import { Icon } from '../../components/icon'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { useResource } from '../../lib/use-resource'
import { marketMoney, periodName } from '../periods/format'
import { noticeView, paidAsText, payoutState, timeText } from './format'
import { usePortal } from './shell'
import type { BankDetails, Notice, Statement, StatementSummary } from './types'
import { CAPTION, CARD, ClosedNotice, LINK_CARD, MONO, PAGE_TITLE, PortalFailure, SECTION_TITLE, SHOW_FIRST, TEXT_LINK } from './ui'

// SC-37 distributor home (sc_37): identity strip, the latest committed statement's net as the largest element with its
// payout state, alerts, module links. No activity snapshot, targets, leg counts or repeat rates (BR-HON-01, UI_UX §4.4).

const ALERT_TEMPLATES = new Set(['dispute.updated', 'plan.change_scheduled'])
const ALERT_PAGE = 50

export function PortalHome() {
  const { me, profile, zone } = usePortal()
  const latest = useResource<StatementSummary[]>('/v1/me/statements', { limit: 1 })
  const runId = latest.data?.[0]?.run_id ?? null
  const statement = useResource<Statement>(runId === null ? null : `/v1/me/statements/${runId}`)
  const position = profile.positions[0]
  // The rank of the position named in the strip, not of whichever position the statement lists first.
  const paidAs = statement.data?.positions.find((row) => row.position_id === position?.id)?.paid_as ?? []
  const team = me.navigation.some((entry) => entry.key === 'team')
  return (
    <>
      <section aria-labelledby="home-title" className={`${CARD} flex flex-col`}>
        <div className="flex items-start justify-between gap-space-sm">
          <div className="flex flex-col min-w-0">
            <div className={`flex items-center gap-space-xs flex-wrap ${CAPTION}`}>
              {position !== undefined && <span className={MONO}>{position.position_ref}</span>}
              {position !== undefined && <span className="text-outline" aria-hidden="true">•</span>}
              <span className="font-medium">{profile.market.code} · {profile.market.currency}</span>
            </div>
            <h1 id="home-title" className={`${PAGE_TITLE} mt-0.5 truncate`}>Welcome back, {profile.display_name ?? me.user.display_name ?? me.user.email}</h1>
          </div>
          {paidAs.length > 0 && (
            <span className="flex items-center gap-1.5 px-space-xs py-1 rounded bg-surface-container-high text-primary font-section-heading text-caption shrink-0">
              <Icon name="military_tech" size={16} filled />
              <span>{paidAsText(paidAs)}</span>
            </span>
          )}
        </div>
      </section>
      {profile.terminated && <ClosedNotice />}
      <LatestStatement summary={latest.data?.[0] ?? null} loading={latest.loading} error={latest.error} onRetry={latest.reload} zone={zone} />
      <Alerts zone={zone} />
      {!profile.terminated && (
        <nav aria-label="Your records" className="flex flex-col gap-space-xs">
          <ModuleLink href="/portal/rank" icon="military_tech" title="Rank" text="Your paid-as rank and titles per committed period, and what your rank requires." />
          {team
            ? <ModuleLink href="/portal/team" icon="account_tree" title="Team" text="The positions you sponsor, as the company’s visibility policy allows." />
            : <ModuleLink href="/portal/customers" icon="group" title="Customers" text="The customers you service and their last orders." />}
        </nav>
      )}
    </>
  )
}

function LatestStatement({ summary, loading, error, onRetry, zone }: {
  readonly summary: StatementSummary | null
  readonly loading: boolean
  readonly error: unknown
  readonly onRetry: () => void
  readonly zone: string
}) {
  if (error !== null) return <PortalFailure error={error} onRetry={onRetry} section />
  if (loading) return <LoadingState label="Loading your latest statement" />
  if (summary === null) return <EmptyState title="No statement yet">Your first statement appears here once a period is committed.</EmptyState>
  const payout = payoutState(summary.payout_state, summary.net_minor)
  return (
    <section aria-labelledby="latest-title" data-testid="card" className={`${CARD} flex flex-col`}>
      <div className="flex items-center justify-between gap-space-sm flex-wrap">
        <h2 id="latest-title" className="text-caption font-caption uppercase tracking-wider text-secondary font-semibold">Net amount · {periodName(summary.period.starts_at, summary.period.ends_at, zone)}</h2>
        <StatusBadge state={payout.state} label={payout.label} />
      </div>
      <p className="mt-space-sm text-display font-display text-on-surface tracking-tight font-bold break-words">{marketMoney(summary.net_minor ?? '0', summary.market)}</p>
      <p className={`${CAPTION} mt-0.5`}>Committed on {timeText(summary.committed_at, zone)}</p>
      <div className="mt-space-md">
        <LinkButton href={`/portal/earnings/${summary.run_id}`} variant="primary" size="lg" className="w-full" data-testid="primary-action">Open statement</LinkButton>
      </div>
    </section>
  )
}

/** Cooling-off of new bank details, and unread dispute and plan-change notices. */
function Alerts({ zone }: { readonly zone: string }) {
  const bank = useResource<BankDetails>('/v1/me/bank-details')
  const notices = useResource<Notice[]>('/v1/me/notifications', { unread: true, limit: ALERT_PAGE })
  const coolingOff = bank.data?.current?.cooling_off_until ?? null
  const waiting = coolingOff !== null && new Date(coolingOff).getTime() > Date.now()
  const alerts = (notices.data ?? []).filter((notice) => ALERT_TEMPLATES.has(notice.template))
  const items = [
    ...(waiting
      ? [
        <Alert key="cooling-off" title="New bank details in their waiting period" href="/portal/more/payment-details" linkLabel="Open payment details">
          Payouts to account {bank.data?.current?.masked} start after {timeText(coolingOff, zone)}.
        </Alert>,
      ]
      : []),
    ...alerts.map((notice) => {
      const view = noticeView(notice, zone)
      return <Alert key={notice.id} title={view.title} href={view.href} linkLabel={view.linkLabel}>{view.text}</Alert>
    }),
  ]
  if (items.length === 0) return null
  return (
    <section aria-labelledby="alerts-title" className="flex flex-col gap-space-xs">
      <h2 id="alerts-title" className="px-space-xs text-caption font-caption uppercase tracking-wider text-secondary font-semibold">Notices</h2>
      {items.slice(0, SHOW_FIRST)}
      {items.length > SHOW_FIRST && <Link href="/portal/more/notifications" className={`${TEXT_LINK} px-space-xs`}>See all in your inbox <Icon name="chevron_right" size={14} /></Link>}
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
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-1">{children}</p>
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
