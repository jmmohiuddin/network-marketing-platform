'use client'

import { useState } from 'react'
import { useApi } from '../../components/api-provider'
import { Banner } from '../../components/banner'
import { Button } from '../../components/button'
import { DataTable } from '../../components/data-table'
import { Select } from '../../components/form-field'
import { StatusBadge } from '../../components/status-badge'
import { NotAvailable } from '../../components/states'
import { useToast } from '../../components/toast'
import { isApiError } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { errorMessage, isNotAvailable } from '../../lib/messages'
import { useSession } from '../../lib/session'
import { tableError, usePagedList } from '../admin/resource'
import { holdText, refusalText, sourceText } from './format'
import { useConnectorNames } from './order-inspector'
import type { InboundEvent } from './types'

const STATES = [{ value: 'held', label: 'Held' }, { value: 'rejected', label: 'Rejected' }]

function reasonOf(event: InboundEvent): string {
  if (event.hold_reason !== null) return holdText(event.hold_reason, event.hold_ref)
  return event.result?.error === undefined ? '—' : refusalText(event.result.error.code)
}

function Queue({ state }: { readonly state: string }) {
  const api = useApi()
  const toast = useToast()
  const { can, readOnly } = useSession()
  const list = usePagedList<InboundEvent>('/v1/inbound-events', { state })
  const connectorNames = useConnectorNames()
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const canRetry = !readOnly && can('product.manage')
  async function retry(event: InboundEvent) {
    setBusy(event.id)
    setProblem(null)
    try {
      const { data } = await api.post<{ state: string; result: InboundEvent['result'] }>(`/v1/inbound-events/${event.id}/retry`, {})
      if (data.state === 'rejected') setProblem(`The retry was refused: ${refusalText(data.result?.error?.code)}.`)
      else toast({ message: data.state === 'processed' ? 'Processed: the order or event is recorded.' : 'Still held: the missing data has not arrived yet.' })
      list.reload()
    } catch (error) {
      setProblem(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }
  // C-B2-23: market-scoped readers are refused the tenant-wide queue; a retry cannot change that.
  if (isNotAvailable(list.error) || isApiError(list.error, 'SCOPE_NOT_HELD')) return <NotAvailable section />
  return (
    <div className="flex flex-col gap-space-sm">
      {problem !== null && <Banner tone="danger">{problem}</Banner>}
      <DataTable
        caption="Inbound exception queue"
        columns={[
          { key: 'received', header: 'Received', cell: (row) => formatDateTime(row.received_at) },
          { key: 'source', header: 'Source', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm break-all">{sourceText(row.source, connectorNames)}</span> },
          { key: 'key', header: 'Natural key', cell: (row) => <span className="font-data-mono-sm text-data-mono-sm break-all">{row.idempotency_key}</span> },
          { key: 'reason', header: 'Reason', cell: reasonOf },
          { key: 'attempts', header: 'Attempts', align: 'end', cell: (row) => row.attempts },
          { key: 'state', header: 'State', cell: (row) => <StatusBadge state={row.state} /> },
          ...(canRetry && state === 'held' ? [{
            key: 'action', header: 'Action', cell: (row: InboundEvent) => (
              <Button size="sm" icon="replay" aria-label={`Retry ${row.idempotency_key}`} loading={busy === row.id} onClick={() => retry(row)}>Retry</Button>
            ),
          }] : []),
        ]}
        rows={list.rows}
        rowKey={(row) => row.id}
        loading={list.loading}
        error={tableError(list)}
        empty={{ title: state === 'held' ? 'Nothing is held' : 'Nothing was rejected' }}
        pagination={list.pagination}
      />
    </div>
  )
}

/** SC-31 Exception queue: held and rejected inbound orders and events (tenant-wide, all-markets readers only). */
export function ExceptionsTab() {
  const [state, setState] = useState('held')
  return (
    <div className="flex flex-col gap-space-md">
      <div className="max-w-xs">
        <Select label="Show" value={state} options={STATES} onChange={(event) => setState(event.target.value)} />
      </div>
      <Queue key={state} state={state} />
    </div>
  )
}
