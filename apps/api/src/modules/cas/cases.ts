import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import type { CaseRecord, CaseState } from './types.js'

type EventKind = 'opened' | 'evidence_added' | 'assigned' | 'submitted' | 'first_approved' | 'approved' | 'rejected' | 'withdrawn' | 'updated'
  | 'escalated'

const COLUMNS = `c.id, c.type, c.subject_type, c.subject_id, c.reason_code, c.state, c.payload, c.effect_preview, c.due_at,
  c.market_id, c.opened_by, c.opened_by_kind, c.assigned_to, c.submitted_by, c.submitted_at, c.decided_at, c.approval_id,
  c.first_approval_id, c.approvals_required, c.created_at`

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

/**
 * Opens a case by the acting user, or by the system (D-B2-04: opened_by NULL, kind system). case_file_insert_guard binds
 * a user opener to app.user_id and allows the system to open duplicates only.
 */
export async function insertCase(tx: Tx, input: NewCase, opener: 'user' | 'system' = 'user'): Promise<CaseRecord> {
  const { rows } = await tx.query<CaseRecord>(
    `INSERT INTO case_file AS c (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by,
       opened_by_kind)
     VALUES (app_tenant_id(), $1, $2, $3, $4, 'open', $5::jsonb, $6, CASE WHEN $7 = 'user' THEN app_user_id() END, $7)
     RETURNING ${COLUMNS}`,
    [input.type, input.subjectType, input.subjectId, input.reasonCode, json(input.payload) ?? 'null', input.marketId, opener],
  )
  return rows[0]!
}

/** The SoD preparer: the opener, or the submitter of a case the system opened (D-B2-04). */
export const preparerOf = (c: CaseRecord): string | null => c.opened_by ?? c.submitted_by

export async function updateCase(tx: Tx, caseId: string, reasonCode: string, payload: unknown): Promise<CaseRecord> {
  const { rows } = await tx.query<CaseRecord>(
    `UPDATE case_file c SET reason_code = $2, payload = $3::jsonb WHERE c.id = $1 RETURNING ${COLUMNS}`,
    [caseId, reasonCode, json(payload) ?? 'null'],
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

type ParticipantRef = { readonly id: string; readonly external_ref: string; readonly display_name: unknown }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isParticipantRef = (value: object): value is ParticipantRef =>
  'id' in value && 'external_ref' in value && 'display_name' in value && typeof value.id === 'string' && UUID.test(value.id)
  && typeof value.external_ref === 'string'

function participantIds(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) return []
  if (Array.isArray(value)) return value.flatMap(participantIds)
  return [...(isParticipantRef(value) ? [value.id] : []), ...Object.values(value).flatMap(participantIds)]
}

function withNames(value: unknown, names: ReadonlyMap<string, string | null>): unknown {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((item) => withNames(item, names))
  const mapped = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withNames(item, names)]))
  return isParticipantRef(value) && names.has(value.id) ? { ...mapped, display_name: names.get(value.id) ?? null } : mapped
}

/**
 * BUG-109 (D-B5-19): effect previews are immutable history that erasure cannot clear, so their participant refs store
 * {id, external_ref, display_name: null}; views put each ref's current display name there (null once erased). Refs
 * without the display_name key (the privacy subject) stay as stored. Names stored by previews before the fix are
 * replaced in views too.
 */
export async function withCurrentNames<T extends { readonly effect_preview: unknown }>(tx: Tx, records: readonly T[]): Promise<T[]> {
  const ids = [...new Set(records.flatMap((record) => participantIds(record.effect_preview)))]
  if (ids.length === 0) return [...records]
  const { rows } = await tx.query<{ participant_id: string; display_name: string | null }>(
    'SELECT participant_id, display_name FROM par_display($1::uuid[])', [ids])
  const names = new Map(rows.map((row) => [row.participant_id, row.display_name]))
  return records.map((record) => ({ ...record, effect_preview: withNames(record.effect_preview, names) }))
}

export interface CaseFilter {
  readonly type?: string | undefined
  readonly state?: CaseState | undefined
  readonly subject_type?: string | undefined
  readonly subject_id?: string | undefined
  readonly assigned_to?: string | undefined
  readonly overdue?: boolean | undefined
}

/** A readable type, the markets its read permission covers (null = all) and the type's relatedMarketSql. */
export interface ReadableType {
  readonly type: string
  readonly markets: readonly string[] | null
  readonly related?: string | undefined
}

/** The SQL condition "a readable type within its market scope"; its values are appended to params. */
function readableScope(readable: readonly ReadableType[], params: unknown[]): string {
  return readable.map(({ type, markets, related }) => {
    params.push(type)
    const typeParam = `$${params.length}`
    if (markets === null) return `c.type = ${typeParam}`
    params.push(markets)
    // A NULL market (none, or no related object) is in every holder's scope.
    const inScope = (market: string) => `coalesce(${market} = ANY ($${params.length}::uuid[]), true)`
    return `(c.type = ${typeParam} AND ${inScope('c.market_id')}${related === undefined ? '' : ` AND ${inScope(related)}`})`
  }).join(' OR ')
}

