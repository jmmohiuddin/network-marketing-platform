'use client'

import { countLabel } from '../../lib/format'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { Banner } from '../../components/banner'
import { Button, LinkButton } from '../../components/button'
import { FigureCard } from '../../components/figure-card'
import { Icon } from '../../components/icon'
import { PageHeader } from '../../components/page-header'
import { ErrorState, LoadingState, NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { TabPanel, Tabs } from '../../components/tabs'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { marketName } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { CreateSnapshotDialog, type SnapshotRequest } from './create-snapshot-dialog'
import { dateTime, figureAmount, figureLabel, figureUnit, integer, periodRange, REPORT_NAMES, SNAPSHOTS_PATH } from './format'
import { inBreakdown, ReportBreakdown } from './report-breakdowns'
import { CompareSection, PeriodFilters, TrendSection, type PeriodChoice } from './period-views'
import type { DataQuality, Figure, PeriodResult, ReportCode, SnapshotDetail } from './types'
import { useResource } from '../../lib/use-resource'
import { Facts, LIST, NOTE, ScopeStrip, SECTION_HEADING } from './ui'

const TABS_ID = 'report'

export const rowsHref = (snapshotId: string, figureId: string) =>
  `/compliance/snapshots/${snapshotId}/rows?figure=${encodeURIComponent(figureId)}`

export interface SnapshotFigureProps {
  readonly snapshotId: string
  readonly figure: Figure
  readonly code?: ReportCode
  readonly first?: boolean
}

/** sc_10 l.88 figure card with method (UI-04): value, components, population, method and the rows behind it. */
export function SnapshotFigure({ snapshotId, figure, code, first }: SnapshotFigureProps) {
  const population = `${figure.population ?? '—'}${figure.population_count === null ? '' : ` (${integer(figure.population_count)})`}`
  return (
    <FigureCard
      title={figureLabel(figure.key)}
      code={code}
      first={first}
      value={figureAmount(figure)}
      valueLabel={figureUnit(figure)}
      note={figure.note ?? undefined}
      facts={[
        ...(figure.numerator === null ? [] : [{ term: 'Numerator', detail: integer(figure.numerator) }]),
        ...(figure.denominator === null ? [] : [{ term: 'Denominator', detail: integer(figure.denominator) }]),
        { term: 'Population', detail: population },
        { term: 'Method', detail: figure.method ?? '—' },
        { term: 'Method version', detail: <span className="font-data-mono-sm text-data-mono-sm">{figure.method_version ?? '—'}</span> },
      ]}
      action={(
        <Link href={rowsHref(snapshotId, figure.id)} className="self-start text-primary hover:underline font-semibold font-body-sm text-body-sm inline-flex items-center gap-1">
          Open the rows behind this figure
          <Icon name="arrow_forward" size={16} />
        </Link>
      )}
    />
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
  const cards = result.figures.filter((figure) => !inBreakdown(result.report, figure.key))
  return (
    <section className="flex flex-col gap-space-sm" aria-label={title}>
      <h2 className={`${SECTION_HEADING} flex flex-wrap items-center gap-space-xs`}>{title} {result.partial && <StatusBadge state="stale" label="Partial year, not publishable" />}</h2>
      {population !== null && <p className="font-body-sm text-body-sm text-on-surface">{population}</p>}
      {result.notes.length > 0 && <ul className={`${LIST} ${NOTE}`} aria-label="Notes">{result.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
      <ReportBreakdown result={result} rowsHref={(figureId) => rowsHref(snapshotId, figureId)} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
        {cards.map((figure, index) => <SnapshotFigure key={figure.id} snapshotId={snapshotId} figure={figure} code={result.report} first={index === 0} />)}
      </div>
      {result.omitted.length > 0 && (
        <div className="bg-surface-container-lowest rounded border border-outline-variant p-space-md flex flex-col gap-space-xs">
          <h3 className={SECTION_HEADING}>Indicators not computed</h3>
          <ul className={`${LIST} font-body-sm text-body-sm text-on-surface`}>
            {result.omitted.map((item) => <li key={item.key}>{figureLabel(item.key)}: {item.reason ?? 'No reason was recorded.'}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}

/** sc_10 l.372 docked "method" inspector: what the snapshot was computed from. */
function MethodPanel({ snapshot, report, notice }: { readonly snapshot: SnapshotDetail; readonly report: ReportCode; readonly notice: ReactNode }) {
  const versions = snapshot.input_mapping_versions.map((version) => `v${version}`).join(', ') || '—'
  return (
    <section aria-label="Method and inputs" className="rounded bg-surface-container-lowest border border-outline-variant shadow-sm overflow-hidden">
      <div className="bg-surface-container-low px-space-md py-space-sm border-b border-outline-variant flex items-center gap-1.5">
        <Icon name="menu_book" size={18} className="text-primary" />
        <h2 className={SECTION_HEADING}>Method and inputs</h2>
      </div>
      <div className="p-space-md flex flex-col gap-space-md">
        <Facts
          items={[
            ['Report', `${report} ${REPORT_NAMES[report]}`],
            ['Method version', <span key="method" className="font-data-mono-sm text-data-mono-sm">{snapshot.method_version}</span>],
            ['Mapping versions', versions],
            ['Loaded batches', integer(snapshot.input_batch_ids.length)],
            ['Created', dateTime(snapshot.created_at)],
          ]}
        />
        {notice}
      </div>
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

function StateBanner({ snapshot, recreate }: { readonly snapshot: SnapshotDetail; readonly recreate?: ReactNode }) {
  if (snapshot.state === 'computing') {
    return <Banner tone="info" title="Computing">The reports are being computed. This page updates every few seconds; you can leave it and come back.</Banner>
  }
  if (snapshot.state === 'failed') {
    return (
      <Banner tone="danger" title="The computation failed" action={recreate}>
        {snapshot.failure_reason ?? 'No reason was recorded.'} No figures were stored.
      </Banner>
    )
  }
  if (snapshot.state === 'outdated') {
    return (
      <Banner tone="warning" title="Outdated" action={recreate}>
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
  const { can, readOnly } = useSession()
  // The dialog mounts per opening, filled in with this snapshot's market and months.
  const [creating, setCreating] = useState<Partial<SnapshotRequest> | null>(null)
  const { data: snapshot, meta, error, loading, reload } = useResource<SnapshotDetail>(
    `/v1/compliance/snapshots/${snapshotId}`, undefined, (current) => current.state === 'computing',
  )
  if (error !== null) return isNotAvailable(error) ? <NotAvailable /> : <ErrorState message={errorMessage(error)} onRetry={reload} />
  if (loading || snapshot === null) return <LoadingState label="Loading the snapshot" />

  const asked = params.get('report')
  const report: ReportCode | undefined = snapshot.reports.find((code) => code === asked) ?? snapshot.reports[0]
  const results = snapshot.results.filter((result) => result.report === report)
  const periods = results.map((result) => result.period)
  const known = (value: string | null) => (value !== null && periods.includes(value) ? value : null)
  // The latest period by default (BUG-033): one period's figures, the trend carries the history.
  const period = known(params.get('period')) ?? [...periods].sort().at(-1) ?? null
  const compare = period === null ? null : known(params.get('compare'))
  const selected = results.find((result) => result.period === period)
  const compared = results.find((result) => result.period === compare)
  const choose = (choice: PeriodChoice) => {
    const query = new URLSearchParams({ report: report ?? '', period: choice.period })
    if (choice.compare !== null) query.set('compare', choice.compare)
    router.replace(`${pathname}?${query.toString()}`)
  }
  const monthly = results.length > 1 && results.every((result) => result.period_kind === 'month')
  const warnings = qualityWarnings(snapshot.input_data_quality)
  const versions = snapshot.input_mapping_versions.map((version) => `v${version}`).join(', ') || '—'
  const showFigures = snapshot.state === 'ready' || snapshot.state === 'outdated'
  const range = periodRange(snapshot.period_from, snapshot.period_to)
  const mayCreate = !readOnly && can('snapshot.create')
  const openCreate = () => setCreating({ market: snapshot.market.code, period_from: snapshot.period_from, period_to: snapshot.period_to })
  const recreate = mayCreate ? <Button onClick={openCreate}>Create a new snapshot</Button> : <LinkButton href={SNAPSHOTS_PATH}>All snapshots</LinkButton>
  const notice = showFigures && typeof meta.notice === 'string'
    ? <Banner tone="info">{meta.notice} They are indicators for a compliance reviewer, not findings that a plan is lawful or unlawful.</Banner>
    : null
  return (
    <>
      <PageHeader
        title={`Snapshot · ${marketName(snapshot.market)} · ${range}`}
        state={<StatusBadge state={snapshot.state} />}
        breadcrumbs={[{ label: 'Compliance', href: '/compliance' }, { label: 'Snapshots', href: SNAPSHOTS_PATH }, { label: `${snapshot.market.code} · ${range}` }]}
        summary={`Method ${snapshot.method_version} · mapping ${versions} · ${countLabel(snapshot.input_batch_ids.length, 'loaded batch', 'loaded batches')} · created ${dateTime(snapshot.created_at)}`}
        actions={<>
          <LinkButton href={SNAPSHOTS_PATH} icon="history_edu">All snapshots</LinkButton>
          {mayCreate && <Button variant="primary" icon="add_task" onClick={openCreate} data-testid="primary-action">Create snapshot</Button>}
        </>}
      />
      <ScopeStrip items={[['Market', marketName(snapshot.market)], ['Period', range], ['Mapping', versions], ['Method', snapshot.method_version]]} />
      <StateBanner snapshot={snapshot} recreate={recreate} />
      {showFigures && warnings.length > 0 && (
        <Banner tone="warning" title="Data-quality warnings">
          <ul className={LIST}>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </Banner>
      )}
      {showFigures && report !== undefined && (
        <div className="flex flex-col">
          {/* Full width above the split so all five report names fit; the strip wraps rather than hides a tab (BUG-034). */}
          <Tabs
            label="Reports" idPrefix={TABS_ID} selected={report}
            tabs={snapshot.reports.map((code) => ({ id: code, label: `${code} ${REPORT_NAMES[code]}` }))}
            onSelect={(id) => router.replace(`${pathname}?report=${id}`)}
          />
          <TabPanel idPrefix={TABS_ID} tabId={report}>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-start">
              <div className="lg:col-span-8 flex flex-col gap-space-md">
                {results.length === 0 || period === null
                  ? <p className={NOTE}>This report has no period with data in the snapshot's range.</p>
                  : (
                    <>
                      {results.length > 1 && <PeriodFilters periods={periods} choice={{ period, compare }} onChange={choose} />}
                      {compared === undefined && monthly && <TrendSection key={report} results={results} />}
                      {selected !== undefined && compared !== undefined && <CompareSection a={selected} b={compared} />}
                      {selected !== undefined && <PeriodSection key={`${selected.report}.${selected.period}`} snapshotId={snapshot.id} result={selected} />}
                    </>
                  )}
              </div>
              <div className="lg:col-span-4">
                <MethodPanel snapshot={snapshot} report={report} notice={notice} />
              </div>
            </div>
          </TabPanel>
        </div>
      )}
      {mayCreate && creating !== null && <CreateSnapshotDialog open initial={creating} onClose={() => setCreating(null)} />}
    </>
  )
}
