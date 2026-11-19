'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Select, TextInput } from '../../components/form-field'
import { useToast } from '../../components/toast'
import { ApiError, isApiError, newIdempotencyKey } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { shortId } from '../admin/format'
import { FormDialog } from '../admin/form-dialog'
import { LoadFailure } from '../admin/page-states'
import { tableError, usePagedList } from '../admin/resource'
import { saveFile } from '../data/transfer'
import { isFinished, marketAmount } from '../periods/format'
import { accountLabel } from './format'
import type { LedgerTabProps } from './ledger-page'
import type { GlMapping, JournalExport } from './types'

const MONO = 'font-data-mono-sm text-data-mono-sm'
const CODE_ID = 'gl-code'
const FILENAME = /filename="([^"]+)"/
/** The API's gl_code rule: no leading '-' (the CSV formula guard would change it). */
const GL_CODE = /^[A-Za-z0-9._:][A-Za-z0-9._:-]{0,63}$/

/** PUT /v1/ledger/gl-mappings/:marketId/:accountType (ledger.export, audited before/after). */
function MappingDialog({ marketId, mapping, onClose, onSaved }: { readonly marketId: string; readonly mapping: GlMapping; readonly onClose: () => void; readonly onSaved: () => void }) {
  const api = useApi()
  const toast = useToast()
  const [code, setCode] = useState(mapping.gl_code ?? '')
  const [error, setError] = useState<string | null>(null)
  function submit() {
    const value = code.trim()
    const problem = GL_CODE.test(value) ? null : 'Enter 1 to 64 letters, digits, dots, colons, underscores or hyphens, not starting with a hyphen.'
    setError(problem)
    if (problem !== null) return { items: [{ fieldId: CODE_ID, message: problem }] }
    return {
      items: [],
      fieldIds: { gl_code: CODE_ID },
      send: async () => {
        await api.put(`/v1/ledger/gl-mappings/${marketId}/${mapping.account_type}`, { gl_code: value })
        toast({ message: `${accountLabel(mapping.account_type)} maps to ${value}.` })
        onSaved()
      },
    }
  }
  return (
    <FormDialog title={`GL code of ${accountLabel(mapping.account_type)}`} submitLabel="Save GL code" onClose={onClose} onSubmit={submit}>
      <TextInput id={CODE_ID} label="GL code" helper="The account in your general ledger that the export names for this account type." value={code} error={error} onChange={(event) => setCode(event.target.value)} />
    </FormDialog>
  )
}

/** Chart of accounts mapping: the GL code of each of the ten account types of the market. */
export function MappingTab({ marketId }: LedgerTabProps) {
  const { can, readOnly } = useSession()
  const mappings = useResource<GlMapping[]>('/v1/ledger/gl-mappings', { market_id: marketId })
  const [editing, setEditing] = useState<GlMapping | null>(null)
  const canEdit = !readOnly && can('ledger.export')
  if (mappings.error !== null) return <LoadFailure error={mappings.error} onRetry={mappings.reload} section />
  const rows = mappings.data ?? []
  const mapped = rows.filter((row) => row.gl_code !== null).length
  const columns: readonly DataTableColumn<GlMapping>[] = [
    { key: 'type', header: 'Account type', cell: (row) => accountLabel(row.account_type) },
    { key: 'code', header: 'GL code', cell: (row) => (row.gl_code === null ? <span className="text-secondary">Not mapped</span> : <span className={MONO}>{row.gl_code}</span>) },
    { key: 'updated', header: 'Last changed', cell: (row) => (row.updated_at === null ? '—' : <span className="flex flex-col"><span className={MONO}>{formatDateTime(row.updated_at)}</span><span className="font-caption text-caption text-secondary">{row.updated_by?.display_name ?? 'Another user'}</span></span>) },
    ...(canEdit ? [{ key: 'edit', header: 'Actions', align: 'end' as const, cell: (row: GlMapping) => <Button size="sm" icon="edit" aria-label={`Edit GL code of ${accountLabel(row.account_type)}`} onClick={() => setEditing(row)}>Edit</Button> }] : []),
  ]
  return (
    <>
      <p className="font-body-sm text-body-sm text-secondary">{mappings.data === null ? 'Loading the mapping' : `${mapped} of ${rows.length} account types mapped. An export needs a GL code for every account type it posts to.`}</p>
      <DataTable caption="Chart of accounts mapping" columns={columns} rows={rows} rowKey={(row) => row.account_type} loading={mappings.loading} empty={{ title: 'No account types' }} stackOnPhone />
      {editing !== null && <MappingDialog marketId={marketId} mapping={editing} onClose={() => setEditing(null)} onSaved={() => {
        setEditing(null)
        mappings.reload()
      }} />}
    </>
  )
}

