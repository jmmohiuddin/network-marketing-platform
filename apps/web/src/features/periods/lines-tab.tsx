'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { Button } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { Drawer } from '../../components/drawer'
import { FiltersBar, type FilterChip } from '../../components/filters-bar'
import { Select } from '../../components/form-field'
import { StatusBadge } from '../../components/status-badge'
import { LoadingState } from '../../components/states'
import type { Market } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid, shortId } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { ParticipantLink, PeriodLink, PositionLink } from '../cases/refs'
import { marketMoney, ORIGIN_LABELS, originLabel } from './format'
import type { LineTrace, ResultLine } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
const BLOCK = 'p-2.5 rounded bg-surface-container-low flex flex-col gap-1.5'
const HEAD = 'font-caption text-caption uppercase tracking-wider text-secondary font-semibold'

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-space-sm">
      <dt className="text-secondary text-xs">{label}</dt>
      <dd className={`${MONO} text-right text-on-surface min-w-0 break-all`}>{children}</dd>
    </div>
  )
}

/** The line's stored compact trace, and the full trace replayed from the run's snapshot on request (FR-COMP-007). */
function TraceBody({ lineId, market }: { readonly lineId: string; readonly market: Market | undefined }) {
  const [expand, setExpand] = useState(false)
  const trace = useResource<LineTrace>(`/v1/result-lines/${lineId}/trace`, expand ? { expand: 'true' } : undefined)
  if (trace.error !== null) return <LoadFailure error={trace.error} onRetry={trace.reload} section />
  if (trace.data === null) return <LoadingState label={expand ? 'Replaying the run for the full trace' : 'Loading the trace'} />
  const { line, trace: t, explanation, expressions } = trace.data
  return (
    <>
      <dl className={BLOCK}>
        <Row label="Payee position"><PositionLink id={line.payee_position_id} withOwner={false} /></Row>
        <Row label="Bonus">{`${t.rule} (${t.kind}, pass ${t.pass})`}</Row>
        <Row label="Plan version">{shortId(t.planVersionId)}</Row>
        <Row label="Engine version">{t.engineVersion}</Row>
        <Row label="Rank as evaluated">{t.rankEvaluated.length === 0 ? '—' : t.rankEvaluated.map((r) => `${r.ladder}: ${r.rank ?? 'none'}`).join(', ')}</Row>
        <Row label="Amount">{marketMoney(line.amount_minor, market)}</Row>
      </dl>
      <section className="flex flex-col gap-1.5" aria-label="Sources">
        <h3 className={HEAD}>Sources ({t.sources.length}{t.omitted.count > 0 ? ` + ${t.omitted.count} not listed` : ''})</h3>
        <ul className="flex flex-col gap-1.5">
          {t.sources.map((source, index) => (
            <li key={`${source.positionId ?? 'market'}-${index}`} className="p-2 rounded bg-surface-container-low flex flex-col gap-0.5">
              <span className={MONO}>{source.positionId === null ? 'Market' : shortId(source.positionId)}{source.level === null ? '' : ` · level ${source.level}`}{source.measure === null ? '' : ` · ${source.measure}`}{source.rate === null ? '' : ` × ${source.rate}`}</span>
              {source.orders.length > 0 && <span className="font-caption text-caption text-secondary break-all">Orders: {source.orders.map((order) => shortId(order.orderId)).join(', ')}</span>}
            </li>
          ))}
        </ul>
      </section>
      {t.steps.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-label="Steps">
          <h3 className={HEAD}>Steps</h3>
          <ul className="flex flex-col gap-1">{t.steps.map((step, index) => <li key={index} className={MONO}>{step.step}{step.mode === undefined ? '' : ` (${step.mode})`}{step.key === undefined ? '' : ` ${step.key}`}</li>)}</ul>
        </section>
      )}
      {expressions.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-label="Expressions">
          <h3 className={HEAD}>Expressions used</h3>
          {expressions.map((e) => <pre key={e.rule_key} className={`${MONO} p-2 rounded bg-surface-container-low whitespace-pre-wrap break-all`}>{e.rule_key}: {JSON.stringify(e.expr)}</pre>)}
        </section>
      )}
      {explanation === null ? (
        <Button icon="replay" onClick={() => setExpand(true)}>Expand by replay</Button>
      ) : (
        <section className="flex flex-col gap-1.5" aria-label="Full trace" data-testid="full-trace">
          <div className="flex items-center justify-between gap-space-sm">
            <h3 className={HEAD}>Full trace (replayed)</h3>
            <StatusBadge state={explanation.reconciles ? 'healthy' : 'failed'} label={explanation.reconciles ? 'Reconciles' : 'Does not reconcile'} />
          </div>
          <ol className="flex flex-col gap-1">{explanation.lines.map((text, index) => <li key={index} className={`${MONO} p-2 rounded bg-surface-container-low break-words`}>{text}</li>)}</ol>
        </section>
      )}
    </>
  )
}

