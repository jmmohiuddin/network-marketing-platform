'use client'

import Link from 'next/link'
import { Button } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { Checkbox } from '../../components/form-field'
import { StatusBadge } from '../../components/status-badge'
import type { Market } from '../../lib/markets'
import { shortId } from '../admin/format'
import { tableError, usePagedList } from '../admin/resource'
import { LinesTable } from './lines-tab'
import { exceptionText, marketMoney, originLabel, periodText, signedMoney } from './format'
import type { RunReview, TransitionRow } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
const CARD = 'bg-surface-container-lowest p-space-md rounded-lg shadow-sm flex flex-col gap-space-sm'
const HEADING = 'font-section-heading text-section-heading text-on-surface font-bold'

interface TabProps {
  readonly review: RunReview
  readonly market: Market | undefined
  readonly zone: string | undefined
}

/** "Previous (<period>)": the comparison column names the period compared with, in the calendar's zone. */
const priorHeader = (review: RunReview, zone: string | undefined) => (review.comparison === null ? 'Previous' : `Previous (${periodText(review.comparison.period, zone)})`)

/** Variance by bonus against the comparison run (D-B3-11). */
export function VarianceTab({ review, market, zone }: TabProps) {
  const money = (minor: string) => marketMoney(minor, market)
  return (
    <section className={CARD} aria-labelledby="variance-title">
      <h2 id="variance-title" className={HEADING}>Variance by bonus</h2>
      {review.comparison === null && <p className="font-body-sm text-body-sm text-secondary">No committed previous period to compare with: previous amounts are zero.</p>}
      <DataTable
        bare
        caption="Variance by bonus"
        columns={[
          { key: 'rule', header: 'Bonus', cell: (row) => <span className="flex flex-col"><span className={`${MONO} font-semibold`}>{row.rule_key}</span><span className="font-caption text-caption text-secondary">{row.kind}</span></span> },
          { key: 'pass', header: 'Pass', align: 'end', cell: (row) => row.pass },
          { key: 'previous', header: priorHeader(review, zone), align: 'end', cell: (row) => money(row.previous_minor) },
          { key: 'current', header: 'Current', align: 'end', cell: (row) => <span className="font-semibold">{money(row.current_minor)}</span> },
          { key: 'delta', header: 'Change', align: 'end', cell: (row) => signedMoney(row.delta_minor, market) },
        ]}
        rows={review.variance}
        rowKey={(row) => row.rule_key}
        empty={{ title: 'This run has no lines' }}
      />
    </section>
  )
}

/** The 20 payees whose total moved most; each opens their lines. */
export function MoversTab({ review, market, zone, onLines }: TabProps & { readonly onLines: (participantId: string) => void }) {
  return (
    <section className={CARD} aria-labelledby="movers-title">
      <h2 id="movers-title" className={HEADING}>Top movers ({review.movers.length})</h2>
      <DataTable
        bare
        caption="Top movers"
        columns={[
          { key: 'payee', header: 'Payee', cell: (row) => <Link className="text-primary font-semibold hover:underline" href={`/people/${row.participant.id}`}>{row.participant.external_ref}{row.participant.display_name === null ? '' : ` · ${row.participant.display_name}`}</Link> },
          { key: 'previous', header: priorHeader(review, zone), align: 'end', cell: (row) => marketMoney(row.previous_minor, market) },
          { key: 'current', header: 'Current', align: 'end', cell: (row) => marketMoney(row.current_minor, market) },
          { key: 'delta', header: 'Change', align: 'end', cell: (row) => <span className="font-semibold">{signedMoney(row.delta_minor, market)}</span> },
          { key: 'lines', header: 'Lines', cell: (row) => <Button size="sm" aria-label={`Show lines of ${row.participant.external_ref}`} onClick={() => onLines(row.participant.id)}>Show lines</Button> },
        ]}
        rows={review.movers}
        rowKey={(row) => row.participant.id}
        empty={{ title: 'No payee in this run or the previous one' }}
      />
    </section>
  )
}

