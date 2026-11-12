'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button, LinkButton } from '../../components/button'
import { PageHeader } from '../../components/page-header'
import { NotAvailable } from '../../components/states'
import { StatusChip } from '../../components/status-chip'
import { Table, type TableColumn } from '../../components/table'
import { useCursorPages } from '../../lib/cursor-pages'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { CreateSnapshotDialog } from './create-snapshot-dialog'
import { dateTime, periodRange } from './format'
import type { PageMeta, Snapshot } from './types'
import { useResource } from '../../lib/use-resource'

const PAGE_SIZE = 50

const versions = (snapshot: Snapshot) =>
  snapshot.input_mapping_versions.length === 0 ? '—' : snapshot.input_mapping_versions.map((version) => `v${version}`).join(', ')

const COLUMNS: readonly TableColumn<Snapshot>[] = [
  { key: 'period', header: 'Period', cell: (snapshot) => <Link href={`/compliance/snapshots/${snapshot.id}`}>{periodRange(snapshot.period_from, snapshot.period_to)}</Link> },
  { key: 'market', header: 'Market', cell: (snapshot) => <span className="data-id">{snapshot.market_id}</span> },
  { key: 'state', header: 'State', cell: (snapshot) => <StatusChip state={snapshot.state} /> },
  { key: 'reports', header: 'Reports', cell: (snapshot) => snapshot.reports.join(', ') },
  { key: 'mapping', header: 'Mapping versions', cell: versions },
  { key: 'method', header: 'Method version', cell: (snapshot) => snapshot.method_version },
  { key: 'created', header: 'Created', cell: (snapshot) => dateTime(snapshot.created_at) },
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
  const create = !readOnly && can('snapshot.create') ? <Button variant="primary" onClick={() => setCreating(true)}>Create snapshot</Button> : undefined
  const mappings = can('mapping.edit') || can('mapping.approve') ? <LinkButton href="/compliance/mappings">Import mappings</LinkButton> : undefined
  const overview = <LinkButton href="/compliance">Overview</LinkButton>
  return (
    <>
      <PageHeader
        title="Compliance snapshots"
        summary="Snapshots of the indicator reports R1 to R5, computed from loaded imports. A snapshot never changes; when its inputs change it is marked Outdated."
        actions={<>{overview}{mappings}{create}</>}
      />
      <Table
        caption={computing(rows) ? `Snapshots, newest first: ${rows.length} shown. Computing snapshots update every few seconds.` : `Snapshots, newest first: ${rows.length} shown`}
        columns={COLUMNS}
        rows={rows}
        rowKey={(snapshot) => snapshot.id}
        loading={loading}
        error={error === null ? null : { message: errorMessage(error), onRetry: reload }}
        empty={{ title: 'No snapshots yet. Once the imports of a market are loaded, create a snapshot for a range of months.' }}
        pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor) }}
      />
      {!readOnly && can('snapshot.create') && <CreateSnapshotDialog open={creating} onClose={() => setCreating(false)} />}
    </>
  )
}
