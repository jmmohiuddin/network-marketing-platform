'use client'

import { countLabel } from '../../lib/format'
import Link from 'next/link'
import { useState } from 'react'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { PageHeader } from '../../components/page-header'
import { EmptyState, ErrorState, LoadingState, NotAvailable } from '../../components/states'
import { StatusChip } from '../../components/status-chip'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { marketName } from '../../lib/markets'
import { Sparkline } from './charts'
import { CreateSnapshotDialog, type SnapshotRequest } from './create-snapshot-dialog'
import { changeLabel, dateTime, figureLabel, HEADLINE_KEYS, periodRange, REPORT_NAMES, SNAPSHOTS_PATH } from './format'
import { TrendChart } from './period-views'
import { FigureCard, qualityWarnings } from './snapshot-report'
import { computing } from './snapshots-list'
import type { Figure, PeriodResult, ReportCode, Snapshot, SnapshotDetail } from './types'

// shortcut: the overview reads the newest 200 snapshots; a market whose last usable snapshot is older is listed
// only in the snapshot list. Page through when a tenant keeps more.
const RECENT_LIMIT = 200

const usable = (snapshot: Snapshot) => snapshot.state === 'ready' || snapshot.state === 'outdated'

/** Per market, the newest snapshot with figures (ready, or outdated with unchanged figures); newest first. */
export function latestPerMarket(snapshots: readonly Snapshot[]): readonly Snapshot[] {
  return snapshots.filter((snapshot, index) =>
    usable(snapshot) && !snapshots.slice(0, index).some((earlier) => usable(earlier) && earlier.market_id === snapshot.market_id))
}

/** The report's latest period: its headline figure, or why that figure was not computed. */
function headlineOf(results: readonly PeriodResult[], report: ReportCode) {
  const latest = results.filter((result) => result.report === report).sort((a, b) => b.period.localeCompare(a.period))[0]
  if (latest === undefined) return null
  const key = HEADLINE_KEYS[report]
  return {
    result: latest,
    figure: latest.figures.find((figure) => figure.key === key) ?? null,
    omitted: latest.omitted.find((item) => item.key === key) ?? null,
  }
}

/** SC-46 trend sparkline (decorative) and the change since the previous period of the report, in words. */
function HeadlineTrend({ results, figure }: { readonly results: readonly PeriodResult[]; readonly figure: Figure }) {
  if (figure.value === null) return null
  const series = results
    .filter((result) => result.report === results[0]?.report && result.period_kind === 'month')
    .sort((a, b) => a.period.localeCompare(b.period))
    .flatMap((result) => {
      const value = result.figures.find((candidate) => candidate.key === figure.key)?.value
      return value == null ? [] : [{ period: result.period, value }]
    })
  const previous = series.at(-2)
  if (previous === undefined) return null
  return (
    <div className="kpi-trend">
      <Sparkline values={series.map((point) => point.value)} />
      <p>Change since {previous.period}: {changeLabel(figure.unit, figure.value, previous.value)}</p>
    </div>
  )
}

function Headline({ snapshot, report }: { readonly snapshot: SnapshotDetail; readonly report: ReportCode }) {
  const headline = headlineOf(snapshot.results, report)
  const context = `${report} ${REPORT_NAMES[report]} · ${headline?.result.period ?? 'no period'}${headline?.result.partial === true ? ' · partial year, not publishable' : ''}`
  if (headline?.figure != null) {
    const trend = <HeadlineTrend results={snapshot.results.filter((result) => result.report === report)} figure={headline.figure} />
    return <FigureCard snapshotId={snapshot.id} figure={headline.figure} context={context} trend={trend} />
  }
  const reason = headline === null ? 'No period of this report has data in the snapshot.' : (headline.omitted?.reason ?? 'Not computed.')
  return (
    <article className="figure-card" aria-label={`${context}: ${figureLabel(HEADLINE_KEYS[report])}`}>
      <p className="data-note">{context}</p>
      <h3>{figureLabel(HEADLINE_KEYS[report])}</h3>
      <p>{reason}</p>
    </article>
  )
}

