'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable, type DataTableColumn } from '../../components/data-table'
import { Drawer } from '../../components/drawer'
import { StatusBadge } from '../../components/status-badge'
import { LoadingState } from '../../components/states'
import { useToast } from '../../components/toast'
import { isApiError, newIdempotencyKey } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { useResource } from '../../lib/use-resource'
import { isUuid } from '../admin/format'
import { LoadFailure } from '../admin/page-states'
import { MONO, NOTE } from '../admin/ui'
import { saveFile } from '../data/transfer'
import { valueText } from '../admin/settings/labels'
import { VersionDialog } from '../admin/settings/version-dialog'
import type { Resource } from '../../lib/use-resource'
import type { ExportModel, FullExport, FullExportDetail, FullExportState, FullSchedule, SigningKey } from './types'
import { CARD, CopyStatusText, IconTile, SECTION_HEADING, useCopy } from './ui'

// SC-13 Exports tab (FR-INT-003, PLAN B6 2.3 / §5): the full export schedule, manual runs, signed manifests and files.

const SCHEDULE_KEY = 'exports.full_schedule' as const
/** Retention of the API (export-model FULL_EXPORTS_KEPT): only this many completed exports keep their files. */
const KEPT = 7
/** shortcut: the newest 50 exports only (no paging); page through GET /v1/exports when a tenant needs older failed runs. */
const LIST_LIMIT = 50
const ERASURE_NOTICE = 'Downloaded files are your copy: erasure in the platform cannot reach them. Delete your copies when a participant’s data is erased.'

const STATE_BADGE: Readonly<Record<FullExportState, { readonly state: string; readonly label: string }>> = {
  queued: { state: 'pending', label: 'Queued' },
  running: { state: 'calculating', label: 'Running' },
  completed: { state: 'ready', label: 'Completed' },
  failed: { state: 'failed', label: 'Failed' },
  expired: { state: 'expired', label: 'Expired' },
}

const ERROR_LABELS: Readonly<Record<string, string>> = {
  EXPORT_TABLE_TOO_LARGE: 'A table is too large to export in one file',
  ERASED_DURING_EXPORT: 'A participant’s data was erased while the export ran; run it again',
}

/**
 * The signed bytes of a manifest: JSON without whitespace, object keys sorted (code unit order) at every level.
 * shortcut: copy of the API's int/full-export.ts canonicalJson (the web cannot import API code); keep the two equal.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const inProgress = (rows: readonly FullExport[]) => rows.some((row) => row.state === 'queued' || row.state === 'running')
const count = (value: number | null) => (value === null ? '—' : value.toLocaleString())

/** The schedule card: cadence and hour, or "Manual only"; changed through the settings dialog (step-up). */
function ScheduleCard() {
  const { can, readOnly } = useSession()
  const schedule = useResource<{ value: FullSchedule | null }>(`/v1/settings/${SCHEDULE_KEY}`)
  const [editing, setEditing] = useState(false)
  const value = schedule.data?.value ?? null
  const latest = typeof schedule.meta.latest_version === 'number' ? schedule.meta.latest_version : 0
  return (
    <section className={CARD} aria-labelledby="export-schedule-title" data-testid="export-schedule">
      <div className="flex items-start justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm min-w-0">
          <IconTile name="schedule" />
          <div className="min-w-0">
            <h2 id="export-schedule-title" className={SECTION_HEADING}>Export schedule</h2>
            <p className={NOTE}>A signed export of all your data, generated in UTC. The product sets no schedule for you.</p>
          </div>
        </div>
        {can('settings.manage') && !readOnly && schedule.data !== null && <Button icon="edit" onClick={() => setEditing(true)}>Change schedule</Button>}
      </div>
      {schedule.error !== null && <LoadFailure error={schedule.error} onRetry={schedule.reload} section />}
      {schedule.data !== null && <p className="font-body-md text-body-md text-on-surface font-semibold">{value === null ? 'Manual only' : valueText(SCHEDULE_KEY, value)}</p>}
      {editing && (
        <VersionDialog keys={[SCHEDULE_KEY]} initialKey={SCHEDULE_KEY} values={{ [SCHEDULE_KEY]: value }} latestVersion={latest}
          onClose={() => setEditing(false)} onSaved={() => {
            setEditing(false)
            schedule.reload()
          }} />
      )}
    </section>
  )
}

