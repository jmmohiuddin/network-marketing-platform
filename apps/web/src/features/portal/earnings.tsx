import Link from 'next/link'
import { LinkButton } from '../../components/button'
import { Icon } from '../../components/icon'
import { EmptyState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { ApiError } from '../../lib/api'
import { CAPTION, Failure, LINK_CARD, LIST_TITLE, MoreLink, PAGE_TITLE, Section, SHOW_FIRST } from './blocks'
import { disputeBadge, payoutState, type L10n } from './format'
import { portalSession, serverList, settle, shownCount } from './i18n/server'
import type { Dispute, StatementSummary } from './types'

// SC-18 list, server-rendered (D-BM-12): committed statements only, newest first (GET /v1/me/statements), and the
// participant's disputes with their state and the company's explanation (GET /v1/me/disputes). "Show more" is a link
// (?statements=14, ?disputes=14) that works without scripts.

export interface EarningsQuery {
  readonly statements?: string | string[]
  readonly disputes?: string | string[]
}

const rowsOf = <R,>(data: readonly R[]): readonly R[] => data

export async function EarningsPage({ query }: { readonly query: EarningsQuery }) {
  const session = await portalSession()
  if (session instanceof ApiError) return null
  const { words } = session
  const { t } = words
  const shown = { statements: shownCount(query.statements, SHOW_FIRST), disputes: shownCount(query.disputes, SHOW_FIRST) }
  const [statements, disputes] = await Promise.all([
    settle(serverList<StatementSummary[], StatementSummary>('/v1/me/statements', {}, shown.statements, rowsOf)),
    settle(serverList<Dispute[], Dispute>('/v1/me/disputes', {}, shown.disputes, rowsOf)),
  ])
  const more = (name: keyof typeof shown) => `/portal/earnings?${new URLSearchParams({ statements: String(shown.statements), disputes: String(shown.disputes), [name]: String(shown[name] + SHOW_FIRST) })}`
  return (
    <>
      <h1 className={PAGE_TITLE}>{t('nav.earnings')}</h1>
      <section aria-labelledby="statements-title" className="flex flex-col gap-space-xs">
        <h2 id="statements-title" className={LIST_TITLE}>{t('earnings.statements')}</h2>
        {statements instanceof ApiError && <Failure error={statements} t={t} section retry={<LinkButton href="/portal/earnings">{t('common.try_again')}</LinkButton>} />}
        {!(statements instanceof ApiError) && statements.rows.length === 0 && <EmptyState title={t('home.no_statement')}>{t('earnings.empty')}</EmptyState>}
        {!(statements instanceof ApiError) && statements.rows.length > 0 && (
          <ul className="flex flex-col gap-space-xs" data-testid="card">
            {statements.rows.map((row) => <StatementLink key={row.run_id} row={row} words={words} />)}
          </ul>
        )}
        {!(statements instanceof ApiError) && statements.more && <MoreLink href={more('statements')} label={t('earnings.more_statements')} t={t} />}
      </section>
      {disputes instanceof ApiError
        ? <Section id="disputes" title={t('earnings.disputes')} icon="flag"><Failure error={disputes} t={t} section retry={<LinkButton href="/portal/earnings">{t('common.try_again')}</LinkButton>} /></Section>
        : disputes.rows.length > 0 && (
          <Section id="disputes" title={t('earnings.disputes')} icon="flag">
            <ul className="flex flex-col gap-space-xs">
              {disputes.rows.map((dispute) => <DisputeItem key={dispute.case_id} dispute={dispute} words={words} />)}
            </ul>
            {disputes.more && <MoreLink href={`${more('disputes')}#disputes`} label={t('earnings.more_disputes')} t={t} />}
          </Section>
        )}
    </>
  )
}

function StatementLink({ row, words }: { readonly row: StatementSummary; readonly words: L10n }) {
  const payout = payoutState(row.payout_state, row.net_minor, words.t)
  return (
    <li>
      <Link href={`/portal/earnings/${row.run_id}`} className={LINK_CARD}>
        <div className="flex flex-col min-w-0 gap-0.5">
          <span className="font-section-heading text-section-heading text-on-surface">{words.period(row.period.starts_at, row.period.ends_at)}</span>
          <span className="font-data-mono-md text-data-mono-md text-on-surface">{words.t('earnings.net', { amount: words.money(row.net_minor ?? '0', row.market) })}</span>
          <span className="flex flex-wrap items-center gap-space-xs"><StatusBadge state={payout.state} label={payout.label} /></span>
        </div>
        <Icon name="chevron_right" size={20} className="text-secondary shrink-0" />
      </Link>
    </li>
  )
}

function DisputeItem({ dispute, words }: { readonly dispute: Dispute; readonly words: L10n }) {
  const { t } = words
  const badge = disputeBadge(dispute.state, t)
  return (
    <li className="p-space-sm rounded-lg bg-surface-container-low flex flex-col gap-1">
      <div className="flex items-center justify-between gap-space-sm flex-wrap">
        <span className="font-body-lg text-body-lg font-medium text-on-surface">{words.period(dispute.period.starts_at, dispute.period.ends_at)}</span>
        <StatusBadge state={badge.state} label={badge.label} />
      </div>
      <span className={CAPTION}>
        {[
          t('earnings.opened', { at: words.time(dispute.opened_at) }),
          dispute.due_at === null ? t('earnings.no_response_time') : t('earnings.answer_due', { at: words.time(dispute.due_at) }),
          ...(dispute.overdue ? [t('earnings.answer_overdue')] : []),
        ].join(' · ')}
      </span>
      {dispute.explanation !== null && <p className="font-body-lg text-body-lg text-on-surface-variant">{dispute.explanation}</p>}
      <Link href={`/portal/earnings/${dispute.run_id}/lines/${dispute.line_id}`} className="inline-flex items-center gap-0.5 min-h-11 font-body-sm text-body-sm text-primary font-semibold hover:underline">
        {t('earnings.open_line')} <Icon name="chevron_right" size={14} />
      </Link>
    </li>
  )
}