/** "months 2025-01 to 2025-06 (6) · year 2025 (partial)": the periods the snapshot has figures for. */
export function coverageOf(results: readonly PeriodResult[]): string {
  const months = [...new Set(results.filter((result) => result.period_kind === 'month').map((result) => result.period))].sort()
  const years = [...new Map(results.filter((result) => result.period_kind === 'year').map((result) => [result.period, result.partial])).entries()].sort()
  const parts = [
    months.length === 0 ? null : `months ${periodRange(months[0]!, months.at(-1)!)} (${months.length})`,
    ...years.map(([year, partial]) => `year ${year}${partial ? ' (partial, not publishable)' : ''}`),
  ]
  return parts.filter((part) => part !== null).join(' · ') || 'no period with figures'
}

/** Indicators of the latest periods that were not computed, once each, with the reason (unset thresholds among them). */
function omittedOf(snapshot: SnapshotDetail): readonly string[] {
  const latest = snapshot.reports.flatMap((report) => headlineOf(snapshot.results, report)?.result ?? [])
  const lines = latest.flatMap((result) => result.omitted.map((item) => `${result.report} ${figureLabel(item.key)}: ${item.reason ?? 'no reason was recorded.'}`))
  return [...new Set(lines)]
}

interface MarketOverviewProps {
  readonly snapshotId: string
  /** Present when the user may create snapshots: opens Create snapshot for this market and range. */
  readonly onRecreate?: (request: Partial<SnapshotRequest>) => void
}

/** One market: its latest usable snapshot's headline figures, data coverage, warnings and what to do about them. */
function MarketOverview({ snapshotId, onRecreate }: MarketOverviewProps) {
  const { can } = useSession()
  const { data: snapshot, meta, error, reload } = useResource<SnapshotDetail>(`/v1/compliance/snapshots/${snapshotId}`)
  if (error !== null) return <ErrorState message={errorMessage(error)} onRetry={reload} section />
  if (snapshot === null) return <LoadingState label="Loading the latest figures" />
  const title = `${marketName(snapshot.market)} · ${periodRange(snapshot.period_from, snapshot.period_to)}`
  const warnings = qualityWarnings(snapshot.input_data_quality)
  const omitted = omittedOf(snapshot)
  const versions = snapshot.input_mapping_versions.map((version) => `v${version}`).join(', ') || '—'
  // SC-46 chart: the first monthly report's headline by month (R1 retail-customer share when computed).
  const monthly = [...snapshot.results].filter((result) => result.period_kind === 'month').sort((a, b) => a.period.localeCompare(b.period))
  const trendReport = snapshot.reports.find((report) => monthly.some((result) => result.report === report))
  const recreate = onRecreate === undefined ? undefined : (
    <Button onClick={() => onRecreate({ market: snapshot.market.code, period_from: snapshot.period_from, period_to: snapshot.period_to })}>
      Create a new snapshot
    </Button>
  )
  return (
    <section className="data-section" aria-label={title}>
      <h2>{title} {snapshot.state === 'outdated' && <StatusChip state="outdated" label="Outdated: figures unchanged, inputs changed since" />}</h2>
      <p>
        Data coverage: {countLabel(snapshot.input_batch_ids.length, 'loaded import batch', 'loaded import batches')} · {coverageOf(snapshot.results)} · mapping {versions} ·
        method {snapshot.method_version} · computed {dateTime(snapshot.created_at)}. <Link href={`/compliance/snapshots/${snapshot.id}`}>Open the full report</Link>
      </p>
      {typeof meta.notice === 'string' && <Banner tone="info">{meta.notice}</Banner>}
      {snapshot.state === 'outdated' && (
        <Banner tone="warning" title="Outdated snapshot" action={recreate}>
          An import or mapping of this market changed after the snapshot was computed. Its figures still describe the data it was computed from.
        </Banner>
      )}
      {warnings.length > 0 && (
        <Banner tone="warning" title="Data-quality warnings">
          <ul className="data-list">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </Banner>
      )}
      {omitted.length > 0 && (
        <Banner
          tone="warning"
          title="Indicators not computed"
          action={can('settings.manage') ? <LinkButton href="/settings">Open thresholds in settings</LinkButton> : undefined}
        >
          <ul className="data-list">{omitted.map((line) => <li key={line}>{line}</li>)}</ul>
          {!can('settings.manage') && <p>Thresholds are tenant settings with no default; a tenant admin sets them.</p>}
        </Banner>
      )}
      <div className="kpi-grid">
        {snapshot.reports.map((report) => <Headline key={report} snapshot={snapshot} report={report} />)}
      </div>
      {trendReport !== undefined && (
        <TrendChart results={monthly.filter((result) => result.report === trendReport)} figureKey={HEADLINE_KEYS[trendReport]} />
      )}
    </section>
  )
}