/** "Verify with the public key": the tenant's Ed25519 key, its id and a copy button. */
function PublicKey({ signing, manifestFile }: { readonly signing: SigningKey; readonly manifestFile: string }) {
  const [status, copy] = useCopy(signing.public_key)
  return (
    <div className="flex flex-col gap-space-xs" data-testid="public-key">
      <p className={NOTE}>
        Verify the signature (base64 above) with the public key: {signing.algorithm} over the bytes of {manifestFile}, the manifest written as JSON without
        spaces, with the keys of every object sorted. The key is the base64 SPKI DER form; key id {signing.key_id}.
      </p>
      <code className={`${MONO} p-space-sm rounded bg-surface-container-low break-all select-all`}>{signing.public_key}</code>
      <Button icon="content_copy" className="self-start" onClick={() => void copy()}>Copy public key</Button>
      <CopyStatusText status={status} noun="public key" />
    </div>
  )
}

/** GET /v1/exports/:id: manifest table with per-file downloads, the signature and its key id. */
function ExportDrawer({ exportId, signing, onClose }: { readonly exportId: string; readonly signing: Resource<SigningKey>; readonly onClose: () => void }) {
  const api = useApi()
  const detail = useResource<FullExportDetail>(`/v1/exports/${exportId}`)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const data = detail.data
  async function download(table: string, file: string) {
    setDownloading(table)
    setProblem(null)
    try {
      const { data: blob } = await api.get<Blob>(`/v1/exports/${exportId}/files/${table}`, { responseType: 'blob', headers: { Accept: 'application/gzip' } })
      saveFile(blob, file)
    } catch (error) {
      setProblem(`${table} could not be downloaded. ${errorMessage(error)}`)
    } finally {
      setDownloading(null)
    }
  }
  const tables = data?.manifest?.tables ?? []
  const manifestFile = `manifest-${exportId}.json`
  const columns: readonly DataTableColumn<(typeof tables)[number]>[] = [
    { key: 'table', header: 'Table', cell: (row) => <span className={MONO}>{row.name}</span> },
    { key: 'rows', header: 'Rows', align: 'end', cell: (row) => row.rows.toLocaleString() },
    { key: 'size', header: 'Size (bytes)', align: 'end', cell: (row) => row.bytes.toLocaleString() },
    { key: 'sha', header: 'SHA-256 of the file', cell: (row) => <span className={`${MONO} break-all`}>{row.sha256}</span> },
    {
      key: 'file', header: 'File', align: 'end', cell: (row) => data?.state === 'completed'
        ? <Button size="sm" icon="download" loading={downloading === row.name} aria-label={`Download ${row.file}`} onClick={() => void download(row.name, row.file)}>Download</Button>
        : '—',
    },
  ]
  return (
    <Drawer open onClose={onClose} title="Full data export" icon="inventory_2" width="lg"
      description={data === null ? undefined : `Snapshot ${formatDateTime(data.snapshot_at)} · ${count(data.total_rows)} rows in ${count(data.table_count)} tables`}>
      {detail.error !== null && <LoadFailure error={detail.error} onRetry={detail.reload} section />}
      {data === null && detail.error === null && <LoadingState label="Loading the export" />}
      {data !== null && (
        <>
          {data.state === 'expired' && <Banner tone="info" title="Files deleted">Only the {KEPT} latest completed exports keep their files. The manifest stays as the record.</Banner>}
          <Banner tone="warning">{ERASURE_NOTICE}</Banner>
          {problem !== null && <Banner tone="danger" title="No download">{problem}</Banner>}
          <p className={NOTE}>{`${tables.length} files, one per table, each gzip-compressed JSON Lines. Each row of the manifest names the file's rows, size and checksum.`}</p>
          <DataTable bare density="compact" caption="Manifest of the export" columns={columns} rows={tables} rowKey={(row) => row.name} empty={{ title: 'No manifest: the export did not complete' }} stackOnPhone />
          {data.signature !== null && (
            <section className="flex flex-col gap-space-xs" aria-labelledby="signature-title">
              <h3 id="signature-title" className={SECTION_HEADING}>Signature</h3>
              <code className={`${MONO} p-space-sm rounded bg-surface-container-low break-all`} data-testid="signature">{data.signature}</code>
              {data.manifest !== null && (
                <Button icon="file_download" className="self-start" onClick={() => saveFile(new Blob([canonicalJson(data.manifest)], { type: 'application/json' }), manifestFile)}>
                  Download manifest (JSON)
                </Button>
              )}
              {signing.error !== null && <LoadFailure error={signing.error} onRetry={signing.reload} section />}
              {signing.data !== null && <PublicKey signing={signing.data} manifestFile={manifestFile} />}
            </section>
          )}
        </>
      )}
    </Drawer>
  )
}