/** Newest first, cases of readable types within each type's market scope. The cursor is the id of the last case shown. */
export async function listCases(
  tx: Tx, filter: CaseFilter, readable: readonly ReadableType[], afterId: string | undefined, limit: number,
): Promise<CaseRecord[]> {
  const params: unknown[] = [
    filter.type ?? null, filter.state ?? null, filter.subject_type ?? null, filter.subject_id ?? null,
    filter.assigned_to ?? null, filter.overdue ?? null, afterId ?? null, limit + 1,
  ]
  const scope = readableScope(readable, params)
  const { rows } = await tx.query<CaseRecord>(
    `SELECT ${COLUMNS} FROM case_file c
     WHERE (${scope})
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

export interface CaseCounts {
  readonly type: string
  readonly open: number
  readonly submitted: number
  readonly overdue: number
  readonly decided_30d: number
}

/** SC-06 KPI cards: counts per readable type, within the type's market scope. */
export async function countCases(tx: Tx, readable: readonly ReadableType[]): Promise<CaseCounts[]> {
  const params: unknown[] = [readable.map((entry) => entry.type)]
  const scope = readableScope(readable, params)
  const { rows } = await tx.query<CaseCounts>(
    `SELECT t.type,
       count(c.id) FILTER (WHERE c.state = 'open')::int AS open,
       count(c.id) FILTER (WHERE c.state = 'submitted')::int AS submitted,
       count(c.id) FILTER (WHERE c.state = 'submitted' AND c.due_at < now())::int AS overdue,
       count(c.id) FILTER (WHERE c.state IN ('approved', 'rejected') AND c.decided_at > now() - interval '30 days')::int
         AS decided_30d
     FROM unnest($1::text[]) AS t (type)
     LEFT JOIN case_file c ON c.type = t.type AND (${scope})
     GROUP BY t.type ORDER BY t.type`,
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
    // The approvers excluded at submit stay out of the view: they name staff related to the case's subject (D-B4-11).
    `SELECT id, occurred_at, actor_id, kind, NULLIF(data - 'excluded_approvers', '{}') AS data FROM case_event WHERE case_id = $1 ORDER BY occurred_at, id`,
    [caseId],
  )
  return rows
}

/** The type's excluded approvers pinned at submit (D-B4-10), which a decision adds to the current ones. */
export async function pinnedExclusions(tx: Tx, caseId: string): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT jsonb_array_elements_text(data -> 'excluded_approvers') AS id FROM case_event WHERE case_id = $1 AND kind = 'submitted'`,
    [caseId],
  )
  return rows.map((row) => row.id)
}

/**
 * SoD contributors other than the opener: the submitter, everyone who added evidence (PLAN B1 section 2.9) and everyone
 * who changed the case (PATCH chose e.g. the proposed outcome, D-B2-10).
 */
export async function contributors(tx: Tx, c: CaseRecord): Promise<string[]> {
  const { rows } = await tx.query<{ user_id: string }>(
    `SELECT added_by AS user_id FROM case_evidence WHERE case_id = $1
     UNION SELECT actor_id FROM case_event WHERE case_id = $1 AND kind = 'updated' AND actor_id IS NOT NULL`,
    [c.id],
  )
  return [...new Set([...(c.submitted_by === null ? [] : [c.submitted_by]), ...rows.map((row) => row.user_id)])]
}

export interface Change {
  readonly before?: unknown
  readonly after?: unknown
  readonly reason?: string
}

/**
 * The case_event and the CASE.<KIND> audit event of one change, in the change's transaction (AC-CAS1-5). The event's
 * actor is the acting user; NULL for the system and for actors that are not users, such as a service account (D-B2-03).
 */
export async function recordChange(
  tx: Tx, caseId: string, kind: EventKind, data: unknown, change: Change = {}, actor: 'acting' | 'system' = 'acting',
): Promise<void> {
  await tx.query(
    `INSERT INTO case_event (tenant_id, case_id, actor_id, kind, data)
     VALUES (app_tenant_id(), $1, CASE WHEN $4 = 'acting' AND app_actor_type() = 'user' THEN app_user_id() END, $2, $3::jsonb)`,
    [caseId, kind, json(data), actor],
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

export async function markSubmitted(tx: Tx, caseId: string, preview: unknown, dueAt: Date | null, approvalsRequired: 1 | 2): Promise<CaseRecord> {
  const { rows } = await tx.query<CaseRecord>(
    `UPDATE case_file c SET state = 'submitted', submitted_by = app_user_id(), submitted_at = now(),
       effect_preview = $2::jsonb, due_at = $3, approvals_required = $4
     WHERE c.id = $1 RETURNING ${COLUMNS}`,
    [caseId, json(preview), dueAt, approvalsRequired],
  )
  return rows[0]!
}

/** D-B4-10: the first of two approvals; the case stays submitted. */
export async function markFirstApproved(tx: Tx, caseId: string, approvalId: string): Promise<CaseRecord> {
  const { rows } = await tx.query<CaseRecord>(`UPDATE case_file c SET first_approval_id = $2 WHERE c.id = $1 RETURNING ${COLUMNS}`, [caseId, approvalId])
  return rows[0]!
}

export interface FirstApproval { readonly approver: { readonly id: string; readonly display_name: string | null }; readonly decided_at: Date }

/** The first approvals of cases, by approval id. */
export async function firstApprovals(tx: Tx, approvalIds: readonly string[]): Promise<Map<string, FirstApproval>> {
  if (approvalIds.length === 0) return new Map()
  const { rows } = await tx.query<{ id: string; approver_id: string; display_name: string | null; decided_at: Date }>(
    `SELECT a.id, a.approver_id, u.display_name, a.decided_at
     FROM approval a JOIN user_account u ON u.tenant_id = a.tenant_id AND u.id = a.approver_id WHERE a.id = ANY ($1::uuid[])`,
    [approvalIds],
  )
  return new Map(rows.map((r) => [r.id, { approver: { id: r.approver_id, display_name: r.display_name }, decided_at: r.decided_at }]))
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
