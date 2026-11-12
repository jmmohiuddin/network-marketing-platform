'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, LinkButton } from '../../components/button'
import { SelectField } from '../../components/form-field'
import { PageHeader } from '../../components/page-header'
import { NotAvailable } from '../../components/states'
import { StatusChip } from '../../components/status-chip'
import { Table, type TableColumn } from '../../components/table'
import { useCursorPages } from '../../lib/cursor-pages'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { dateTime, humanize, integer, periodRange } from './format'
import { BATCH_STATES, type Batch, type BatchState, type PageMeta } from './types'
import { useResource } from '../../lib/use-resource'

const PAGE_SIZE = 50

const COLUMNS: readonly TableColumn<Batch>[] = [
  { key: 'batch', header: 'Batch', cell: (batch) => <Link href={`/imports/${batch.id}`}>{batch.market} · {periodRange(batch.period_from, batch.period_to)}</Link> },
  { key: 'state', header: 'State', cell: (batch) => <StatusChip state={batch.state} /> },
  {
    key: 'rows', header: 'Rows (participants / orders / lines)', align: 'end',
    cell: ({ row_counts: counts }) => (counts === null ? '—' : `${integer(counts.participants)} / ${integer(counts.orders)} / ${integer(counts.payout_lines)}`),
  },
  { key: 'total', header: 'Order amount (minor units)', align: 'end', cell: (batch) => (batch.control_totals === null ? '—' : integer(batch.control_totals.order_amount_minor)) },
  { key: 'errors', header: 'Errors', align: 'end', cell: (batch) => integer(batch.report?.error_count ?? 0) },
  { key: 'mapping', header: 'Mapping', cell: (batch) => (batch.mapping_version === null ? '—' : `Version ${batch.mapping_version}`) },
  { key: 'uploaded', header: 'Uploaded', cell: (batch) => dateTime(batch.created_at) },
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
        actions={<><LinkButton href="/imports/mappings">Mappings</LinkButton>{!readOnly && <LinkButton href="/imports/new" variant="primary">Upload export</LinkButton>}</>}
      />
      <div className="data-row">
        <SelectField
          label="State"
          value={state ?? ''}
          options={[{ value: '', label: 'All states' }, ...BATCH_STATES.map((value) => ({ value, label: humanize(value) }))]}
          onChange={(event) => choose(event.target.value)}
        />
      </div>
      <Table
        caption={state === undefined ? `Import batches, newest first: ${rows.length} shown` : `${humanize(state)} batches: ${rows.length} shown`}
        columns={COLUMNS}
        rows={rows}
        rowKey={(batch) => batch.id}
        loading={loading}
        error={error === null ? null : { message: errorMessage(error), onRetry: reload }}
        empty={state === undefined
          ? { title: 'No imports yet. Upload the participants, orders and payout lines exports of one market to begin.' }
          : { title: 'No batches are in this state.', action: <Button onClick={() => choose('')}>Show all states</Button> }}
        pagination={{ hasPrevious: pages.hasPrevious, hasNext: nextCursor !== null, onPrevious: pages.previous, onNext: () => nextCursor !== null && pages.next(nextCursor) }}
      />
    </>
  )
}