/** GET /v1/exports/model: the published tables, and what is left out and why. */
function DataModel() {
  const model = useResource<ExportModel>('/v1/exports/model')
  if (model.error !== null) return <LoadFailure error={model.error} onRetry={model.reload} section />
  if (model.data === null) return <LoadingState label="Loading the data model" />
  const { data } = model
  return (
    <div className="flex flex-col gap-space-md" data-testid="data-model">
      <p className={NOTE}>{`Model version ${data.version}: ${data.tables.length} tables are exported with the columns listed.`}</p>
      <DataTable bare density="compact" caption="Exported tables" stackOnPhone rowKey={(row) => `${row.schema}.${row.name}`} rows={data.tables} empty={{ title: 'No table' }}
        columns={[
          { key: 'name', header: 'Table', cell: (row) => <span className={MONO}>{row.schema === 'public' ? row.name : `${row.schema}.${row.name}`}</span> },
          { key: 'columns', header: 'Columns', cell: (row) => <span className={`${MONO} break-words`}>{row.columns.map((column) => column.name).join(', ')}</span> },
        ]} />
      <DataTable bare density="compact" caption="Tables left out" stackOnPhone rowKey={(row) => row.name} rows={data.excluded_tables} empty={{ title: 'No table is left out' }}
        columns={[{ key: 'name', header: 'Table left out', cell: (row) => <span className={MONO}>{row.name}</span> }, { key: 'reason', header: 'Reason', cell: (row) => row.reason }]} />
      <DataTable bare density="compact" caption="Columns left out" stackOnPhone rowKey={(row) => `${row.table}.${row.column}`} rows={data.excluded_columns} empty={{ title: 'No column is left out' }}
        columns={[{ key: 'column', header: 'Column left out', cell: (row) => <span className={MONO}>{`${row.table}.${row.column}`}</span> }, { key: 'reason', header: 'Reason', cell: (row) => row.reason }]} />
    </div>
  )
}

