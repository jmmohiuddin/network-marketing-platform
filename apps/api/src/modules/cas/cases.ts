import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import type { CaseRecord, CaseState } from './types.js'

type EventKind = 'opened' | 'evidence_added' | 'assigned' | 'submitted' | 'approved' | 'rejected' | 'withdrawn'

const COLUMNS = `c.id, c.type, c.subject_type, c.subject_id, c.reason_code, c.state, c.payload, c.effect_preview, c.due_at,
  c.market_id, c.opened_by, c.assigned_to, c.submitted_by, c.submitted_at, c.decided_at, c.approval_id, c.created_at`

// node-postgres sends JS arrays as Postgres arrays: JSON values go as text and are cast.
const json = (value: unknown): string | null => (value === undefined || value === null ? null : JSON.stringify(value))

export interface NewCase {
  readonly type: string
  readonly subjectType: string
  readonly subjectId: string
  readonly reasonCode: string
  readonly payload: unknown
  readonly marketId: string | null
}

/** Opens a case by the acting user (case_file_insert_guard binds opened_by to app.user_id). */
export async function insertCase(tx: Tx, input: NewCase): Promise<CaseRecord> {
  const { rows } = await tx.query<CaseRecord>(
    `INSERT INTO case_file AS c (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by)
     VALUES (app_tenant_id(), $1, $2, $3, $4, 'open', $5::jsonb, $6, app_user_id()) RETURNING ${COLUMNS}`,
    [input.type, input.subjectType, input.subjectId, input.reasonCode, json(input.payload) ?? 'null', input.marketId],
  )
  return rows[0]!
}

/** One case; lock = FOR UPDATE, so transitions of one case run one at a time. */
export async function getCase(tx: Tx, id: string, lock: boolean): Promise<CaseRecord | null> {
  const { rows } = await tx.query<CaseRecord>(
    `SELECT ${COLUMNS} FROM case_file c WHERE c.id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  )
  return rows[0] ?? null
}

export interface CaseFilter {
  readonly type?: string | undefined
  readonly state?: CaseState | undefined
  readonly subject_type?: string | undefined
  readonly subject_id?: string | undefined
  readonly assigned_to?: string | undefined
  readonly overdue?: boolean | undefined
}

/** A readable type and the markets its read permission covers (null = all). */
export interface ReadableType {
  readonly type: string
  readonly markets: readonly string[] | null
}

/** Newest first, cases of readable types within each type's market scope. The cursor is the id of the last case shown. */
export async function listCases(
  tx: Tx, filter: CaseFilter, readable: readonly ReadableType[], afterId: string | undefined, limit: number,
): Promise<CaseRecord[]> {
  const params: unknown[] = [
    filter.type ?? null, filter.state ?? null, filter.subject_type ?? null, filter.subject_id ?? null,
    filter.assigned_to ?? null, filter.overdue ?? null, afterId ?? null, limit + 1,
  ]
  const scopes = readable.map(({ type, markets }) => {
    params.push(type)
    const typeParam = `$${params.length}`
    if (markets === null) return `c.type = ${typeParam}`
    params.push(markets)
    return `(c.type = ${typeParam} AND (c.market_id IS NULL OR c.market_id = ANY ($${params.length}::uuid[])))`
  })
  const { rows } = await tx.query<CaseRecord>(
    `SELECT ${COLUMNS} FROM case_file c
     WHERE (${scopes.join(' OR ')})
       AND ($1::text IS NULL OR c.type = $1) AND ($2::text IS NULL OR c.state = $2)
       AND ($3::text IS NULL OR c.subject_type = $3) AND ($4::uuid IS NULL OR c.subject_id = $4)
       AND ($5::uuid IS NULL OR c.assigned_to = $5)
       AND ($6::boolean IS NULL OR (c.state = 'submitted' AND c.due_at IS NOT NULL AND c.due_at < now()) = $6)
       AND ($7::uuid IS NULL OR (c.created_at, c.id) < (SELECT created_at, id FROM case_file WHERE id = $7))
     ORDER BY c.created_at DESC, c.id DESC LIMIT $8`,
    params,
  )
  return rows
}

export interface EvidenceView {
  readonly id: string
  readonly document_id: string
  readonly file_name: string | null
  readonly mime: string
  readonly size_bytes: number
  readonly note: string | null
  readonly added_by: string
  readonly added_at: Date
}

export async function caseEvidence(tx: Tx, caseId: string): Promise<EvidenceView[]> {
  const { rows } = await tx.query<EvidenceView>(
    `SELECT e.id, e.document_id, d.file_name, d.mime, d.size_bytes::int AS size_bytes, e.note, e.added_by, e.added_at
     FROM case_evidence e JOIN document d ON d.tenant_id = e.tenant_id AND d.id = e.document_id
     WHERE e.case_id = $1 ORDER BY e.added_at, e.id`,
    [caseId],
  )
  return rows
}

export interface EventView {
  readonly id: string
  readonly occurred_at: Date
  readonly actor_id: string | null
  readonly kind: EventKind
  readonly data: unknown
}

export async function caseEvents(tx: Tx, caseId: string): Promise<EventView[]> {
  const { rows } = await tx.query<EventView>(
    'SELECT id, occurred_at, actor_id, kind, data FROM case_event WHERE case_id = $1 ORDER BY occurred_at, id',
    [caseId],
  )
  return rows
}

/** SoD contributors other than the opener: the submitter and everyone who added evidence (PLAN B1 section 2.9). */
export async function contributors(tx: Tx, c: CaseRecord): Promise<string[]> {
  const { rows } = await tx.query<{ added_by: string }>('SELECT DISTINCT added_by FROM case_evidence WHERE case_id = $1', [c.id])
  return [...new Set([...(c.submitted_by === null ? [] : [c.submitted_by]), ...rows.map((row) => row.added_by)])]
}

export interface Change {
  readonly before?: unknown
  readonly after?: unknown
  readonly reason?: string
}

/** The case_event and the CASE.<KIND> audit event of one change, in the change's transaction (AC-CAS1-5). */
export async function recordChange(tx: Tx, caseId: string, kind: EventKind, data: unknown, change: Change = {}): Promise<void> {
  await tx.query(
    `INSERT INTO case_event (tenant_id, case_id, actor_id, kind, data) VALUES (app_tenant_id(), $1, app_user_id(), $2, $3::jsonb)`,
    [caseId, kind, json(data)],
  )
  await recordAudit(tx, { action: `CASE.${kind.toUpperCase()}`, objectType: 'case', objectId: caseId, ...change })
}

export async function hasEvidence(tx: Tx, caseId: string, documentId?: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    'SELECT 1 FROM case_evidence WHERE case_id = $1 AND ($2::uuid IS NULL OR document_id = $2) LIMIT 1',
    [caseId, documentId ?? null],
  )
  return rowCount === 1
}

export async function insertEvidence(tx: Tx, caseId: string, documentId: string, note: string | null): Promise<EvidenceView> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO case_evidence (tenant_id, case_id, document_id, note, added_by)
     VALUES (app_tenant_id(), $1, $2, $3, app_user_id()) RETURNING id`,
    [caseId, documentId, note],
  )
  const evidence = await caseEvidence(tx, caseId)
  return evidence.find((row) => row.id === rows[0]!.id)!
}

