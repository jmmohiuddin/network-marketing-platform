'use client'

import { countLabel } from '../../lib/format'
import Link from 'next/link'
import { useState } from 'react'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { PageHeader } from '../../components/page-header'
import { EmptyState, ErrorState, LoadingState, NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { marketName } from '../../lib/markets'
import { MeterBar, Sparkline } from '../../components/charts'
import { DataTable } from '../../components/data-table'
import { Icon } from '../../components/icon'
import { CreateSnapshotDialog, type SnapshotRequest } from './create-snapshot-dialog'
import { changeLabel, dateTime, figureAmount, figureLabel, figureUnit, figureValue, HEADLINE_KEYS, integer, periodRange, REPORT_NAMES, SNAPSHOTS_PATH } from './format'
import { TrendChart } from './period-views'
import { qualityWarnings, rowsHref } from './snapshot-report'
import { computing, SNAPSHOT_COLUMNS } from './snapshots-list'
import { FactRow, FactRows, LIST, Panel, SECTION_HEADING, TableSection } from './ui'
import type { Figure, PeriodResult, ReportCode, Snapshot, SnapshotDetail } from './types'

// shortcut: the overview reads the newest 200 snapshots; a market whose last usable snapshot is older is listed
// only in the snapshot list. Page through when a tenant keeps more.
const RECENT_LIMIT = 200
/** Rows of the recent snapshots table; the snapshot list has the rest. */
const RECENT_ROWS = 10

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

/** SC-46 change since the previous period (under the value, as sc_46 l.92) and the decorative sparkline. */
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
    <>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-space-xs">
        <span className="font-data-mono-sm text-data-mono-sm text-on-surface font-semibold">{changeLabel(figure.unit, figure.value, previous.value)}</span>{' '}
        <span className="font-caption text-caption text-secondary">since {previous.period}</span>
      </p>
      <div className="mt-space-xs"><Sparkline values={series.map((point) => point.value)} /></div>
    </>
  )
}

/** sc_46 l.77 headline card: report, figure, value, change; the components strip with a share bar for percentages. */
function HeadlineCard({ snapshotId, results, figure, context, first }: {
  readonly snapshotId: string
  readonly results: readonly PeriodResult[]
  readonly figure: Figure
  readonly context: string
  readonly first: boolean
}) {
  const label = figureLabel(figure.key)
  // Bar position only; the exact value is the text above it.
  const share = figure.unit === 'percent' && figure.value !== null ? Number(figure.value) : null
  return (
    <article aria-label={`${context}: ${label}`} data-testid={first ? 'card' : undefined} className="bg-surface-container-lowest rounded p-space-md shadow-sm flex flex-col justify-between gap-space-md">
      <div className="flex flex-col">
        <span className="font-caption text-caption text-secondary uppercase font-semibold tracking-wider mb-space-xs">{context}</span>
        <h3 className="font-section-heading text-section-heading text-on-surface font-medium">{label}</h3>
        <p className="mt-space-sm flex flex-wrap items-baseline gap-x-space-xs">
          <span className="font-data-mono-lg text-data-mono-lg text-primary font-bold tabular-nums break-all">{figureAmount(figure)}</span>
          {figureUnit(figure) !== undefined && ' '}
          {figureUnit(figure) !== undefined && <span className="font-caption text-caption text-secondary">{figureUnit(figure)}</span>}
        </p>
        <HeadlineTrend results={results} figure={figure} />
      </div>
      <div className="flex flex-col gap-space-sm">
        {(figure.numerator !== null || share !== null) && (
          <div className="bg-surface-container-low rounded p-2 flex flex-col gap-1 font-caption text-caption text-secondary">
            {figure.numerator !== null && figure.denominator !== null && (
              <div className="flex justify-between gap-space-xs"><span>Numerator / denominator</span><span className="font-data-mono-sm font-semibold text-on-surface">{integer(figure.numerator)} / {integer(figure.denominator)}</span></div>
            )}
            {share !== null && <MeterBar percent={share} label={`${label} ${figureValue(figure)}`} />}
          </div>
        )}
        <Link href={rowsHref(snapshotId, figure.id)} className="text-primary font-body-sm text-body-sm font-semibold hover:underline inline-flex items-center gap-0.5">
          Open the rows behind this figure
          <Icon name="arrow_forward" size={14} />
        </Link>
      </div>
    </article>
  )
}

