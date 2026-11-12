'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button, LinkButton } from '../../components/button'
import { PageHeader } from '../../components/page-header'
import { NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { useCursorPages } from '../../lib/cursor-pages'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { marketName } from '../../lib/markets'
import { useSession } from '../../lib/session'
import { CreateSnapshotDialog } from './create-snapshot-dialog'
import { dateTime, periodRange } from './format'
import type { PageMeta, Snapshot } from './types'
import { useResource } from '../../lib/use-resource'
import { TableSection } from './ui'

const PAGE_SIZE = 50

const versions = (snapshot: Snapshot) =>
  snapshot.input_mapping_versions.length === 0 ? '—' : snapshot.input_mapping_versions.map((version) => `v${version}`).join(', ')

const MONO = 'font-data-mono-sm text-data-mono-sm'

/** sc_46 l.341 recorded snapshots table; also the overview's recent snapshots. */
export const SNAPSHOT_COLUMNS: readonly DataTableColumn<Snapshot>[] = [
  { key: 'period', header: 'Period', cell: (snapshot) => <Link href={`/compliance/snapshots/${snapshot.id}`} className={`${MONO} font-semibold text-primary hover:underline`}>{periodRange(snapshot.period_from, snapshot.period_to)}</Link> },
  { key: 'market', header: 'Market', cell: (snapshot) => marketName(snapshot.market) },
  { key: 'state', header: 'State', cell: (snapshot) => <StatusBadge state={snapshot.state} /> },
  { key: 'reports', header: 'Reports', cell: (snapshot) => <span className={MONO}>{snapshot.reports.join(', ')}</span> },
  { key: 'mapping', header: 'Mapping versions', cell: (snapshot) => <span className={MONO}>{versions(snapshot)}</span> },
  { key: 'method', header: 'Method version', cell: (snapshot) => <span className={MONO}>{snapshot.method_version}</span> },
  { key: 'created', header: 'Created', cell: (snapshot) => <span className={`${MONO} text-secondary`}>{dateTime(snapshot.created_at)}</span> },
]

export const computing = (snapshots: readonly Snapshot[]) => snapshots.some((snapshot) => snapshot.state === 'computing')

/** SC-10 snapshot list: every snapshot with its state; refreshes while one is computing. */
export function SnapshotsList() {
  const { can, readOnly } = useSession()
  const pages = useCursorPages()
  const { data, meta, error, loading, reload } = useResource<Snapshot[]>('/v1/compliance/snapshots', { cursor: pages.cursor, limit: PAGE_SIZE }, computing)
  const [creating, setCreating] = useState(false)

  if (error !== null && isNotAvailable(error)) return <NotAvailable />

  const rows = data ?? []
  const nextCursor = (meta as PageMeta).next_cursor ?? null
  const create = !readOnly && can('snapshot.create') ? <Button variant="primary" icon="add_task" onClick={() => setCreating(true)} data-testid="primary-action">Create snapshot</Button> : undefined
  const mappings = can('mapping.edit') || can('mapping.approve') ? <LinkButton href="/compliance/mappings" icon="route">Import mappings</LinkButton> : undefined
  const overview = <LinkButton href="/compliance" icon="verified_user">Overview</LinkButton>
  return (
    <>
      <PageHeader
        title="Compliance snapshots"
        breadcrumbs={[{ label: 'Compliance', href: '/compliance' }, { label: 'Snapshots' }]}
        summary="Snapshots of the indicator reports R1 to R5, computed from loaded imports. A snapshot never changes; when its inputs change it is marked Outdated."
        actions={<>{overview}{mappings}{create}</>}
      />
      <TableSection first title="Recorded snapshots" summary="Every snapshot with its market, months, inputs and method; newest first.">
        <DataTable
          bare
          caption={computing(rows) ? `Snapshots, newest first: ${rows.length} shown. Computing snapshots update every few seconds.` : `Snapshots, newest first: ${rows.length} shown`}
          columns={SNAPSHOT_COLUMNS}
          rows={rows}
          rowKey={(snapshot) => snapshot.id}
          loading={loading}
          error={error === null ? null : { message: errorMessage(error), onRetry: reload }}
          empty={{ title: 'No snapshots yet. Once the imports of a market are loaded, create a snapshot for a range of months.' }}
          pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor), rangeText: `${rows.length} shown` }}
        />
      </TableSection>
      {!readOnly && can('snapshot.create') && <CreateSnapshotDialog open={creating} onClose={() => setCreating(false)} />}
    </>
  )
}
