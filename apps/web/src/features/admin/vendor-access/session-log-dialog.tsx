'use client'

import { Modal } from '../../../components/modal'
import { DataTable, type DataTableColumn } from '../../../components/data-table'
import { formatDateTime, shortId } from '../format'
import { tableError, usePagedList } from '../resource'
import type { AuditEvent, SupportSession } from '../types'
import { MONO, NOTE } from '../ui'

interface AccessDetails {
  readonly method?: unknown
  readonly route?: unknown
  readonly params?: unknown
  readonly query?: unknown
  readonly refusal?: unknown
  readonly by?: unknown
}

const ROUTE_PARAM = /:([A-Za-z_]\w*)/g

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The path actually asked for: the route pattern with the recorded params filled in, then the recorded query. */
export function requestedPath(route: string, params: unknown, query: unknown): string {
  const values = isRecord(params) ? params : {}
  const path = route.replace(ROUTE_PARAM, (pattern, name: string) => (typeof values[name] === 'string' ? values[name] : pattern))
  const pairs = isRecord(query)
    ? Object.entries(query).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).filter((item) => typeof item === 'string').map((item) => `${key}=${item}`))
    : []
  return pairs.length === 0 ? path : `${path}?${pairs.join('&')}`
}

/** What a log entry did: the request of an access, the refusal code, or who ended the session. */
export function logDetails(event: Pick<AuditEvent, 'after'>): string {
  if (event.after === null || typeof event.after !== 'object') return ''
  const after = event.after as AccessDetails
  const request = typeof after.method === 'string' && typeof after.route === 'string' ? `${after.method} ${requestedPath(after.route, after.params, after.query)}` : ''
  if (typeof after.refusal === 'string') return `Refused (${after.refusal})${request === '' ? '' : `: ${request}`}`
  if (typeof after.by === 'string') return `By ${after.by}`
  return request
}

const COLUMNS: readonly DataTableColumn<AuditEvent>[] = [
  { key: 'time', header: 'Time', cell: (event) => <span className={MONO}>{formatDateTime(event.occurred_at)}</span> },
  { key: 'action', header: 'Action', cell: (event) => event.action },
  { key: 'object', header: 'Object', cell: (event) => (event.object_type === null ? '—' : `${event.object_type}${event.object_id === null ? '' : ` ${shortId(event.object_id)}`}`) },
  { key: 'details', header: 'Details', cell: (event) => <span className={MONO}>{logDetails(event)}</span> },
]

/** SC-14 per-session log (AC-29.1, SEC-37): every event written in the session or about it, newest first. */
export function SessionLogDialog({ session, onClose }: { readonly session: SupportSession; readonly onClose: () => void }) {
  const log = usePagedList<AuditEvent>(`/v1/support-sessions/${session.id}/log`)
  return (
    <Modal open onClose={onClose} title="Support session log" size="lg">
      <p className={NOTE}>Reason given: {session.reason}</p>
      <DataTable
        bare
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
    </Modal>
  )
}