function Headline({ snapshot, report, first }: { readonly snapshot: SnapshotDetail; readonly report: ReportCode; readonly first: boolean }) {
  const headline = headlineOf(snapshot.results, report)
  const context = `${report} ${REPORT_NAMES[report]} · ${headline?.result.period ?? 'no period'}${headline?.result.partial === true ? ' · partial year, not publishable' : ''}`
  if (headline?.figure != null) {
    return <HeadlineCard snapshotId={snapshot.id} results={snapshot.results.filter((result) => result.report === report)} figure={headline.figure} context={context} first={first} />
  }
  const reason = headline === null ? 'No period of this report has data in the snapshot.' : (headline.omitted?.reason ?? 'Not computed.')
  return (
    <article aria-label={`${context}: ${figureLabel(HEADLINE_KEYS[report])}`} data-testid={first ? 'card' : undefined} className="bg-surface-container-lowest rounded p-space-md shadow-sm flex flex-col gap-space-xs">
      <span className="font-caption text-caption text-secondary uppercase font-semibold tracking-wider">{context}</span>
      <h3 className="font-section-heading text-section-heading text-on-surface font-medium">{figureLabel(HEADLINE_KEYS[report])}</h3>
      <span className="font-data-mono-lg text-data-mono-lg text-on-surface font-bold">—</span>
      <p className="font-body-sm text-body-sm text-on-surface-variant">{reason}</p>
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
  /** The first market's first card carries the visual-harness test id. */
  readonly first: boolean
}

/** One market: its latest usable snapshot's headline figures, data coverage, warnings and what to do about them. */
function MarketOverview({ snapshotId, onRecreate, first }: MarketOverviewProps) {
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
  const trend = trendReport === undefined ? null : <TrendChart results={monthly.filter((result) => result.report === trendReport)} figureKey={HEADLINE_KEYS[trendReport]} />
  const recreate = onRecreate === undefined ? undefined : (
    <Button onClick={() => onRecreate({ market: snapshot.market.code, period_from: snapshot.period_from, period_to: snapshot.period_to })}>
      Create a new snapshot
    </Button>
  )
  return (
    <section className="flex flex-col gap-space-md" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-space-sm">
        <h2 className={`${SECTION_HEADING} flex flex-wrap items-center gap-space-xs`}>{title} {snapshot.state === 'outdated' && <StatusBadge state="outdated" label="Outdated: figures unchanged, inputs changed since" />}</h2>
        <Link href={`/compliance/snapshots/${snapshot.id}`} className="text-primary font-body-sm text-body-sm font-medium hover:underline inline-flex items-center gap-0.5">
          Open the full report <Icon name="arrow_forward" size={14} />
        </Link>
      </div>
      {typeof meta.notice === 'string' && <Banner tone="info">{meta.notice}</Banner>}
      {snapshot.state === 'outdated' && (
        <Banner tone="warning" title="Outdated snapshot" action={recreate}>
          An import or mapping of this market changed after the snapshot was computed. Its figures still describe the data it was computed from.
        </Banner>
      )}
      {warnings.length > 0 && (
        <Banner tone="warning" title="Data-quality warnings">
          <ul className={LIST}>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </Banner>
      )}
      {omitted.length > 0 && (
        <Banner
          tone="warning"
          title="Indicators not computed"
          action={can('settings.manage') ? <LinkButton href="/settings" icon="tune">Open thresholds in settings</LinkButton> : undefined}
        >
          <ul className={LIST}>{omitted.map((line) => <li key={line}>{line}</li>)}</ul>
          {!can('settings.manage') && <p>Thresholds are tenant settings with no default; a tenant admin sets them.</p>}
        </Banner>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-space-md">
        {snapshot.reports.map((report, index) => <Headline key={report} snapshot={snapshot} report={report} first={first && index === 0} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-start">
        {trend !== null && <div className="lg:col-span-8">{trend}</div>}
        <Panel title={`Data coverage: ${snapshot.market.code}`} icon="fact_check" className={trend === null ? 'lg:col-span-12' : 'lg:col-span-4'}>
          <FactRows label="Data coverage">
            <FactRow icon="database" label="Loaded import batches" value={integer(snapshot.input_batch_ids.length)} />
            <FactRow icon="calendar_month" label="Periods with figures" detail={coverageOf(snapshot.results)} />
            <FactRow icon="route" label="Mapping versions" value={versions} />
            <FactRow icon="menu_book" label="Method version" value={snapshot.method_version} />
            <FactRow icon="schedule" label="Computed" detail={dateTime(snapshot.created_at)} />
            <FactRow icon="rule" label="Data-quality warnings" value={integer(warnings.length)} />
          </FactRows>
        </Panel>
      </div>
    </section>
  )
}

/** Data status panel: snapshots still computing, and markets whose newest snapshot failed. */
function DataStatus({ snapshots }: { readonly snapshots: readonly Snapshot[] }) {
  const running = snapshots.filter((snapshot) => snapshot.state === 'computing').length
  const newest = snapshots.filter((snapshot, index) => !snapshots.slice(0, index).some((earlier) => earlier.market_id === snapshot.market_id))
  const failed = newest.filter((snapshot) => snapshot.state === 'failed')
  return (
    <Panel title="Data status" icon="sync">
      <ul className={`${LIST} font-body-sm text-body-sm text-on-surface`}>
        <li>{running === 0 ? 'No snapshot is being computed.' : `${countLabel(running, 'snapshot')} ${running === 1 ? 'is' : 'are'} being computed. This page updates every few seconds.`}</li>
        {failed.map((snapshot) => (
          <li key={snapshot.id}>
            The newest snapshot of {marketName(snapshot.market)} ({periodRange(snapshot.period_from, snapshot.period_to)}) failed: {snapshot.failure_reason ?? 'no reason was recorded'}.
          </li>
        ))}
      </ul>
    </Panel>
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
  const imports = can('import.manage') ? <LinkButton href="/imports" icon="database">Open imports</LinkButton> : undefined
  const snapshots = data ?? []
  const latest = latestPerMarket(snapshots)
  const recent = snapshots.slice(0, RECENT_ROWS)
  return (
    <>
      <PageHeader
        title="Compliance overview"
        summary="The latest indicator figures of each market, from its newest snapshot. Figures describe past periods only."
        actions={<>
          <LinkButton href={SNAPSHOTS_PATH} icon="description">Open reports</LinkButton>
          {imports}
          {mayCreate && <Button variant="primary" icon="add_circle" onClick={() => setCreating({})} data-testid="primary-action">Create snapshot</Button>}
        </>}
      />
      {error !== null && <ErrorState message={errorMessage(error)} onRetry={reload} section />}
      {loading && <LoadingState label="Loading the latest snapshots" />}
      {data !== null && snapshots.length === 0 && (
        <EmptyState
          title="No snapshot yet. Upload an export to begin; once its imports are loaded, create a snapshot."
          action={imports}
        />
      )}
      {data !== null && snapshots.length > 0 && latest.length === 0 && <p className="font-body-sm text-body-sm text-secondary">No snapshot has figures yet.</p>}
      {latest.map((snapshot, index) => <MarketOverview key={snapshot.id} snapshotId={snapshot.id} first={index === 0} onRecreate={mayCreate ? setCreating : undefined} />)}
      {data !== null && snapshots.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-start">
          <div className="lg:col-span-8">
            <TableSection
              title="Recent snapshots"
              summary={`The newest ${countLabel(recent.length, 'snapshot')}; the snapshot list has every one.`}
              controls={<LinkButton href={SNAPSHOTS_PATH} size="sm" icon="history_edu">All snapshots</LinkButton>}
            >
              <DataTable caption={`Recent snapshots, newest first: ${recent.length} shown`} columns={SNAPSHOT_COLUMNS} rows={recent} rowKey={(snapshot) => snapshot.id} empty={{ title: 'No snapshots yet.' }} bare />
            </TableSection>
          </div>
          <div className="lg:col-span-4"><DataStatus snapshots={snapshots} /></div>
        </div>
      )}
      {mayCreate && creating !== null && <CreateSnapshotDialog open initial={creating} onClose={() => setCreating(null)} />}
    </>
  )
}