/** Data status panel: snapshots still computing, and markets whose newest snapshot failed. */
function DataStatus({ snapshots }: { readonly snapshots: readonly Snapshot[] }) {
  const running = snapshots.filter((snapshot) => snapshot.state === 'computing').length
  const newest = snapshots.filter((snapshot, index) => !snapshots.slice(0, index).some((earlier) => earlier.market_id === snapshot.market_id))
  const failed = newest.filter((snapshot) => snapshot.state === 'failed')
  return (
    <section className="data-section" aria-labelledby="data-status-title">
      <h2 id="data-status-title">Data status</h2>
      <ul className="data-list">
        <li>{running === 0 ? 'No snapshot is being computed.' : `${countLabel(running, 'snapshot')} ${running === 1 ? 'is' : 'are'} being computed. This page updates every few seconds.`}</li>
        {failed.map((snapshot) => (
          <li key={snapshot.id}>
            The newest snapshot of {marketName(snapshot.market)} ({periodRange(snapshot.period_from, snapshot.period_to)}) failed: {snapshot.failure_reason ?? 'no reason was recorded'}.
          </li>
        ))}
      </ul>
    </section>
  )
}

/** SC-46 Compliance overview, the MVP-A landing: the latest R1-R5 headline figures per market, coverage, warnings. */
export function ComplianceOverview() {
  const { can, readOnly } = useSession()
  const { data, error, loading, reload } = useResource<Snapshot[]>('/v1/compliance/snapshots', { limit: RECENT_LIMIT }, computing)
  // The dialog mounts per opening, so a "Create a new snapshot" for a market starts filled in.
  const [creating, setCreating] = useState<Partial<SnapshotRequest> | null>(null)
  if (error !== null && isNotAvailable(error)) return <NotAvailable />

  const mayCreate = !readOnly && can('snapshot.create')
  const imports = can('import.manage') ? <LinkButton href="/imports">Open imports</LinkButton> : undefined
  const snapshots = data ?? []
  const latest = latestPerMarket(snapshots)
  return (
    <>
      <PageHeader
        title="Compliance overview"
        summary="The latest indicator figures of each market, from its newest snapshot. Figures describe past periods only."
        actions={<><LinkButton href={SNAPSHOTS_PATH}>Open reports</LinkButton>{imports}{mayCreate && <Button variant="primary" onClick={() => setCreating({})}>Create snapshot</Button>}</>}
      />
      {error !== null && <ErrorState message={errorMessage(error)} onRetry={reload} section />}
      {loading && <LoadingState label="Loading the latest snapshots" />}
      {data !== null && snapshots.length === 0 && (
        <EmptyState
          title="No snapshot yet. Upload an export to begin; once its imports are loaded, create a snapshot."
          action={imports}
        />
      )}
      {data !== null && snapshots.length > 0 && latest.length === 0 && <p>No snapshot has figures yet.</p>}
      {latest.map((snapshot) => <MarketOverview key={snapshot.id} snapshotId={snapshot.id} onRecreate={mayCreate ? setCreating : undefined} />)}
      {data !== null && snapshots.length > 0 && <DataStatus snapshots={snapshots} />}
      {mayCreate && creating !== null && <CreateSnapshotDialog open initial={creating} onClose={() => setCreating(null)} />}
    </>
  )
}
