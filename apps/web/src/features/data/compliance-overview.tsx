'use client'

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
import { CreateSnapshotDialog } from './create-snapshot-dialog'
import { dateTime, figureLabel, marketLabel, periodRange, REPORT_NAMES, SNAPSHOTS_PATH } from './format'
import { FigureCard, qualityWarnings } from './snapshot-report'
import { computing } from './snapshots-list'
import type { PeriodResult, ReportCode, Snapshot, SnapshotDetail } from './types'

// shortcut: the overview reads the newest 200 snapshots; a market whose last usable snapshot is older is listed
// only in the snapshot list. Page through when a tenant keeps more.
const RECENT_LIMIT = 200

/** The one figure per report the overview shows (SC-46 "latest R1-R5 headline figures"). */
export const HEADLINE_KEYS: Readonly<Record<ReportCode, string>> = {
  R1: 'customer_share_pct',
  R2: 'personal_use_share_pct',
  R3: 'share_pct.retail_sale',
  R4: 'active_with_no_customer_order_pct',
  R5: 'earned_more_than_zero_pct',
}

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

function Headline({ snapshot, report }: { readonly snapshot: SnapshotDetail; readonly report: ReportCode }) {
  const headline = headlineOf(snapshot.results, report)
  const context = `${report} ${REPORT_NAMES[report]} · ${headline?.result.period ?? 'no period'}${headline?.result.partial === true ? ' · partial year, not publishable' : ''}`
  if (headline?.figure != null) return <FigureCard snapshotId={snapshot.id} figure={headline.figure} context={context} />
  const reason = headline === null ? 'No period of this report has data in the snapshot.' : (headline.omitted?.reason ?? 'Not computed.')
  return (
    <article className="figure-card" aria-label={`${context}: ${figureLabel(HEADLINE_KEYS[report])}`}>
      <p className="data-note">{context}</p>
      <h3>{figureLabel(HEADLINE_KEYS[report])}</h3>
      <p>{reason}</p>
    </article>
  )
}

/** One market: its latest usable snapshot's headline figures, data coverage and data-quality warnings. */
function MarketOverview({ snapshotId }: { readonly snapshotId: string }) {
  const { data: snapshot, meta, error, reload } = useResource<SnapshotDetail>(`/v1/compliance/snapshots/${snapshotId}`)
  if (error !== null) return <ErrorState message={errorMessage(error)} onRetry={reload} section />
  if (snapshot === null) return <LoadingState label="Loading the latest figures" />
  const title = `${marketLabel(snapshot.market_id)} · ${periodRange(snapshot.period_from, snapshot.period_to)}`
  const warnings = qualityWarnings(snapshot.input_data_quality)
  const versions = snapshot.input_mapping_versions.map((version) => `v${version}`).join(', ') || '—'
  return (
    <section className="data-section" aria-label={title}>
      <h2>{title} {snapshot.state === 'outdated' && <StatusChip state="outdated" label="Outdated: figures unchanged, inputs changed since" />}</h2>
      <p>
        Data coverage: {snapshot.input_batch_ids.length} loaded import batch(es) for {periodRange(snapshot.period_from, snapshot.period_to)} · mapping {versions} ·
        method {snapshot.method_version} · computed {dateTime(snapshot.created_at)}. <Link href={`/compliance/snapshots/${snapshot.id}`}>Open the full report</Link>
      </p>
      {typeof meta.notice === 'string' && <Banner tone="info">{meta.notice}</Banner>}
      {warnings.length > 0 && (
        <Banner tone="warning" title="Data-quality warnings">
          <ul className="data-list">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </Banner>
      )}
      <div className="kpi-grid">
        {snapshot.reports.map((report) => <Headline key={report} snapshot={snapshot} report={report} />)}
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
    <section className="data-section" aria-labelledby="data-status-title">
      <h2 id="data-status-title">Data status</h2>
      <ul className="data-list">
        <li>{running === 0 ? 'No snapshot is being computed.' : `${running} snapshot(s) being computed. This page updates every few seconds.`}</li>
        {failed.map((snapshot) => (
          <li key={snapshot.id}>
            The newest snapshot of {marketLabel(snapshot.market_id)} ({periodRange(snapshot.period_from, snapshot.period_to)}) failed: {snapshot.failure_reason ?? 'no reason was recorded'}.
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
  const [creating, setCreating] = useState(false)
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
        actions={<><LinkButton href={SNAPSHOTS_PATH}>Open reports</LinkButton>{imports}{mayCreate && <Button variant="primary" onClick={() => setCreating(true)}>Create snapshot</Button>}</>}
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
      {latest.map((snapshot) => <MarketOverview key={snapshot.id} snapshotId={snapshot.id} />)}
      {data !== null && snapshots.length > 0 && <DataStatus snapshots={snapshots} />}
      {mayCreate && <CreateSnapshotDialog open={creating} onClose={() => setCreating(false)} />}
    </>
  )
}