/** The Exports tab: schedule, Run export now (step-up), the exports with their detail drawer (?export=), the data model. */
export function ExportsTab() {
  const { readOnly } = useSession()
  const api = useApi()
  const toast = useToast()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const exports = useResource<FullExport[]>('/v1/exports', { limit: LIST_LIMIT }, inProgress)
  const signing = useResource<SigningKey>('/v1/exports/signing-key')
  const [running, setRunning] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [showModel, setShowModel] = useState(false)
  const opened = params.get('export')
  const openId = opened !== null && isUuid(opened) ? opened : null
  const open = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id === null) next.delete('export')
    else next.set('export', id)
    router.replace(`${pathname}?${next.toString()}`)
  }
  async function run() {
    setRunning(true)
    setProblem(null)
    try {
      await api.post('/v1/exports', {}, { idempotencyKey: newIdempotencyKey() })
      toast({ message: 'Export queued. It shows as completed here when its files are ready.' })
      exports.reload()
    } catch (error) {
      setProblem(isApiError(error, 'EXPORT_RUNNING') ? 'An export is already running. Wait for it to finish.' : errorMessage(error))
    } finally {
      setRunning(false)
    }
  }
  const rows = exports.data ?? []
  const columns: readonly DataTableColumn<FullExport>[] = [
    {
      key: 'requested', header: 'Requested', cell: (row) => (
        <span className="flex flex-col"><span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.created_at)}</span><span className="font-caption text-caption text-secondary">{row.trigger === 'schedule' ? 'On schedule' : 'Run by hand'}</span></span>
      ),
    },
    { key: 'state', header: 'State', cell: (row) => <StatusBadge {...STATE_BADGE[row.state]} /> },
    { key: 'snapshot', header: 'Snapshot', cell: (row) => <span className={`${MONO} whitespace-nowrap`}>{formatDateTime(row.snapshot_at)}</span> },
    { key: 'tables', header: 'Tables', align: 'end', cell: (row) => count(row.table_count) },
    { key: 'rows', header: 'Rows', align: 'end', cell: (row) => count(row.total_rows) },
    { key: 'note', header: 'Note', cell: (row) => (row.error === null ? (row.state === 'expired' ? 'Files deleted' : '—') : ERROR_LABELS[row.error.code] ?? row.error.code) },
    {
      key: 'open', header: 'Details', align: 'end', cell: (row) => row.state === 'queued' || row.state === 'running' ? '—'
        : <Button size="sm" icon="open_in_new" aria-label={`Open the export of ${formatDateTime(row.created_at)}`} onClick={() => open(row.id)}>Open</Button>,
    },
  ]
  return (
    <div className="flex flex-col gap-space-md">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
        <ScheduleCard />
        <section className={CARD} aria-labelledby="run-export-title">
          <div className="flex items-center gap-space-sm">
            <IconTile name="cloud_download" />
            <h2 id="run-export-title" className={SECTION_HEADING}>Run an export now</h2>
          </div>
          <p className={NOTE}>Generates one file per table from a single consistent snapshot, with a manifest signed by your tenant&apos;s key. It asks for your authenticator code.</p>
          {!readOnly && <Button variant="primary" icon="play_arrow" className="self-start" loading={running} data-testid="primary-action" onClick={() => void run()}>Run export now</Button>}
          {problem !== null && <Banner tone="danger" title="No export started">{problem}</Banner>}
        </section>
      </div>
      <Banner tone="warning">{ERASURE_NOTICE}</Banner>
      <section className="flex flex-col gap-space-sm" aria-labelledby="exports-title">
        <h2 id="exports-title" className={SECTION_HEADING}>Exports</h2>
        <p className={NOTE}>{`${rows.length} exports, newest first. The ${KEPT} latest completed exports keep their files; an older one expires and its files are deleted.`}</p>
        {exports.error !== null
          ? <LoadFailure error={exports.error} onRetry={exports.reload} section />
          : <DataTable caption="Full data exports" columns={columns} rows={rows} rowKey={(row) => row.id} loading={exports.loading} empty={{ title: 'No export yet: run one now or set a schedule' }} stackOnPhone />}
      </section>
      <section className="flex flex-col gap-space-sm" aria-labelledby="model-title">
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <h2 id="model-title" className={SECTION_HEADING}>Data model</h2>
          <Button icon={showModel ? 'expand_less' : 'expand_more'} aria-expanded={showModel} onClick={() => setShowModel((value) => !value)}>{showModel ? 'Hide the data model' : 'Show the data model'}</Button>
        </div>
        {showModel && <DataModel />}
      </section>
      {openId !== null && <ExportDrawer exportId={openId} signing={signing} onClose={() => open(null)} />}
    </div>
  )
}
