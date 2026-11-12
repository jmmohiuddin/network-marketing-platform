'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Banner } from '../../components/banner'
import { LinkButton } from '../../components/button'
import { PageHeader } from '../../components/page-header'
import { ErrorState, LoadingState, NotAvailable } from '../../components/states'
import { StatusChip } from '../../components/status-chip'
import { Table, type TableColumn } from '../../components/table'
import { TabPanel, Tabs } from '../../components/tabs'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { dateTime, figureLabel, figureValue, integer, marketLabel, periodRange, REPORT_NAMES, SNAPSHOTS_PATH } from './format'
import type { DataQuality, Figure, PeriodResult, ReportCode, SnapshotDetail } from './types'
import { useResource } from '../../lib/use-resource'

const TABS_ID = 'report'

export const rowsHref = (snapshotId: string, figureId: string) =>
  `/compliance/snapshots/${snapshotId}/rows?figure=${encodeURIComponent(figureId)}`

/** Figure card with method (UI-04): value, components, population, method and the rows behind it. */
export function FigureCard({ snapshotId, figure, context }: { readonly snapshotId: string; readonly figure: Figure; readonly context?: string }) {
  const label = figureLabel(figure.key)
  return (
    <article className="figure-card" aria-label={context === undefined ? label : `${context}: ${label}`}>
      {context !== undefined && <p className="data-note">{context}</p>}
      <h3>{label}</h3>
      <p className="figure-value">{figureValue(figure)}</p>
      {figure.note !== null && <p className="data-note">{figure.note}</p>}
      <dl className="data-facts">
        {figure.numerator !== null && <><dt>Numerator</dt><dd>{integer(figure.numerator)}</dd></>}
        {figure.denominator !== null && <><dt>Denominator</dt><dd>{integer(figure.denominator)}</dd></>}
        <dt>Population</dt>
        <dd>{figure.population ?? '—'}{figure.population_count === null ? '' : ` (${integer(figure.population_count)})`}</dd>
        <dt>Method</dt><dd>{figure.method ?? '—'}</dd>
        <dt>Method version</dt><dd>{figure.method_version ?? '—'}</dd>
      </dl>
      <Link href={rowsHref(snapshotId, figure.id)}>Open the rows behind this figure</Link>
    </article>
  )
}

/** R5 states its whole population, including those who earned nothing (AC-25.1). */
function populationSentence(result: PeriodResult): string | null {
  if (result.report !== 'R5') return null
  const count = result.figures.find((figure) => figure.key === 'count')?.value
  const nothing = result.figures.find((figure) => figure.key === 'bands.0 or less')?.value
  if (count == null) return null
  const zero = nothing == null ? '' : `, including ${integer(nothing)} whose earnings were zero or less`
  return `Population: ${integer(count)} participants of an earning type enrolled by the year end${zero}.`
}

