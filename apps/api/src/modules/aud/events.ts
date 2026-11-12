import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { decodeRefs } from '../../lib/audit.js'

/** FR-AUD-001 search: by actor, action, object and time range (from inclusive, to exclusive). */
export const auditFilterSchema = z.strictObject({
  actor_id: z.uuid().optional(),
  action: z.string().min(1).max(100).optional(),
  object_type: z.string().min(1).max(100).optional(),
  object_id: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
})

export type AuditFilter = z.infer<typeof auditFilterSchema>

interface EventRow {
  id: string
  seq: string
  occurred_at: Date
  actor_type: string
  actor_id: string | null
  support_session_id: string | null
  action: string
  object_type: string | null
  object_id: string | null
  before_ref: string | null
  after_ref: string | null
  request_id: string | null
  hash: string
}

export interface AuditEventView {
  id: string
  seq: string
  occurred_at: Date
  actor_type: string
  actor_id: string | null
  support_session_id: string | null
  action: string
  object_type: string | null
  object_id: string | null
  before: unknown
  after: unknown
  reason: string | null
  request_id: string | null
  hash: string
}

const COLUMNS = `id, seq, occurred_at, actor_type, actor_id, support_session_id, action, object_type, object_id,
  before_ref, after_ref, request_id, encode(hash, 'hex') AS hash`

// Each defined filter becomes one bound parameter; column names are fixed here, never taken from input.
function where(filter: AuditFilter, maxSeq: string | null, beforeSeq: string | null): { sql: string; params: unknown[] } {
  const conditions: [string, unknown][] = [
    ['actor_id = $?', filter.actor_id], ['action = $?', filter.action], ['object_type = $?', filter.object_type],
    ['object_id = $?', filter.object_id], ['occurred_at >= $?', filter.from], ['occurred_at < $?', filter.to],
    ['seq <= $?', maxSeq], ['seq < $?', beforeSeq],
  ]
  const present = conditions.filter(([, value]) => value !== undefined && value !== null)
  const sql = present.map(([condition], index) => condition.replace('$?', `$${index + 1}`)).join(' AND ')
  return { sql: sql === '' ? 'true' : sql, params: present.map(([, value]) => value) }
}

function toView(row: EventRow): AuditEventView {
  const { before_ref: beforeRef, after_ref: afterRef, ...rest } = row
  return { ...rest, ...decodeRefs(beforeRef, afterRef) }
}

/** The tenant's log (audit_event) or the vendor log (vendor_event, E-ADR-06): same columns, one chain each. */
export type AuditLog = 'audit.audit_event' | 'audit.vendor_event'

/**
 * Newest first; the cursor is the seq of the last event shown. RLS keeps a tenant caller in its tenant's log and
 * gives the vendor log to the vendor realm only.
 */
export async function listAuditEvents(
  tx: Tx, filter: AuditFilter, beforeSeq: string | undefined, limit: number, log: AuditLog = 'audit.audit_event',
): Promise<AuditEventView[]> {
  const clause = where(filter, null, beforeSeq ?? null)
  const { rows } = await tx.query<EventRow>(
    `SELECT ${COLUMNS} FROM ${log} WHERE ${clause.sql} ORDER BY seq DESC LIMIT $${clause.params.length + 1}`,
    [...clause.params, limit + 1],
  )
  return rows.map(toView)
}

/** The current head of the tenant's chain: an export pins its rows to seq <= this value. */
export async function headSeq(tx: Tx): Promise<string> {
  const { rows } = await tx.query<{ seq: string }>('SELECT coalesce(max(seq), 0) AS seq FROM audit.audit_event')
  return rows[0]!.seq
}

export async function countAuditEvents(tx: Tx, filter: AuditFilter, maxSeq: string): Promise<number> {
  const clause = where(filter, maxSeq, null)
  const { rows } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit.audit_event WHERE ${clause.sql}`, clause.params)
  return rows[0]!.n
}

/** All events of an export, oldest first. */
export async function exportedEvents(tx: Tx, filter: AuditFilter, maxSeq: string): Promise<AuditEventView[]> {
  const clause = where(filter, maxSeq, null)
  const { rows } = await tx.query<EventRow>(`SELECT ${COLUMNS} FROM audit.audit_event WHERE ${clause.sql} ORDER BY seq`, clause.params)
  return rows.map(toView)
}
