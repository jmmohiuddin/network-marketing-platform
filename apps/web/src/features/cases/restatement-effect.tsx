'use client'

import Link from 'next/link'
import { DataTable } from '../../components/data-table'
import { StatusBadge } from '../../components/status-badge'
import { MARKETS_PATH, type Market } from '../../lib/markets'
import { useResource } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { tableError, usePagedList } from '../admin/resource'
import { marketMoney, reviewPath, signedMoney } from '../periods/format'
import type { RunDetail } from '../periods/types'
import { ParticipantLink, PositionLink } from './refs'
import type { CaseRecord } from './types'

const LABEL = 'font-caption text-caption uppercase text-secondary font-semibold'
const MONO = 'font-data-mono-sm text-data-mono-sm'

/** effect_preview of a restatement case (stored at submit, PLAN B3 §2.5). */
export interface RestatementPreview {
  readonly restatement_id: string
  readonly period: { readonly id: string; readonly starts_at: string; readonly ends_at: string }
  readonly diff_total_minor: string
  readonly by_rule: readonly { readonly rule_key: string; readonly diff_minor: string }[]
  readonly payees: number
  readonly empty: boolean
}

/** GET /v1/restatements/:id. */
interface Restatement {
  readonly state: string
  readonly applied_in_run_id: string | null
}

/** GET /v1/restatements/:id/lines rows. */
interface DiffLine {
  readonly payee_position_id: string
  readonly payee_participant_id: string
  readonly rule_key: string
  readonly committed_minor: string
  readonly applied_adjustments_minor: string
  readonly restated_minor: string
  readonly diff_minor: string
}

/** The run that paid the restatement, linked to its review (SC-02) once its period is known. */
function AppliedRun({ runId }: { readonly runId: string }) {
  const run = useResource<RunDetail>(`/v1/runs/${runId}`)
  const text = `run ${shortId(runId)}`
  return (
    <p className="font-body-sm text-body-sm text-on-surface">
      Applied in {run.data === null ? <span className={MONO}>{text}</span> : <Link className={`${MONO} text-primary font-semibold hover:underline`} href={reviewPath(run.data.period_id, runId)}>{text}</Link>}
    </p>
  )
}

/**
 * Diff of the restated period (sandbox − committed − adjustments already consumed): total, by bonus, and per payee
 * from GET /v1/restatements/:id/lines; the run that applied it once applied.
 * shortcut: one GET per payee row for names (diff lines carry ids only); add payee refs to the lines route to drop it.
 */
export function RestatementEffect({ record, preview }: { readonly record: CaseRecord; readonly preview: RestatementPreview }) {
  const markets = useResource<Market[]>(MARKETS_PATH)
  const market = markets.data?.find((candidate) => candidate.id === record.market_id)
  const restatement = useResource<Restatement>(`/v1/restatements/${preview.restatement_id}`)
  const lines = usePagedList<DiffLine>(`/v1/restatements/${preview.restatement_id}/lines`)
  const money = (minor: string) => marketMoney(minor, market)
  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-space-sm">
        <div className="flex flex-col">
          <span className={LABEL}>Difference to pay</span>
          <span className="font-data-mono-lg text-data-mono-lg text-on-surface font-bold" data-testid="diff-total">{signedMoney(preview.diff_total_minor, market)}</span>
        </div>
        {restatement.data !== null && <StatusBadge state={restatement.data.state} />}
      </div>
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        {preview.empty ? 'No payee changes: approval closes the case with no adjustment.' : `${preview.payees} ${preview.payees === 1 ? 'payee changes' : 'payees change'}, net of adjustments already paid for this period.`}
      </p>
      {preview.by_rule.length > 0 && (
        <dl className="flex flex-col gap-1" aria-label="Difference by bonus">
          {preview.by_rule.map((rule) => (
            <div key={rule.rule_key} className="flex justify-between gap-space-sm p-2 rounded bg-surface-container-low">
              <dt className={MONO}>{rule.rule_key}</dt>
              <dd className={`${MONO} font-semibold`}>{signedMoney(rule.diff_minor, market)}</dd>
            </div>
          ))}
        </dl>
      )}
      {restatement.data?.applied_in_run_id != null && <AppliedRun runId={restatement.data.applied_in_run_id} />}
      <DataTable
        bare
        density="compact"
        caption="Restated payees"
        columns={[
          { key: 'payee', header: 'Payee', cell: (row) => <div className="flex flex-col"><ParticipantLink id={row.payee_participant_id} /><PositionLink id={row.payee_position_id} withOwner={false} /></div> },
          { key: 'rule', header: 'Bonus', cell: (row) => <span className={MONO}>{row.rule_key}</span> },
          { key: 'committed', header: 'Committed', align: 'end', cell: (row) => money(row.committed_minor) },
          { key: 'applied', header: 'Adjusted since', align: 'end', cell: (row) => money(row.applied_adjustments_minor) },
          { key: 'restated', header: 'Restated', align: 'end', cell: (row) => money(row.restated_minor) },
          { key: 'diff', header: 'Difference', align: 'end', cell: (row) => <span className="font-semibold">{signedMoney(row.diff_minor, market)}</span> },
        ]}
        rows={lines.rows}
        rowKey={(row) => `${row.payee_position_id}|${row.rule_key}`}
        loading={lines.loading}
        error={tableError(lines)}
        empty={{ title: 'No payee lines' }}
        pagination={lines.pagination}
      />
    </div>
  )
}
