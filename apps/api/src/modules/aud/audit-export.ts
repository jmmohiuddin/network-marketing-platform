import type { Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { toCsv } from '../../lib/csv.js'
import { notFound } from '../../lib/errors.js'
import { recordExport, type ExportDecision } from '../../lib/exports.js'
import { auditFilterSchema, countAuditEvents, exportedEvents, headSeq, type AuditFilter } from './events.js'

export const AUDIT_EXPORT_KIND = 'audit_events'

/** The stored filters: the user's filters plus max_seq, so every download of an export has the same rows. */
const storedFilters = auditFilterSchema.extend({ max_seq: z.string().regex(/^\d+$/) })

/** FR-AUD-002: an export of the audit log, capped (E-ADR-10), logged with actor, filters and row count. */
export async function createAuditExport(tx: Tx, filter: AuditFilter, rowCap: number): Promise<ExportDecision> {
  const maxSeq = await headSeq(tx)
  const rowCount = await countAuditEvents(tx, filter, maxSeq)
  return recordExport(tx, { kind: AUDIT_EXPORT_KIND, filters: { ...filter, max_seq: maxSeq }, rowCount, rowCap })
}

const HEADER = [
  'seq', 'occurred_at', 'actor_type', 'actor_id', 'support_session_id', 'action', 'object_type', 'object_id',
  'before', 'after', 'reason', 'request_id', 'hash', 'watermark',
]

export interface AuditExportFile {
  readonly filename: string
  readonly csv: string
}

/**
 * The CSV of one of the caller's own exports (others get 404). Every row carries a watermark naming the
 * export and the requester (FR-AUD-002); every download is audited.
 */
export async function downloadAuditExport(tx: Tx, exportId: string): Promise<AuditExportFile> {
  const { rows } = await tx.query<{ filters: unknown; requested_by: string }>(
    `SELECT filters, requested_by FROM export_job
     WHERE id = $1 AND kind = $2 AND requested_by = current_setting('app.user_id')::uuid`,
    [exportId, AUDIT_EXPORT_KIND],
  )
  if (rows[0] === undefined) throw notFound()
  const { max_seq: maxSeq, ...filter } = storedFilters.parse(rows[0].filters)
  const events = await exportedEvents(tx, filter, maxSeq)
  const watermark = `export ${exportId} for user ${rows[0].requested_by}`
  const csv = toCsv(HEADER, events.map((event) => [
    event.seq, event.occurred_at, event.actor_type, event.actor_id, event.support_session_id, event.action,
    event.object_type, event.object_id, event.before, event.after, event.reason, event.request_id, event.hash, watermark,
  ]))
  await recordAudit(tx, { action: 'EXPORT.DOWNLOADED', objectType: 'export_job', objectId: exportId, after: { row_count: events.length } })
  return { filename: `audit-export-${exportId}.csv`, csv }
}