export async function setAssignee(tx: Tx, caseId: string, userId: string | null): Promise<CaseRecord> {
  const { rows } = await tx.query<CaseRecord>(
    `UPDATE case_file c SET assigned_to = $2 WHERE c.id = $1 RETURNING ${COLUMNS}`,
    [caseId, userId],
  )
  return rows[0]!
}

export async function markSubmitted(tx: Tx, caseId: string, preview: unknown, dueAt: Date | null): Promise<CaseRecord> {
  const { rows } = await tx.query<CaseRecord>(
    `UPDATE case_file c SET state = 'submitted', submitted_by = app_user_id(), submitted_at = now(),
       effect_preview = $2::jsonb, due_at = $3
     WHERE c.id = $1 RETURNING ${COLUMNS}`,
    [caseId, json(preview), dueAt],
  )
  return rows[0]!
}

export async function markDecided(tx: Tx, caseId: string, state: 'approved' | 'rejected', approvalId: string): Promise<CaseRecord> {
  const { rows } = await tx.query<CaseRecord>(
    `UPDATE case_file c SET state = $2, decided_at = now(), approval_id = $3 WHERE c.id = $1 RETURNING ${COLUMNS}`,
    [caseId, state, approvalId],
  )
  return rows[0]!
}

export async function markWithdrawn(tx: Tx, caseId: string): Promise<CaseRecord> {
  const { rows } = await tx.query<CaseRecord>(
    `UPDATE case_file c SET state = 'withdrawn', decided_at = now() WHERE c.id = $1 RETURNING ${COLUMNS}`,
    [caseId],
  )
  return rows[0]!
}
