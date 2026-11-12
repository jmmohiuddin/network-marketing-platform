'use client'

import { useState } from 'react'
import { useApi } from '../../../components/api-provider'
import { Banner } from '../../../components/banner'
import { Button, buttonClass } from '../../../components/button'
import { Modal } from '../../../components/modal'
import { isApiError } from '../../../lib/api'
import { errorMessage } from '../../../lib/messages'
import { useIdempotencyKey } from '../resource'
import type { AuditExport } from '../types'
import type { AuditFilters } from './audit-filters'

type Outcome =
  | { readonly kind: 'ready'; readonly file: AuditExport }
  | { readonly kind: 'refused'; readonly rowCount: number | null; readonly rowCap: number | null }

const NUMBER = new Intl.NumberFormat()

function countOf(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/** The refusal of an export above the row cap (EXPORT_ROW_CAP_EXCEEDED, FR-AUD-002), or null for other errors. */
export function refusalOf(error: unknown): Outcome | null {
  if (!isApiError(error, 'EXPORT_ROW_CAP_EXCEEDED')) return null
  const details = (error.details ?? {}) as { row_count?: unknown; row_cap?: unknown }
  return { kind: 'refused', rowCount: countOf(details.row_count), rowCap: countOf(details.row_cap) }
}

function RefusedText({ rowCount, rowCap }: { readonly rowCount: number | null; readonly rowCap: number | null }) {
  const size = rowCount === null ? 'This export is larger than the row limit' : `This export would have ${NUMBER.format(rowCount)} rows`
  const cap = rowCap === null ? '' : `; the limit is ${NUMBER.format(rowCap)} rows`
  return <>{size}{cap}. Nothing was exported. Narrow the filters, for example to a shorter time range, and export again.</>
}

/**
 * SC-30 export (FR-AUD-002): POST /v1/audit-exports with the applied filters. Above the row cap the API refuses
 * and records the attempt; within it the CSV (watermarked with the requester) is downloaded from its own URL.
 */
export function AuditExportDialog({ filters, onClose }: { readonly filters: AuditFilters; readonly onClose: () => void }) {
  const api = useApi()
  const idempotencyKey = useIdempotencyKey()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  async function run() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post<AuditExport>('/v1/audit-exports', { filters }, { idempotencyKey })
      setOutcome({ kind: 'ready', file: data })
    } catch (failure) {
      const refused = refusalOf(failure)
      if (refused === null) setError(errorMessage(failure))
      else setOutcome(refused)
    } finally {
      setBusy(false)
    }
  }
  const filterCount = Object.keys(filters).length
  const footer = outcome === null
    ? (
      <>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={run}>Export events</Button>
      </>
    )
    : <Button onClick={onClose}>Close</Button>
  return (
    <Modal open onClose={busy ? () => undefined : onClose} title="Export audit events" size="sm" footer={footer}>
      {outcome === null && (
        <>
          <p>{filterCount === 0 ? 'The export contains every event of the audit log.' : `The export contains the events that match ${filterCount === 1 ? 'the filter' : `the ${filterCount} filters`} applied.`}</p>
          <p>The export is recorded in the audit log with your name, the filters and the row count, and every row names you.</p>
          {error !== null && <Banner tone="danger">{error}</Banner>}
        </>
      )}
      {outcome?.kind === 'ready' && (
        <>
          <Banner tone="success" title="Export ready">{NUMBER.format(Number(outcome.file.row_count))} events. Each download is recorded too.</Banner>
          <a className={buttonClass('primary')} href={outcome.file.download} download>Download CSV</a>
        </>
      )}
      {outcome?.kind === 'refused' && (
        <Banner tone="warning" title="Too many rows to export">
          <RefusedText rowCount={outcome.rowCount} rowCap={outcome.rowCap} />
        </Banner>
      )}
    </Modal>
  )
}
