'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, LinkButton } from '../../components/button'
import { Select } from '../../components/form-field'
import { PageHeader } from '../../components/page-header'
import { NotAvailable } from '../../components/states'
import { StatusBadge } from '../../components/status-badge'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { useCursorPages } from '../../lib/cursor-pages'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { mappingPath } from './batch-mapping'
import { dateTime, humanize, integer, periodRange } from './format'
import { BATCH_STATES, type Batch, type BatchState, type PageMeta } from './types'
import { useResource } from '../../lib/use-resource'
import { TableSection } from './ui'

const PAGE_SIZE = 50

const MAPPABLE: readonly BatchState[] = ['validated', 'mapped']
const MONO = 'font-data-mono-sm text-data-mono-sm'

// sc_24 l.250 batch table: batch and period, stage, counts and control total, validation, timestamp, actions.
const COLUMNS: readonly DataTableColumn<Batch>[] = [
  {
    key: 'batch', header: 'Batch',
    cell: (batch) => (
      <div className="flex flex-col">
        <Link href={`/imports/${batch.id}`} className={`${MONO} font-semibold text-primary hover:underline`}>{batch.market} · {periodRange(batch.period_from, batch.period_to)}</Link>
        <span className="font-data-mono-sm text-[11px] text-secondary font-normal">{batch.id}</span>
      </div>
    ),
  },
  { key: 'state', header: 'State', cell: (batch) => <StatusBadge state={batch.state} /> },
  {
    key: 'rows', header: 'Rows (participants / orders / lines)', align: 'end',
    cell: ({ row_counts: counts }) => <span className={`${MONO} font-medium`}>{counts === null ? '—' : `${integer(counts.participants)} / ${integer(counts.orders)} / ${integer(counts.payout_lines)}`}</span>,
  },
  { key: 'total', header: 'Order amount (minor units)', align: 'end', cell: (batch) => <span className={MONO}>{batch.control_totals === null ? '—' : integer(batch.control_totals.order_amount_minor)}</span> },
  {
    key: 'validation', header: 'Validation',
    cell: (batch) => (
      <div className="flex flex-col">
        <span className="font-caption text-caption font-semibold text-on-surface">{`${integer(batch.report?.error_count ?? 0)} errors`}</span>
        <span className="font-data-mono-sm text-[11px] text-secondary">{batch.mapping_version === null ? 'No mapping' : `Mapping version ${batch.mapping_version}`}</span>
      </div>
    ),
  },
  { key: 'uploaded', header: 'Uploaded', cell: (batch) => <span className={`${MONO} text-secondary`}>{dateTime(batch.created_at)}</span> },
  {
    key: 'actions', header: 'Actions', align: 'end',
    cell: (batch) => (
      <div className="flex items-center justify-end gap-space-xs">
        {MAPPABLE.includes(batch.state) && <LinkButton href={mappingPath(batch)} size="sm" icon="route">Open mapping</LinkButton>}
        <LinkButton href={`/imports/${batch.id}`} size="sm" icon="visibility" aria-label={`View details: ${batch.market} · ${periodRange(batch.period_from, batch.period_to)}`}>View details</LinkButton>
      </div>
    ),
  },
]

const isBatchState = (value: string | null): value is BatchState => (BATCH_STATES as readonly (string | null)[]).includes(value)

/** SC-24 batch list: every upload with its state, counts and control total; newest first. */
export function ImportsList() {
  const { readOnly } = useSession()
  const router = useRouter()
  const params = useSearchParams()
  const filter = params.get('state')
  const state = isBatchState(filter) ? filter : undefined
  const pages = useCursorPages()
  const { data, meta, error, loading, reload } = useResource<Batch[]>('/v1/imports', { state, cursor: pages.cursor, limit: PAGE_SIZE })

  if (error !== null && isNotAvailable(error)) return <NotAvailable />

  function choose(value: string) {
    pages.reset()
    router.replace(value === '' ? '/imports' : `/imports?state=${value}`)
  }

  const nextCursor = (meta as PageMeta).next_cursor ?? null
  const rows = data ?? []
  return (
    <>
      <PageHeader
        title="Data imports"
        summary="Upload the three export files of one market and period, read the validation report, attach an approved mapping and load the batch."
        actions={<>
          <LinkButton href="/imports/mappings" icon="route">Mappings</LinkButton>
          {!readOnly && <LinkButton href="/imports/new" variant="primary" icon="cloud_upload" data-testid="primary-action">Upload export</LinkButton>}
        </>}
      />
      <TableSection
        first
        title="Import batches"
        summary="Every upload with its state, row counts, control total and validation result; newest first."
        controls={(
          <Select
            label="State"
            value={state ?? ''}
            options={[{ value: '', label: 'All states' }, ...BATCH_STATES.map((value) => ({ value, label: humanize(value) }))]}
            onChange={(event) => choose(event.target.value)}
          />
        )}
      >
        <DataTable
          bare
          caption={state === undefined ? `Import batches, newest first: ${rows.length} shown` : `${humanize(state)} batches: ${rows.length} shown`}
          columns={COLUMNS}
          rows={rows}
          rowKey={(batch) => batch.id}
          loading={loading}
          error={error === null ? null : { message: errorMessage(error), onRetry: reload }}
          empty={state === undefined
            ? { title: 'No imports yet. Upload the participants, orders and payout lines exports of one market to begin.' }
            : { title: 'No batches are in this state.', action: <Button onClick={() => choose('')}>Show all states</Button> }}
          pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor), rangeText: `${rows.length} shown` }}
        />
      </TableSection>
    </>
  )
}