/** Exceptions with stable ids; each blocking one needs an acknowledgement before the commit (FR-COMP-005). */
export function ExceptionsTab({ review, acknowledged, onAcknowledge }: { readonly review: RunReview; readonly acknowledged: ReadonlySet<string>; readonly onAcknowledge: ((id: string, on: boolean) => void) | null }) {
  const blocking = review.exceptions.filter((exception) => exception.blocking)
  return (
    <section className={CARD} aria-labelledby="exceptions-title">
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 id="exceptions-title" className={HEADING}>Exceptions ({review.exceptions.length})</h2>
        <span className="px-2.5 py-0.5 rounded bg-surface-container text-on-surface-variant font-caption text-caption font-semibold">
          {blocking.filter((exception) => acknowledged.has(exception.id)).length} of {blocking.length} blocking acknowledged
        </span>
      </div>
      {review.exceptions.length === 0 ? <p className="font-body-sm text-body-sm text-secondary">No exception.</p> : (
        <ul className="flex flex-col gap-space-xs">
          {review.exceptions.map((exception) => (
            <li key={exception.id} className={`p-space-sm rounded flex items-start justify-between gap-space-sm ${exception.blocking && !acknowledged.has(exception.id) ? 'bg-error-container/20' : 'bg-surface-container-low'}`}>
              {exception.blocking && onAcknowledge !== null
                ? <Checkbox label={exceptionText(exception)} checked={acknowledged.has(exception.id)} onChange={(event) => onAcknowledge(exception.id, event.target.checked)} />
                : <span className="font-body-sm text-body-sm text-on-surface">{exceptionText(exception)}</span>}
              <StatusBadge state={exception.blocking ? 'blocked' : 'reviewed'} label={exception.blocking ? 'Blocking' : 'Information'} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Transitions({ runId }: { readonly runId: string }) {
  const list = usePagedList<TransitionRow>(`/v1/runs/${runId}/transitions`)
  return (
    <DataTable
      bare
      caption="Transition report"
      columns={[
        { key: 'payee', header: 'Position', cell: (row) => (row.participant === null ? <span className={MONO}>{shortId(row.position_id)}</span> : <Link className="text-primary font-semibold hover:underline" href={`/people/${row.participant.id}`}>{row.participant.external_ref}</Link>) },
        { key: 'changed', header: 'Changed', cell: (row) => <ul className="flex flex-col gap-0.5">{row.changed.map((change) => <li key={change.state_item} className={MONO}>{change.state_item}: {change.before} → {change.after}</li>)}</ul> },
      ]}
      rows={list.rows}
      rowKey={(row) => row.position_id}
      loading={list.loading}
      error={tableError(list)}
      empty={{ title: 'No state transition: this run is not the first under a new plan version' }}
      pagination={list.pagination}
    />
  )
}

/** What changed against the comparison run, and the pass-0 transition report (AC-27.2). */
export function ChangesTab({ review, runId }: { readonly review: RunReview; readonly runId: string }) {
  const changes = review.changes
  const inputs = Object.keys(changes.inputs.current ?? {})
  return (
    <div className="flex flex-col gap-space-md">
      <section className={CARD} aria-labelledby="changes-title">
        <h2 id="changes-title" className={HEADING}>What changed</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm font-body-sm text-body-sm">
          <div><dt className="text-secondary">Plan version</dt><dd>{changes.plan_version_changed ? `Changed (previous ${shortId(changes.previous_plan_version ?? '')})` : 'Unchanged'}</dd></div>
          <div><dt className="text-secondary">Settings version</dt><dd>{changes.settings_version_changed ? 'Changed' : 'Unchanged'}</dd></div>
          <div><dt className="text-secondary">State transitions</dt><dd>{changes.transition_changes}</dd></div>
          <div><dt className="text-secondary">Cap applications</dt><dd>{changes.cap_applications.length === 0 ? 'None' : changes.cap_applications.map((cap) => `${cap.capKey} (${cap.bound ? 'bound' : 'not bound'}, ${cap.affected.length} lines)`).join(', ')}</dd></div>
        </dl>
        {inputs.length > 0 && (
          <DataTable
            bare
            density="compact"
            caption="Input rows"
            columns={[
              { key: 'input', header: 'Input', cell: (key) => key.replace(/_/g, ' ') },
              { key: 'current', header: 'This run', align: 'end', cell: (key) => changes.inputs.current?.[key] ?? 0 },
              { key: 'previous', header: 'Compared run', align: 'end', cell: (key) => (changes.inputs.previous === null ? '—' : changes.inputs.previous[key] ?? 0) },
            ]}
            rows={inputs}
            rowKey={(key) => key}
            empty={{ title: 'No inputs' }}
          />
        )}
      </section>
      <section className={CARD} aria-labelledby="transitions-title">
        <h2 id="transitions-title" className={HEADING}>Transition report</h2>
        <Transitions runId={runId} />
      </section>
    </div>
  )
}

/** Adjustment lines by origin (late transactions, clawbacks, restatements), each with its original period. */
export function AdjustmentsTab({ review, market, runId, ruleKeys }: Omit<TabProps, 'zone'> & { readonly runId: string; readonly ruleKeys: readonly string[] }) {
  return (
    <section className={CARD} aria-labelledby="adjustments-title">
      <h2 id="adjustments-title" className={HEADING}>Adjustments</h2>
      {review.adjustments.length === 0 ? <p className="font-body-sm text-body-sm text-secondary">This run carries no adjustment.</p> : (
        <>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-sm">
            {review.adjustments.map((row) => (
              <li key={row.origin_type} className="p-space-sm rounded bg-surface-container-low flex flex-col">
                <span className="font-caption text-caption text-secondary uppercase">{originLabel(row.origin_type)} · {row.count}</span>
                <span className={`${MONO} font-semibold`}>{signedMoney(row.amount_minor, market)}</span>
              </li>
            ))}
          </ul>
          <LinesTable runId={runId} market={market} ruleKeys={ruleKeys} origins={review.adjustments.map((row) => row.origin_type)} />
        </>
      )}
    </section>
  )
}
