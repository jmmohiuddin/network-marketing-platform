'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Icon } from '../../components/icon'
import { EmptyState, LoadingState } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { marketMoney, periodName } from '../periods/format'
import { DISPUTE_STATE, payoutState, timeText } from './format'
import { usePortal } from './shell'
import type { Dispute, StatementSummary } from './types'
import { CAPTION, LINK_CARD, PAGE_TITLE, PortalFailure, Section, SHOW_FIRST, ShowMore, useShownList } from './ui'

// SC-18 list: committed statements only, newest first (GET /v1/me/statements), and the participant's disputes with
// their state and the company's explanation (GET /v1/me/disputes).

export function EarningsPage() {
  const { zone } = usePortal()
  const list = useShownList<StatementSummary[]>('/v1/me/statements', {}, SHOW_FIRST)
  return (
    <>
      <h1 className={PAGE_TITLE}>Earnings</h1>
      <section aria-labelledby="statements-title" className="flex flex-col gap-space-xs">
        <h2 id="statements-title" className="px-space-xs text-caption font-caption uppercase tracking-wider text-secondary font-semibold">Statements</h2>
        {list.first.error !== null && <PortalFailure error={list.first.error} onRetry={list.first.reload} section />}
        {list.first.loading && <LoadingState label="Loading your statements" />}
        {list.rows !== null && list.rows.length === 0 && <EmptyState title="No statement yet">Statements appear here once a period is committed.</EmptyState>}
        {list.rows !== null && list.rows.length > 0 && (
          <ul className="flex flex-col gap-space-xs" data-testid="card">
            {list.rows.map((row) => {
              const payout = payoutState(row.payout_state, row.net_minor)
              return (
                <li key={row.run_id}>
                  <Link href={`/portal/earnings/${row.run_id}`} className={LINK_CARD}>
                    <div className="flex flex-col min-w-0 gap-0.5">
                      <span className="font-section-heading text-section-heading text-on-surface">{periodName(row.period.starts_at, row.period.ends_at, zone)}</span>
                      <span className="font-data-mono-md text-data-mono-md text-on-surface">Net {marketMoney(row.net_minor ?? '0', row.market)}</span>
                      <span className="flex flex-wrap items-center gap-space-xs"><StatusBadge state={payout.state} label={payout.label} /></span>
                    </div>
                    <Icon name="chevron_right" size={20} className="text-secondary shrink-0" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        <ShowMore list={list} label="statements" />
      </section>
      <Disputes zone={zone} statementsIn={list.rows !== null || list.first.error !== null} />
    </>
  )
}

function Disputes({ zone, statementsIn }: { readonly zone: string; readonly statementsIn: boolean }) {
  const list = useShownList<Dispute[]>('/v1/me/disputes', {}, SHOW_FIRST)
  const settled = statementsIn && list.rows !== null
  // The inbox links to #disputes: scroll there once both lists are in, as the browser's own jump came before they loaded.
  useEffect(() => {
    if (settled && window.location.hash === '#disputes') document.getElementById('disputes')?.scrollIntoView()
  }, [settled])
  if (list.rows !== null && list.rows.length === 0) return null
  return (
    <Section id="disputes" title="Your disputes" icon="flag">
      {list.first.error !== null && <PortalFailure error={list.first.error} onRetry={list.first.reload} section />}
      {list.first.loading && <LoadingState label="Loading your disputes" />}
      {list.rows !== null && (
        <ul className="flex flex-col gap-space-xs">
          {list.rows.map((dispute) => (
            <li key={dispute.case_id} className="p-space-sm rounded-lg bg-surface-container-low flex flex-col gap-1">
              <div className="flex items-center justify-between gap-space-sm flex-wrap">
                <span className="font-body-lg text-body-lg font-medium text-on-surface">{periodName(dispute.period.starts_at, dispute.period.ends_at, zone)}</span>
                <StatusBadge state={DISPUTE_STATE[dispute.state].state} label={DISPUTE_STATE[dispute.state].label} />
              </div>
              <span className={CAPTION}>
                Opened {timeText(dispute.opened_at, zone)}
                {dispute.due_at === null ? ' · no response time set' : ` · answer due by ${timeText(dispute.due_at, zone)}`}
                {dispute.overdue ? ' · answer overdue' : ''}
              </span>
              {dispute.explanation !== null && <p className="font-body-lg text-body-lg text-on-surface-variant">{dispute.explanation}</p>}
              <Link href={`/portal/earnings/${dispute.run_id}/lines/${dispute.line_id}`} className="inline-flex items-center gap-0.5 min-h-11 font-body-sm text-body-sm text-primary font-semibold hover:underline">
                Open the line <Icon name="chevron_right" size={14} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ShowMore list={list} label="disputes" />
    </Section>
  )
}
