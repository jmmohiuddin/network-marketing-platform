'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Button } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { FileDropZone } from '../../components/file-drop-zone'
import { Select, TextInput } from '../../components/form-field'
import { StatusBadge } from '../../components/status-badge'
import { useToast } from '../../components/toast'
import { countLabel, formatDateTime } from '../../lib/format'
import { useSession } from '../../lib/session'
import { FormDialog, TextAreaField } from '../admin/form-dialog'
import { tableError, usePagedList } from '../admin/resource'
import { withApprovers } from '../admin/settings/labels'
import { FIELDSET, LEGEND } from '../admin/ui'
import { marketScope } from '../markets/format'
import { rateText } from '../orders/format'
import { FX_BATCH_ROWS_MAX, parseRatesCsv, rateRowOf, rowRefusal } from './format'
import type { FxBatch, FxBatchState, FxRate, FxRateRow } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
/** A bare section of the ledger tab panel, as the journal and receivables tabs (sc_33: no card inside the panel). */
const SECTION = 'flex flex-col gap-space-sm min-w-0'
const HEADING = 'font-section-heading text-section-heading text-on-surface font-bold'
const NOTE = 'font-body-sm text-body-sm text-secondary'
const BATCHES_PATH = '/v1/fx-rate-batches'
const SOURCE_ID = 'fx-source'
const FILE_ID = 'fx-file'
const NOTE_ID = 'fx-note'
const APPROVER_ROLE = 'Finance approver'
const STATE_OPTIONS: readonly { value: FxBatchState; label: string }[] = [
  { value: 'proposed', label: 'Proposed' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' },
]
const EMPTY_ROW: FxRateRow = { base: '', quote: '', rate: '', valid_from: '' }
/** 500 CSV rows of a few dozen bytes each fit well under 1 MB. */
const CSV_MAX_BYTES = 1_000_000

const pairText = (row: { readonly base: string; readonly quote: string }) => `${row.base} → ${row.quote}`
const rowFieldId = (index: number) => `fx-row-${index}-base`

/** Every approved rate, newest first; the one in force per pair is marked (GET /v1/fx-rates). */
function Rates() {
  const list = usePagedList<FxRate>('/v1/fx-rates')
  return (
    <section className={SECTION} aria-labelledby="fx-rates-title" data-testid="fx-rates">
      <h2 id="fx-rates-title" className={HEADING}>Exchange rates</h2>
      <p className={NOTE}>An order in another currency converts once, when it is received, at the rate in force at its order time: the latest approved rate of the pair whose start has passed. Rates never change once approved.</p>
      <DataTable
        bare
        stackOnPhone
        caption="Exchange rates"
        columns={[
          { key: 'pair', header: 'Pair', cell: (row) => <span className={`${MONO} font-semibold`}>{pairText(row)}</span> },
          { key: 'rate', header: 'Rate', align: 'end', cell: (row) => <span className={MONO}>{rateText(row.rate)}</span> },
          { key: 'from', header: 'Valid from', cell: (row) => <span className={MONO}>{formatDateTime(row.valid_from)}</span> },
          { key: 'source', header: 'Source', cell: (row) => row.source },
          { key: 'state', header: 'State', cell: (row) => (row.in_force ? <StatusBadge state="active" label="In force" /> : <StatusBadge state="inactive" label="Not in force" />) },
        ]}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={tableError(list)}
        empty={{ title: 'No exchange rate approved yet' }}
        pagination={list.pagination}
      />
    </section>
  )
}

/**
 * POST /v1/fx-rate-batches: a source and 1..500 rows typed in or read from a CSV file in the browser (nothing is
 * uploaded but the rows). Another person approves the batch before the rates exist.
 */
function ProposeDialog({ onClose, onSaved }: { readonly onClose: () => void; readonly onSaved: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<readonly FxRateRow[]>([EMPTY_ROW])
  const [issues, setIssues] = useState<Readonly<Record<string, string>>>({})
  const [fileProblem, setFileProblem] = useState<string | null>(null)
  const setCell = (index: number, key: keyof FxRateRow, value: string) => setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)))
  async function readFile(files: readonly File[]) {
    const file = files[0]
    if (file === undefined) return
    let text: string
    try {
      text = await file.text()
    } catch {
      setFileProblem('The file could not be read.')
      return
    }
    const parsed = parseRatesCsv(text)
    if ('error' in parsed) {
      setFileProblem(parsed.error)
      return
    }
    setFileProblem(null)
    setIssues({})
    setRows(parsed.rows)
    if (source.trim() === '') setSource(file.name)
  }
  function submit(idempotencyKey: string) {
    const found: Record<string, string> = {}
    if (source.trim() === '') found[SOURCE_ID] = 'Name the source of these rates, for example the bank or the file.'
    if (rows.length > FX_BATCH_ROWS_MAX) found[rowFieldId(0)] = `A batch takes at most ${FX_BATCH_ROWS_MAX} rates.`
    const checked = rows.map(rateRowOf)
    checked.forEach((result, index) => {
      if ('issue' in result) found[rowFieldId(index)] = `Rate ${index + 1}: ${result.issue}`
    })
    setIssues(found)
    const items = Object.entries(found).map(([fieldId, message]) => ({ fieldId, message }))
    if (items.length > 0) return { items }
    const body = { source: source.trim(), rows: checked.flatMap((result) => ('row' in result ? [result.row] : [])) }
    return {
      items,
      fieldIds: { source: SOURCE_ID },
      send: async () => {
        try {
          await api.post<FxBatch>(BATCHES_PATH, body, { idempotencyKey })
        } catch (error) {
          throw rowRefusal(error)
        }
        toast({ message: `${countLabel(body.rows.length, 'rate')} proposed. Another person must approve the batch.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title="Propose exchange rates" size="lg" submitLabel={`Propose ${countLabel(rows.length, 'rate')}`} onClose={onClose} onSubmit={submit}>
      <TextInput id={SOURCE_ID} label="Source" maxLength={200} value={source} error={issues[SOURCE_ID]} helper="Where the rates come from: kept with every rate." onChange={(event) => setSource(event.target.value)} />
      <FileDropZone id={FILE_ID} label="Rates file" optional extensions={['.csv']} maxBytes={CSV_MAX_BYTES} error={fileProblem} onFiles={(files) => void readFile(files)} />
      <p className={NOTE}>A CSV file with the header base,quote,rate,valid_from replaces the rows below; it is read in your browser. A rate converts one unit of the base currency into the quote currency.</p>
      <ol className="flex flex-col gap-space-sm">
        {rows.map((row, index) => (
          <li key={index}>
            <fieldset className={`${FIELDSET} p-space-sm rounded bg-surface-container-low`}>
              <legend className={LEGEND}>Rate {index + 1}</legend>
              <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_2fr_3fr_auto] gap-space-sm items-end">
                <TextInput id={rowFieldId(index)} label="Base" maxLength={3} value={row.base} error={issues[rowFieldId(index)]} onChange={(event) => setCell(index, 'base', event.target.value.toUpperCase())} />
                <TextInput label="Quote" maxLength={3} value={row.quote} onChange={(event) => setCell(index, 'quote', event.target.value.toUpperCase())} />
                <TextInput label="Rate" inputMode="decimal" value={row.rate} onChange={(event) => setCell(index, 'rate', event.target.value)} />
                <TextInput label="Valid from" helper="YYYY-MM-DD (00:00 UTC) or an instant" value={row.valid_from} onChange={(event) => setCell(index, 'valid_from', event.target.value)} />
                {rows.length > 1 && (
                  <Button size="sm" variant="tertiary" icon="delete" aria-label={`Remove rate ${index + 1}`} onClick={() => { setIssues({}); setRows((current) => current.filter((_, i) => i !== index)) }}>Remove</Button>
                )}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {rows.length < FX_BATCH_ROWS_MAX && <div><Button icon="add" onClick={() => setRows((current) => [...current, EMPTY_ROW])}>Add rate</Button></div>}
    </FormDialog>
  )
}

/** POST …/:id/decision (fx.approve, step-up through ApiProvider): approval inserts the rates and releases held orders. */
function DecisionDialog({ batch, decision, onClose, onDone }: { readonly batch: FxBatch; readonly decision: 'approve' | 'reject'; readonly onClose: () => void; readonly onDone: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [note, setNote] = useState('')
  const approve = decision === 'approve'
  function submit() {
    return {
      items: [],
      send: async () => {
        try {
          const { data } = await api.post<FxBatch & { readonly released_orders: number }>(`${BATCHES_PATH}/${batch.id}/decision`, { decision, ...(note.trim() === '' ? {} : { note: note.trim() }) })
          toast({ message: approve ? `${countLabel(batch.rows.length, 'rate')} approved; ${countLabel(data.released_orders, 'held order')} released.` : 'Batch rejected: no rate was added.' })
        } catch (error) {
          throw withApprovers(error, APPROVER_ROLE)
        }
        onDone()
      },
    }
  }
  return (
    <FormDialog title={approve ? 'Approve exchange rates' : 'Reject exchange rates'} submitLabel={approve ? `Approve ${countLabel(batch.rows.length, 'rate')}` : 'Reject batch'}
      submitVariant={approve ? 'primary' : 'destructive'} onClose={onClose} onSubmit={submit}>
      <p className={NOTE}>
        {approve
          ? `The rates exist from approval on and never change. Orders held for a missing or stale rate of these pairs convert now. Proposed by ${batch.proposed_by.name}.`
          : `Nothing is added; ${batch.proposed_by.name} can propose corrected rates.`}
        {' '}You confirm with your second factor.
      </p>
      <RowsList rows={batch.rows} />
      <TextAreaField id={NOTE_ID} label="Note" optional value={note} onChange={setNote} />
    </FormDialog>
  )
}

function RowsList({ rows }: { readonly rows: readonly FxRateRow[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <li key={`${row.base}:${row.quote}:${row.valid_from}`} className={`${MONO} break-words`}>{pairText(row)} {rateText(row.rate)} from {formatDateTime(row.valid_from)}</li>
      ))}
    </ul>
  )
}

/** Rate batches by state, proposed first (GET /v1/fx-rate-batches, fx.manage or fx.approve). */
function Batches() {
  const { me, can, readOnly } = useSession()
  const [state, setState] = useState<FxBatchState>('proposed')
  const list = usePagedList<FxBatch>(BATCHES_PATH, { state })
  const [proposing, setProposing] = useState(false)
  const [deciding, setDeciding] = useState<{ readonly batch: FxBatch; readonly decision: 'approve' | 'reject' } | null>(null)
  const canPropose = !readOnly && can('fx.manage') && marketScope(me, 'fx.manage') === 'all'
  const canDecide = !readOnly && can('fx.approve') && marketScope(me, 'fx.approve') === 'all'
  const decide = (batch: FxBatch) => {
    if (batch.state !== 'proposed' || !canDecide) return null
    // SoD: the proposer never decides; the server refuses (with the eligible approvers) anyone else involved.
    if (batch.proposed_by.id === me.user.id) return <span className="font-caption text-caption text-secondary">You proposed it: another approver decides</span>
    return (
      <div className="flex flex-wrap justify-end gap-space-xs">
        <Button size="sm" variant="destructive" aria-label={`Reject batch from ${batch.source}`} onClick={() => setDeciding({ batch, decision: 'reject' })}>Reject</Button>
        <Button size="sm" icon="verified" aria-label={`Approve batch from ${batch.source}`} onClick={() => setDeciding({ batch, decision: 'approve' })}>Approve</Button>
      </div>
    )
  }
  return (
    <section className={SECTION} aria-labelledby="fx-batches-title" data-testid="fx-batches">
      <div className="flex flex-wrap items-end justify-between gap-space-sm">
        <h2 id="fx-batches-title" className={HEADING}>Rate batches</h2>
        <div className="flex flex-wrap items-end gap-space-sm">
          <div className="w-44"><Select label="Show" value={state} options={STATE_OPTIONS} onChange={(event) => setState(event.target.value as FxBatchState)} /></div>
          {canPropose && <Button icon="add" onClick={() => setProposing(true)}>Propose rates</Button>}
        </div>
      </div>
      <p className={NOTE}>Rates are proposed as a batch and exist only once another person approves it with a second factor.</p>
      <DataTable
        key={state}
        bare
        stackOnPhone
        caption="Exchange rate batches"
        columns={[
          { key: 'proposed', header: 'Proposed', cell: (row) => <span className="flex flex-col"><span className={MONO}>{formatDateTime(row.proposed_at)}</span><span className="font-caption text-caption text-secondary">{row.proposed_by.name}</span></span> },
          { key: 'source', header: 'Source', cell: (row) => <span className="break-words">{row.source}</span> },
          { key: 'rates', header: 'Rates', cell: (row) => (
            <details>
              <summary className="cursor-pointer text-primary font-semibold">{countLabel(row.rows.length, 'rate')}</summary>
              <RowsList rows={row.rows} />
            </details>
          ) },
          { key: 'state', header: 'State', cell: (row) => <StatusBadge state={row.state} label={STATE_OPTIONS.find((option) => option.value === row.state)?.label} /> },
          { key: 'decided', header: 'Decided', cell: (row) => (row.decided_at === null ? '—' : <span className="flex flex-col"><span className={MONO}>{formatDateTime(row.decided_at)}</span><span className="font-caption text-caption text-secondary">{row.approver?.name ?? '—'}</span></span>) },
          ...(canDecide && state === 'proposed' ? [{ key: 'actions', header: 'Actions', align: 'end' as const, cell: decide }] : []),
        ]}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={tableError(list)}
        empty={{ title: state === 'proposed' ? 'No batch waits for a decision' : `No ${state} batch` }}
        pagination={list.pagination}
      />
      {proposing && <ProposeDialog onClose={() => setProposing(false)} onSaved={() => {
        setProposing(false)
        if (state === 'proposed') list.reload()
        else setState('proposed')
      }} />}
      {deciding !== null && <DecisionDialog batch={deciding.batch} decision={deciding.decision} onClose={() => setDeciding(null)} onDone={() => {
        setDeciding(null)
        list.reload()
      }} />}
    </section>
  )
}

/** SC-33 Exchange rates tab (FR-FIN-007, D-V1A-04): rates in force and, for fx.manage / fx.approve, the rate batches. */
export function FxTab() {
  const { can } = useSession()
  return (
    <>
      <Rates />
      {(can('fx.manage') || can('fx.approve')) && <Batches />}
    </>
  )
}
