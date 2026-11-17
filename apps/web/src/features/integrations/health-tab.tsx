'use client'

import { Banner } from '../../components/banner'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { KpiCard } from '../../components/kpi-card'
import { StatusBadge } from '../../components/status-badge'
import { formatDateTime } from '../../lib/format'
import { useResource } from '../../lib/use-resource'
import { durationLabel } from '../admin/format'
import { refusalText } from '../orders/format'
import { LoadFailure } from '../admin/page-states'
import { MONO, NOTE } from '../admin/ui'
import { lagLabel, PROVIDER_NAMES, syncBadge } from './format'
import { SYNC_HEALTH_PATH, type SyncHealth, type SyncSource, type SyncState } from './types'
import { SECTION_HEADING } from './ui'

const HEADING_ID = 'integrations-health-heading'

const COLUMNS: readonly DataTableColumn<SyncSource>[] = [
  {
    key: 'source', header: 'Source', cell: (source) => (
      <div className="flex flex-col min-w-0">
        <span className="font-semibold text-on-surface">{source.name}</span>
        <span className={`${MONO} text-secondary`}>
          {source.kind === 'api' ? 'Order API' : [source.provider == null ? 'Connector' : PROVIDER_NAMES[source.provider], source.market?.code].filter(Boolean).join(' · ')}
        </span>
      </div>
    ),
  },
  { key: 'state', header: 'State', cell: (source) => <StatusBadge {...syncBadge(source.state)} /> },
  { key: 'last', header: 'Last accepted', cell: (source) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(source.last_success_at)}</span> },
  { key: 'lag', header: 'Since then', cell: (source) => lagLabel(source.lag_seconds) },
  { key: 'errors', header: 'Refused (24 h)', align: 'end', cell: (source) => source.errors_24h },
  { key: 'held', header: 'Held (over 24 h)', align: 'end', cell: (source) => `${source.held} (${source.held_overdue})` },
  {
    key: 'error', header: 'Last refusal', cell: (source) => source.last_error === null
      ? '—'
      : <span>{refusalText(source.last_error.code ?? undefined)}{source.last_error.at === null ? '' : ` · ${formatDateTime(source.last_error.at)}`}</span>,
  },
]

const count = (sources: readonly SyncSource[], state: SyncState): string => String(sources.filter((source) => source.state === state).length)

/**
 * SC-13 "Sync health" tab (FR-INT-002, API-37): per connector and API source system, the time since the last accepted
 * event, refusals and held items. States come from the server; the thresholds are the tenant's setting.
 */
export function HealthTab() {
  const health = useResource<SyncHealth>(SYNC_HEALTH_PATH)
  const view = health.data
  const sources = view?.sources ?? []
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-space-md">
      <h2 id={HEADING_ID} className={SECTION_HEADING}>Sync health</h2>
      {health.error !== null && <LoadFailure error={health.error} onRetry={health.reload} section />}
      {view !== null && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md" data-testid="health-kpis">
            <KpiCard label="Healthy" icon="cloud_done" value={count(sources, 'healthy')} detail="Sources within the lag you set" />
            <KpiCard label="Behind" icon="schedule" value={count(sources, 'behind')} detail="No accepted event for longer than the behind lag" />
            <KpiCard label="Failing" icon="sync_problem" value={count(sources, 'failing')} detail="Last event refused, held over 24 h, or past the failing lag" />
            <KpiCard label="Held items" icon="pending" value={String(sources.reduce((total, source) => total + source.held, 0))} detail="Waiting in the exception queue" />
          </div>
          {view.thresholds === null
            ? (
              <Banner tone="info" title="Sync thresholds are not set">
                Sources are only marked failing (a refused last event or an item held over 24 hours) until a Tenant admin sets the behind and failing lags in Settings.
              </Banner>
            )
            : <p className={NOTE}>Behind after {durationLabel(view.thresholds.behind_after_minutes)} without an accepted event; failing after {durationLabel(view.thresholds.failing_after_minutes)}.</p>}
        </>
      )}
      {health.error === null && (
        <DataTable
          caption="Sync health per source" columns={COLUMNS} rows={sources} rowKey={(source) => source.source} loading={health.loading}
          empty={{ title: 'No source has sent anything yet. Connectors and API callers appear after their first event.' }}
        />
      )}
    </section>
  )
}