/** GL_MAPPING_MISSING names the account types in words. */
function exportRefusal(error: unknown): string {
  if (isApiError(error, 'GL_MAPPING_MISSING')) {
    const types = ((error as ApiError).details as { account_types?: string[] } | null)?.account_types ?? []
    return `Map these account types to a GL code first: ${types.map(accountLabel).join(', ')}.`
  }
  return errorMessage(error)
}

/** Exports: generate the GL journal of a committed or paid period, list earlier exports, download them again. */
export function ExportsTab({ marketId, money, periods }: LedgerTabProps) {
  const { readOnly } = useSession()
  const api = useApi()
  const toast = useToast()
  const finished = periods.filter((period) => isFinished(period.state))
  const [periodId, setPeriodId] = useState('')
  const [keys] = useState(() => new Map<string, string>())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const list = usePagedList<JournalExport>('/v1/ledger/journal-exports', { market_id: marketId })
  const label = (id: string) => periods.find((period) => period.id === id)?.label ?? shortId(id)

  async function generate() {
    if (periodId === '') {
      setProblem('Choose the period to export.')
      return
    }
    setBusy(true)
    setProblem(null)
    // One key per period: a retry after a lost answer returns the same export.
    const key = keys.get(periodId) ?? newIdempotencyKey()
    keys.set(periodId, key)
    try {
      await api.post('/v1/ledger/journal-exports', { period_id: periodId }, { idempotencyKey: key })
      toast({ message: `Journal export of ${label(periodId)} generated.` })
      list.reload()
    } catch (error) {
      setProblem(exportRefusal(error))
      if (isApiError(error) && error.status !== 0) keys.delete(periodId) // a lost answer keeps its key
    } finally {
      setBusy(false)
    }
  }
  async function download(row: JournalExport) {
    setDownloading(row.id)
    setProblem(null)
    try {
      const { data, headers } = await api.get<Blob>(`/v1/ledger/journal-exports/${row.id}/file`, { responseType: 'blob', headers: { Accept: 'text/csv' } })
      saveFile(data, FILENAME.exec(headers.get('content-disposition') ?? '')?.[1] ?? `gl-${row.market.code}-${row.id}.csv`)
    } catch (error) {
      setProblem(`The export could not be downloaded. ${errorMessage(error)}`)
    } finally {
      setDownloading(null)
    }
  }
  const columns: readonly DataTableColumn<JournalExport>[] = [
    { key: 'period', header: 'Period', cell: (row) => <span className="whitespace-nowrap">{label(row.period.id)}</span> },
    { key: 'lines', header: 'Lines', align: 'end', cell: (row) => row.line_count },
    { key: 'debits', header: `Debits (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap">{marketAmount(row.debit_total_minor, money)}</span> },
    { key: 'credits', header: `Credits (${money.currency})`, align: 'end', cell: (row) => <span className="whitespace-nowrap">{marketAmount(row.credit_total_minor, money)}</span> },
    // The hash is of the stored gzip (PLAN §2.1), so it never matches the downloaded CSV: the header says so.
    { key: 'hash', header: 'SHA-256 of the stored gzip (not the CSV)', cell: (row) => <span className={`${MONO} break-all`}>{row.content_sha256}</span> },
    { key: 'created', header: 'Generated', cell: (row) => <span className="flex flex-col"><span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.created_at)}</span><span className="font-caption text-caption text-secondary">{row.created_by.type === 'service_account' ? 'By an API key' : 'By a user'}</span></span> },
    { key: 'download', header: 'File', align: 'end', cell: (row) => <Button size="sm" icon="download" loading={downloading === row.id} aria-label={`Download the export of ${label(row.period.id)}`} onClick={() => download(row)}>Download</Button> },
  ]
  return (
    <>
      {!readOnly && (
        <section className="flex flex-col sm:flex-row sm:items-end gap-space-sm p-space-sm rounded bg-surface-container-low" aria-label="Generate a journal export">
          {finished.length === 0
            ? <p className="font-body-sm text-body-sm text-secondary">No committed period to export yet{periods.length === 0 ? ' (choosing a period needs read access to periods)' : ''}.</p>
            : (
              <>
                <div className="sm:w-72"><Select label="Period" placeholder="Choose a committed period" value={periodId} options={finished.map((period) => ({ value: period.id, label: period.label }))} onChange={(event) => setPeriodId(event.target.value)} /></div>
                <Button variant="primary" icon="file_download" loading={busy} data-testid="primary-action" onClick={generate}>Generate journal export</Button>
              </>
            )}
        </section>
      )}
      {problem !== null && <Banner tone="danger" title="No export">{problem}</Banner>}
      <DataTable caption="Journal exports" columns={columns} rows={list.rows} rowKey={(row) => row.id} loading={list.loading} error={tableError(list)}
        empty={{ title: 'No export yet: generate one for a committed period' }} pagination={list.pagination} stackOnPhone />
    </>
  )
}
