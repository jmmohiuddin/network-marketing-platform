'use client'

import Link from 'next/link'
import { DataTable } from '../../components/data-table'
import { KpiCard } from '../../components/kpi-card'
import { LoadingState } from '../../components/states'
import { useCursorPages } from '../../lib/cursor-pages'
import { countLabel } from '../../lib/format'
import type { Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { marketAmount, marketMoney, periodText, signedMoney } from './format'
import type { CreditAward, TrueUp } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
const CARD = 'bg-surface-container-lowest p-space-md rounded-lg shadow-sm flex flex-col gap-space-sm'
const HEADING = 'font-section-heading text-section-heading text-on-surface font-bold'
const NOTE = 'font-body-sm text-body-sm text-secondary'
const LINK = 'text-primary font-semibold hover:underline'

interface TabProps {
  readonly runId: string
  readonly market: Market | undefined
  /** The calendar's cut-off zone, for period names. */
  readonly zone: string | undefined
}

/**
 * SC-02 True-up tab of a final run (D-V1A-02, GET /v1/runs/:id/true-up): per payee the final amount, the advances the
 * provisional runs paid and the difference this run pays (negative when the advances were higher).
 */
export function TrueUpTab({ runId, market, zone }: TabProps) {
  const pages = useCursorPages()
  const trueUp = useResource<TrueUp>(`/v1/runs/${runId}/true-up`, { cursor: pages.cursor })
  if (trueUp.error !== null) return <LoadFailure error={trueUp.error} onRetry={trueUp.reload} section />
  if (trueUp.data === null) return <LoadingState label="Loading the true-up" />
  const { totals, provisional_runs: runs, payees } = trueUp.data
  const nextCursor = typeof trueUp.meta.next_cursor === 'string' ? trueUp.meta.next_cursor : null
  const amount = (minor: string) => marketAmount(minor, market)
  const currency = market === undefined ? '' : ` (${market.currency})`
  return (
    <section className={CARD} aria-labelledby="true-up-title">
      <h2 id="true-up-title" className={HEADING}>True-up</h2>
      <p className={NOTE}>
        This final run trues up {countLabel(runs.length, 'provisional run')}: each payee receives the final amount less the advances already paid,
        so the run pays {signedMoney(totals.true_up_minor, market)} in all.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-md" data-testid="true-up-kpis">
        <KpiCard label="Final" icon="functions" value={marketMoney(totals.final_minor, market)} detail="What the period earns under the final rules" />
        <KpiCard label="Advances paid" icon="event_repeat" value={marketMoney(totals.provisional_minor, market)} detail={`By ${countLabel(runs.length, 'provisional run')}`} />
        <KpiCard label="True-up" icon="balance" value={signedMoney(totals.true_up_minor, market)} detail="Final less advances: this run's gross" />
      </div>
      <ul className="flex flex-col gap-0.5">
        {runs.map((run) => (
          <li key={run.run_id} className="font-caption text-caption text-secondary">
            Advance {periodText(run, zone)}: {marketMoney(run.gross_minor, market)} · <span className={MONO}>{shortId(run.run_id)}</span>
          </li>
        ))}
      </ul>
      <DataTable
        bare
        stackOnPhone
        caption="True-up by payee"
        columns={[
          { key: 'payee', header: 'Payee', cell: (row) => <Link className={LINK} href={`/people/${row.participant.id}`}>{row.participant.external_ref}</Link> },
          { key: 'final', header: `Final${currency}`, align: 'end', cell: (row) => amount(row.final_minor) },
          { key: 'advances', header: `Advances paid${currency}`, align: 'end', cell: (row) => amount(row.provisional_minor) },
          { key: 'true-up', header: `True-up${currency}`, align: 'end', cell: (row) => <span className="font-semibold">{amount(row.true_up_minor)}</span> },
        ]}
        rows={payees}
        rowKey={(row) => row.participant.id}
        empty={{ title: 'No payee in this run' }}
        pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor) }}
      />
    </section>
  )
}

/** SC-02 Credit awards tab (D-V1A-03, GET /v1/runs/:id/credit-awards): rewards settled in kind, never paid in cash. */
export function CreditAwardsTab({ runId, market }: Omit<TabProps, 'zone'>) {
  const list = usePagedList<CreditAward>(`/v1/runs/${runId}/credit-awards`)
  const totals = (list.meta.totals as readonly { credit_type: { code: string; name: string }; amount_minor: string }[] | undefined) ?? []
  return (
    <section className={CARD} aria-labelledby="credit-awards-title">
      <h2 id="credit-awards-title" className={HEADING}>Credit awards</h2>
      <p className={NOTE}>
        {list.loading ? 'Loading the credit totals' : totals.length === 0 ? 'No credits awarded.' : `Awarded as credits, not paid in cash: ${totals.map((row) => `${marketMoney(row.amount_minor, market)} in ${row.credit_type.name}`).join(', ')}. The expiry counts from the commit.`}
      </p>
      <DataTable
        bare
        stackOnPhone
        caption="Credit awards"
        columns={[
          { key: 'payee', header: 'Payee', cell: (row) => <span className="flex flex-col"><Link className={LINK} href={`/people/${row.participant.id}`}>{row.participant.external_ref}</Link><span className={`${MONO} text-secondary`}>{row.position_ref}</span></span> },
          { key: 'rule', header: 'Rule', cell: (row) => <span className={MONO}>{row.rule_key}</span> },
          { key: 'type', header: 'Credit type', cell: (row) => `${row.credit_type.name} (${row.credit_type.code})` },
          { key: 'amount', header: `Amount${market === undefined ? '' : ` (${market.currency})`}`, align: 'end', cell: (row) => <span className="font-semibold">{marketAmount(row.amount_minor, market)}</span> },
          { key: 'expiry', header: 'Expires', cell: (row) => (row.expiry_days === null ? 'Never' : `${countLabel(row.expiry_days, 'day')} after commit`) },
          { key: 'taxable', header: 'Taxable', cell: (row) => (row.taxable ? 'Yes' : 'No') },
        ]}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={tableError(list)}
        empty={{ title: 'This run awards no credits' }}
        pagination={list.pagination}
      />
    </section>
  )
}