function PeriodSection({ snapshotId, result }: { readonly snapshotId: string; readonly result: PeriodResult }) {
  const population = populationSentence(result)
  const title = `${result.report} · ${result.period}`
  return (
    <section className="data-section" aria-label={title}>
      <h2>{title} {result.partial && <StatusChip state="stale" label="Partial year, not publishable" />}</h2>
      {population !== null && <p>{population}</p>}
      {result.notes.length > 0 && <ul className="data-list" aria-label="Notes">{result.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
      <div className="figure-grid">
        {result.figures.map((figure) => <FigureCard key={figure.id} snapshotId={snapshotId} figure={figure} />)}
      </div>
      {result.omitted.length > 0 && (
        <div className="data-stack">
          <h3>Indicators not computed</h3>
          <ul className="data-list">
            {result.omitted.map((item) => <li key={item.key}>{figureLabel(item.key)}: {item.reason ?? 'No reason was recorded.'}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}

interface ComparisonRow {
  readonly key: string
  readonly byPeriod: ReadonlyMap<string, Figure>
}

/**
 * SC-10 compare periods: every figure of the report by period, side by side (the table form of its trend).
 * shortcut: no chart yet; the data-vis palette is not colour-vision checked (UI_UX O-10). Add the chart with
 * this table as its "View as table" alternative once it is.
 */
export function PeriodComparison({ results }: { readonly results: readonly PeriodResult[] }) {
  const periods = results.map((result) => result.period)
  const keys = [...new Set(results.flatMap((result) => result.figures.map((figure) => figure.key)))]
  const rows: ComparisonRow[] = keys.map((key) => ({
    key,
    byPeriod: new Map(results.flatMap((result) => result.figures.filter((figure) => figure.key === key).map((figure): [string, Figure] => [result.period, figure]))),
  }))
  const columns: TableColumn<ComparisonRow>[] = [
    { key: 'figure', header: 'Figure', cell: (row) => figureLabel(row.key) },
    ...periods.map((period): TableColumn<ComparisonRow> => ({
      key: period,
      header: period,
      align: 'end',
      cell: (row) => {
        const figure = row.byPeriod.get(period)
        return figure === undefined ? 'Not computed' : figureValue(figure)
      },
    })),
  ]
  return (
    <section className="data-section" aria-labelledby="compare-periods-title">
      <h2 id="compare-periods-title">Compare periods</h2>
      <Table caption={`${keys.length} figures across ${periods.length} periods`} columns={columns} rows={rows} rowKey={(row) => row.key} empty={{ title: 'No figures.' }} density="compact" />
    </section>
  )
}

/** Data-quality warnings of the input batches (US-24: shown beside the figures); only what is not zero. */
export function qualityWarnings(items: SnapshotDetail['input_data_quality']): string[] {
  const of = (quality: DataQuality) => [
    quality.orders_unknown_purpose > 0 ? `${integer(quality.orders_unknown_purpose)} of ${integer(quality.orders)} orders have an unknown purpose` : null,
    quality.refunds_without_month > 0 ? `${integer(quality.refunds_without_month)} of ${integer(quality.refunded_orders)} refunded orders have no refund month` : null,
    quality.payout_lines_without_source_order > 0 ? `${integer(quality.payout_lines_without_source_order)} of ${integer(quality.payout_lines)} payout lines have no source order` : null,
    quality.payout_lines_unknown_source_kind > 0 ? `${integer(quality.payout_lines_unknown_source_kind)} of ${integer(quality.payout_lines)} payout lines have an unknown source kind` : null,
  ].filter((text): text is string => text !== null)
  return items.flatMap((item) => (item.data_quality === null ? [] : of(item.data_quality)))
}

function StateBanner({ snapshot }: { readonly snapshot: SnapshotDetail }) {
  if (snapshot.state === 'computing') {
    return <Banner tone="info" title="Computing">The reports are being computed. This page updates every few seconds; you can leave it and come back.</Banner>
  }
  if (snapshot.state === 'failed') {
    return (
      <Banner tone="danger" title="The computation failed" action={<LinkButton href={SNAPSHOTS_PATH}>Create a new snapshot</LinkButton>}>
        {snapshot.failure_reason ?? 'No reason was recorded.'} No figures were stored.
      </Banner>
    )
  }
  if (snapshot.state === 'outdated') {
    return (
      <Banner tone="warning" title="Outdated" action={<LinkButton href={SNAPSHOTS_PATH}>Create a new snapshot</LinkButton>}>
        An import or mapping behind this snapshot changed after it was computed. Its figures are unchanged and still reproducible; create a new snapshot to report on the current data.
      </Banner>
    )
  }
  return null
}

/** SC-10 report view of one snapshot: R1-R5 tabs, each figure with population, method and version. */
export function SnapshotReport({ snapshotId }: { readonly snapshotId: string }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const { data: snapshot, meta, error, loading, reload } = useResource<SnapshotDetail>(
    `/v1/compliance/snapshots/${snapshotId}`, undefined, (current) => current.state === 'computing',
  )
  if (error !== null) return isNotAvailable(error) ? <NotAvailable /> : <ErrorState message={errorMessage(error)} onRetry={reload} />
  if (loading || snapshot === null) return <LoadingState label="Loading the snapshot" />

  const asked = params.get('report')
  const report: ReportCode | undefined = snapshot.reports.find((code) => code === asked) ?? snapshot.reports[0]
  const results = snapshot.results.filter((result) => result.report === report)
  const warnings = qualityWarnings(snapshot.input_data_quality)
  const versions = snapshot.input_mapping_versions.map((version) => `v${version}`).join(', ') || '—'
  const showFigures = snapshot.state === 'ready' || snapshot.state === 'outdated'
  return (
    <>
      <PageHeader
        title={`Snapshot · ${marketLabel(snapshot.market_id)} · ${periodRange(snapshot.period_from, snapshot.period_to)}`}
        state={<StatusChip state={snapshot.state} />}
        summary={`Method ${snapshot.method_version} · mapping ${versions} · ${snapshot.input_batch_ids.length} loaded batch(es) · created ${dateTime(snapshot.created_at)}`}
        actions={<LinkButton href={SNAPSHOTS_PATH}>All snapshots</LinkButton>}
      />
      <div className="data-stack">
        <StateBanner snapshot={snapshot} />
        {showFigures && typeof meta.notice === 'string' && (
          <Banner tone="info">{meta.notice} They are indicators for a compliance reviewer, not findings that a plan is lawful or unlawful.</Banner>
        )}
        {showFigures && warnings.length > 0 && (
          <Banner tone="warning" title="Data-quality warnings">
            <ul className="data-list">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </Banner>
        )}
      </div>
      {showFigures && report !== undefined && (
        <>
          <Tabs
            label="Reports" idPrefix={TABS_ID} selected={report}
            tabs={snapshot.reports.map((code) => ({ id: code, label: `${code} ${REPORT_NAMES[code]}` }))}
            onSelect={(id) => router.replace(`${pathname}?report=${id}`)}
          />
          <TabPanel idPrefix={TABS_ID} tabId={report}>
            {results.length === 0
              ? <p>This report has no period with data in the snapshot's range.</p>
              : (
                <>
                  {results.length > 1 && <PeriodComparison results={results} />}
                  {results.map((result) => <PeriodSection key={`${result.report}.${result.period}`} snapshotId={snapshot.id} result={result} />)}
                </>
              )}
          </TabPanel>
        </>
      )}
    </>
  )
}
