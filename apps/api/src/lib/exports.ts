import type { Tx } from '@nmp/db'
import { recordAudit } from './audit.js'

/** What an export would contain, checked against the row cap before anything is produced (FR-AUD-002). */
export interface ExportRequest {
  /** export_job.kind, e.g. 'audit_events' or 'compliance_rows'. */
  readonly kind: string
  /** The filters as the user gave them, plus whatever pins the result (for example a max seq). No personal data. */
  readonly filters: Record<string, unknown>
  readonly rowCount: number
  /** Config.exportRowCap (E-ADR-10). shortcut: one cap for every role; per-role caps when the product sets them. */
  readonly rowCap: number
}

export interface ExportJob {
  id: string
  kind: string
  filters: Record<string, unknown>
  row_count: string
  destination: string
  state: string
  created_at: Date
}

export type ExportDecision = { readonly refused: true; readonly rowCount: number; readonly rowCap: number } | {
  readonly refused: false
  readonly job: ExportJob
}

/**
 * Records an export in the caller's tenant transaction: within the cap it writes export_job (destination =
 * the tenant's region, TS-57) and EXPORT.CREATED; above the cap it writes only EXPORT.REFUSED. Either way
 * the audit event names the actor, view (kind), filters and row count (AC-54.1). The caller commits the
 * transaction in both cases and answers a refusal with 422 EXPORT_ROW_CAP_EXCEEDED.
 */
export async function recordExport(tx: Tx, request: ExportRequest): Promise<ExportDecision> {
  const audited = { kind: request.kind, filters: request.filters, row_count: request.rowCount }
  if (request.rowCount > request.rowCap) {
    await recordAudit(tx, { action: 'EXPORT.REFUSED', objectType: 'export_job', after: { ...audited, row_cap: request.rowCap } })
    return { refused: true, rowCount: request.rowCount, rowCap: request.rowCap }
  }
  const { rows } = await tx.query<ExportJob>(
    `INSERT INTO export_job (tenant_id, kind, filters, row_count, destination, requested_by, state, created_by)
     SELECT t.id, $1, $2, $3, t.region, current_setting('app.user_id')::uuid, 'ready', current_setting('app.user_id')::uuid
     FROM tenant t WHERE t.id = app_tenant_id()
     RETURNING id, kind, filters, row_count, destination, state, created_at`,
    [request.kind, request.filters, request.rowCount],
  )
  const job = rows[0]!
  await recordAudit(tx, { action: 'EXPORT.CREATED', objectType: 'export_job', objectId: job.id, after: audited })
  return { refused: false, job }
}