interface LinesTableProps {
  readonly runId: string
  readonly market: Market | undefined
  /** Bonus keys of the run (from the review's variance), for the bonus filter. */
  readonly ruleKeys: readonly string[]
  /** Adjustments tab: only lines with an origin; the origin filter lists only these. */
  readonly origins?: readonly string[]
}

/**
 * The run's result lines (GET /v1/runs/:id/lines) with filters in the URL (?rule, ?origin, ?payee) and the trace
 * drawer in ?line= (UI_UX §4.7).
 * shortcut: one GET per row for the payee's name (lines carry ids only); add payee refs to the lines route to drop it.
 */
export function LinesTable({ runId, market, ruleKeys, origins }: LinesTableProps) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { can } = useSession()
  const update = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }
  const originChoices = origins ?? Object.keys(ORIGIN_LABELS)
  const rule = ruleKeys.find((key) => key === params.get('rule')) ?? ''
  const origin = originChoices.find((key) => key === params.get('origin')) ?? (origins?.[0] ?? '')
  const payee = params.get('payee') ?? ''
  const requestedLine = params.get('line')
  // only a UUID reaches the API path, and only for trace readers (a crafted ?line= must not send other requests)
  const lineId = requestedLine !== null && isUuid(requestedLine) && can('trace.read') ? requestedLine : null
  const query = { rule_key: rule || undefined, origin_type: origin || undefined, payee_participant_id: payee || undefined }
  const chips: FilterChip[] = payee === '' ? [] : [{ key: 'payee', label: 'One payee', onRemove: () => update({ payee: null }) }]
  return (
    <div className="flex flex-col gap-space-sm">
      <FiltersBar label="Filter lines" chips={chips} onClear={() => update({ rule: null, origin: null, payee: null })}>
        <Select label="Bonus" value={rule} options={[{ value: '', label: 'All bonuses' }, ...ruleKeys.map((key) => ({ value: key, label: key }))]} onChange={(event) => update({ rule: event.target.value })} />
        <Select label="Origin" value={origin} options={[...(origins === undefined ? [{ value: '', label: 'All lines' }] : []), ...originChoices.map((key) => ({ value: key, label: originLabel(key) }))]} onChange={(event) => update({ origin: event.target.value })} />
      </FiltersBar>
      <Lines key={JSON.stringify(query)} runId={runId} query={query} market={market} onTrace={can('trace.read') ? (id) => update({ line: id }) : null} />
      <Drawer open={lineId !== null} onClose={() => update({ line: null })} title="Calculation trace" icon="account_tree" description={lineId === null ? undefined : `Line ${shortId(lineId)}`} width="lg">
        {lineId !== null && <TraceBody key={lineId} lineId={lineId} market={market} />}
      </Drawer>
    </div>
  )
}

/**
 * A manual adjustment line links to the adjustment cases of its payee position.
 * shortcut: result lines carry the adjustment origin id, not its case id; link the one case once lines carry case_id.
 */
function ManualCaseLink({ line }: { readonly line: ResultLine }) {
  const { can } = useSession()
  if (!can('case.adjustment.read')) return null
  return <Link className="font-caption text-caption text-primary hover:underline" href={`/cases?type=adjustment&subject_type=position&subject_id=${line.payee_position_id}`}>Adjustment case</Link>
}

function Lines({ runId, query, market, onTrace }: { readonly runId: string; readonly query: Readonly<Record<string, string | undefined>>; readonly market: Market | undefined; readonly onTrace: ((id: string) => void) | null }) {
  const list = usePagedList<ResultLine>(`/v1/runs/${runId}/lines`, query)
  return (
    <DataTable
      caption="Result lines"
      columns={[
        { key: 'payee', header: 'Payee', cell: (row) => <ParticipantLink id={row.payee_participant_id} /> },
        { key: 'rule', header: 'Bonus', cell: (row) => <span className="flex flex-col"><span className={MONO}>{row.rule_key}</span><span className="font-caption text-caption text-secondary">{row.bonus_type} · pass {row.pass}</span></span> },
        { key: 'origin', header: 'Origin', cell: (row) => <span className="flex flex-col"><span>{originLabel(row.origin_type)}</span>{row.original_period_id !== null && <span className="font-caption text-caption">for <PeriodLink id={row.original_period_id} /></span>}{row.origin_type === 'manual' && <ManualCaseLink line={row} />}</span> },
        { key: 'amount', header: `Amount${market === undefined ? '' : ` (${market.currency})`}`, align: 'end', cell: (row) => <span className={`${MONO} font-semibold`}>{marketMoney(row.amount_minor, market)}</span> },
        ...(onTrace === null ? [] : [{
          key: 'trace', header: 'Trace', cell: (row: ResultLine) => <Button size="sm" icon="account_tree" aria-label={`Trace line ${shortId(row.id)} (${row.rule_key})`} onClick={() => onTrace(row.id)}>Trace</Button>,
        }]),
      ]}
      rows={list.rows}
      rowKey={(row) => row.id}
      loading={list.loading}
      error={tableError(list)}
      empty={{ title: 'No lines match these filters' }}
      pagination={list.pagination}
    />
  )
}
