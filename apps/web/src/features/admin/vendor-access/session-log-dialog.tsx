'use client'

import { Dialog } from '../../../components/dialog'
import { Table, type TableColumn } from '../../../components/table'
import { formatDateTime, shortId } from '../format'
import { tableError, usePagedList } from '../resource'
import type { AuditEvent, SupportSession } from '../types'

interface AccessDetails {
  readonly method?: unknown
  readonly route?: unknown
  readonly refusal?: unknown
  readonly by?: unknown
}

/** What a log entry did: the request of an access, the refusal code, or who ended the session. */
export function logDetails(event: Pick<AuditEvent, 'after'>): string {
  if (event.after === null || typeof event.after !== 'object') return ''
  const after = event.after as AccessDetails
  const request = typeof after.method === 'string' && typeof after.route === 'string' ? `${after.method} ${after.route}` : ''
  if (typeof after.refusal === 'string') return `Refused (${after.refusal})${request === '' ? '' : `: ${request}`}`
  if (typeof after.by === 'string') return `By ${after.by}`
  return request
}

const COLUMNS: readonly TableColumn<AuditEvent>[] = [
  { key: 'time', header: 'Time', cell: (event) => formatDateTime(event.occurred_at) },
  { key: 'action', header: 'Action', cell: (event) => event.action },
  { key: 'object', header: 'Object', cell: (event) => (event.object_type === null ? '—' : `${event.object_type}${event.object_id === null ? '' : ` ${shortId(event.object_id)}`}`) },
  { key: 'details', header: 'Details', cell: logDetails },
]

/** SC-14 per-session log (AC-29.1, SEC-37): every event written in the session or about it, newest first. */
export function SessionLogDialog({ session, onClose }: { readonly session: SupportSession; readonly onClose: () => void }) {
  const log = usePagedList<AuditEvent>(`/v1/support-sessions/${session.id}/log`)
  return (
    <Dialog open onClose={onClose} title="Support session log" size="lg">
      <p>Reason given: {session.reason}</p>
      <Table
        caption="Every screen view, query and decision of this session, newest first"
        columns={COLUMNS}
        rows={log.rows}
        rowKey={(event) => event.seq}
        loading={log.loading}
        error={tableError(log)}
        empty={{ title: 'Nothing has been logged for this session yet.' }}
        pagination={log.pagination}
        density="compact"
      />
    </Dialog>
  )
}
