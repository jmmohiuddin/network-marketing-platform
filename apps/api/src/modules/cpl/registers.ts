import type { Tx } from '@nmp/db'
import { notFound } from '../../lib/errors.js'

// FR-CPL-013 registers (D-BM-08, D-BM-09): read models over case_file and cpl_delisted, no names on the grievance side,
// only the pack rule's fields on the delisted side.

export type MarketScope = readonly string[] | null

export interface GrievanceFilter {
  readonly market_id?: string | undefined
  readonly state?: string | undefined
  readonly overdue?: 'ack' | 'resolution' | undefined
  readonly case_id?: string | undefined
}

export interface GrievanceRow {
  readonly case_id: string
  readonly market_id: string
  readonly subject: { type: string; id: string; external_ref: string | null }
  readonly category: string
  readonly channel: string
  readonly external_ref: string | null
  readonly received_at: string
  readonly ack_due_at: string
  readonly acknowledged_at: string | null
  readonly resolution_due_at: string
  readonly resolved_at: string | null
  readonly outcome: 'upheld' | 'not_upheld' | null
  readonly state: string
  readonly ack_overdue: boolean
  readonly resolution_overdue: boolean
  readonly escalated: string[]
  readonly rule_id: string
}

/** A market filter outside the caller's scope or tenant is answered as an unknown market. */
export async function assertMarket(tx: Tx, marketId: string, scope: MarketScope): Promise<void> {
  const { rowCount } = await tx.query('SELECT 1 FROM market WHERE id = $1', [marketId])
  if (rowCount !== 1 || (scope !== null && !scope.includes(marketId))) throw notFound()
}

// $1 market, $2 state, $3 overdue, $4 case id, $5 scope (NULL = all markets).
const GRIEVANCES = `
  WITH g AS (
    SELECT c.id AS case_id, c.market_id, jsonb_build_object('type', c.subject_type, 'id', c.subject_id,
             'external_ref', (SELECT x.external_ref FROM participant x WHERE c.subject_type = 'participant' AND x.id = c.subject_id)) AS subject,
           c.reason_code AS category, c.payload ->> 'channel' AS channel, c.payload ->> 'external_ref' AS external_ref,
           (c.payload ->> 'received_at')::timestamptz AS received, d.ack_due_at, c.submitted_at, d.resolution_due_at,
           CASE WHEN c.state IN ('approved', 'rejected') THEN c.decided_at END AS resolved_at,
           CASE c.state WHEN 'approved' THEN 'upheld' WHEN 'rejected' THEN 'not_upheld' END AS outcome, c.state,
           c.state = 'open' AND now() > d.ack_due_at AS ack_overdue,
           c.state IN ('open', 'submitted') AND now() > d.resolution_due_at AS resolution_overdue,
           ARRAY(SELECT e.data ->> 'deadline' FROM case_event e WHERE e.case_id = c.id AND e.kind = 'escalated'
                 ORDER BY e.occurred_at) AS escalated,
           d.rule_id
    FROM case_file c CROSS JOIN LATERAL cpl_grievance_deadlines(c.id) d
    WHERE c.type = 'grievance' AND ($1::uuid IS NULL OR c.market_id = $1) AND ($2::text IS NULL OR c.state = $2)
      AND ($4::uuid IS NULL OR c.id = $4) AND ($5::uuid[] IS NULL OR c.market_id = ANY ($5))
  )
  SELECT * FROM g
  WHERE ($3::text IS NULL OR ($3 = 'ack' AND ack_overdue) OR ($3 = 'resolution' AND resolution_overdue))`

const filterParams = (filter: GrievanceFilter, scope: MarketScope) =>
  [filter.market_id ?? null, filter.state ?? null, filter.overdue ?? null, filter.case_id ?? null, scope]

const VIEW = `case_id, market_id, subject, category, channel, external_ref, json_instant(received) AS received_at,
  json_instant(ack_due_at) AS ack_due_at, json_instant(submitted_at) AS acknowledged_at, json_instant(resolution_due_at) AS resolution_due_at,
  json_instant(resolved_at) AS resolved_at, outcome, state, ack_overdue, resolution_overdue, escalated, rule_id`

/** One page, newest received first; `after` is the last row's [received_at, case_id]. */
export async function grievancePage(
  tx: Tx, filter: GrievanceFilter, scope: MarketScope, after: readonly [string, string] | undefined, limit: number,
): Promise<GrievanceRow[]> {
  const { rows } = await tx.query<GrievanceRow>(
    `SELECT ${VIEW} FROM (${GRIEVANCES}) r
     WHERE ($6::timestamptz IS NULL OR (received, case_id) < ($6, $7::uuid))
     ORDER BY received DESC, case_id DESC LIMIT $8`,
    [...filterParams(filter, scope), after?.[0] ?? null, after?.[1] ?? null, limit + 1],
  )
  return rows
}

export async function grievanceCount(tx: Tx, filter: GrievanceFilter, scope: MarketScope): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${GRIEVANCES}) r`, filterParams(filter, scope))
  return rows[0]!.n
}

export async function grievanceRows(tx: Tx, filter: GrievanceFilter, scope: MarketScope): Promise<GrievanceRow[]> {
  const { rows } = await tx.query<GrievanceRow>(`SELECT ${VIEW} FROM (${GRIEVANCES}) r ORDER BY received DESC, case_id DESC`, filterParams(filter, scope))
  return rows
}

export const GRIEVANCE_CSV_HEADER = [
  'case_id', 'market_id', 'subject_type', 'subject_id', 'subject_external_ref', 'category', 'channel', 'external_ref', 'received_at',
  'ack_due_at', 'acknowledged_at', 'resolution_due_at', 'resolved_at', 'outcome', 'state', 'ack_overdue', 'resolution_overdue',
  'escalated', 'rule_id',
] as const

export const grievanceCsvRow = (r: GrievanceRow): unknown[] => [
  r.case_id, r.market_id, r.subject.type, r.subject.id, r.subject.external_ref, r.category, r.channel, r.external_ref, r.received_at,
  r.ack_due_at, r.acknowledged_at, r.resolution_due_at, r.resolved_at, r.outcome, r.state, r.ack_overdue, r.resolution_overdue,
  r.escalated.join(' '), r.rule_id,
]

/** The order the delisted register's fields are shown in; the pack rule picks which. */
export const DELISTED_FIELDS = ['external_ref', 'display_name', 'terminated_on'] as const
type DelistedField = (typeof DELISTED_FIELDS)[number]

export interface DelistedRule {
  readonly id: string
  readonly fields: DelistedField[]
  readonly window_days: number | null
  readonly basis_status: string
}

interface DelistedRow {
  readonly participant_id: string
  readonly external_ref: string
  readonly display_name: string | null
  readonly terminated_on: string
}

/** The market's delisted_register rule in force today (market zone), or null when the pack keeps none. */
export async function delistedRule(tx: Tx, marketId: string): Promise<{ rule: DelistedRule; today: string } | null> {
  const { rows } = await tx.query<{ id: string | null; params: { fields: DelistedField[]; window_days?: number } | null; basis_status: string; today: string }>(
    `SELECT r.id, r.params, r.basis_status, d.today::text AS today
     FROM market m CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE m.time_zone)::date AS today) d
     CROSS JOIN LATERAL market_pack_rule(m.id, 'delisted_register', d.today) r
     WHERE m.id = $1`,
    [marketId],
  )
  const row = rows[0]
  if (row === undefined || row.id === null || row.params === null) return null
  const fields = DELISTED_FIELDS.filter((field) => row.params!.fields.includes(field))
  return { rule: { id: row.id, fields, window_days: row.params.window_days ?? null, basis_status: row.basis_status }, today: row.today }
}

// $1 market, $2 today, $3 window days (NULL = no window).
const IN_WINDOW = '($3::int IS NULL OR d.terminated_on >= $2::date - $3::int)'

/**
 * Delisted participants within the rule's window, newest termination first; `after` is the last row's participant id
 * (its terminated_on and external_ref are read back here, so no field outside the rule reaches the cursor). A cursor
 * participant who is no longer delisted ends the listing; limit null = every row (export).
 */
export async function delistedRows(
  tx: Tx, marketId: string, today: string, rule: DelistedRule, after: string | undefined, limit: number | null,
): Promise<DelistedRow[]> {
  const { rows } = await tx.query<DelistedRow>(
    `WITH a AS (SELECT terminated_on, external_ref FROM cpl_delisted($1, $2::date) WHERE participant_id = $4)
     SELECT d.participant_id, d.external_ref, d.display_name, to_char(d.terminated_on, 'YYYY-MM-DD') AS terminated_on
     FROM cpl_delisted($1, $2::date) d LEFT JOIN a ON true
     WHERE ${IN_WINDOW}
       AND ($4::uuid IS NULL OR d.terminated_on < a.terminated_on OR (d.terminated_on = a.terminated_on AND d.external_ref > a.external_ref))
     ORDER BY d.terminated_on DESC, d.external_ref
     LIMIT $5`,
    [marketId, today, rule.window_days, after ?? null, limit === null ? null : limit + 1],
  )
  return rows
}

export async function delistedCount(tx: Tx, marketId: string, today: string, rule: DelistedRule): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM cpl_delisted($1, $2::date) d WHERE ${IN_WINDOW}`, [marketId, today, rule.window_days])
  return rows[0]!.n
}

/** Only the rule's fields leave the API (plus the participant id on the staff list, never in the CSV). */
export const delistedView = (row: DelistedRow, rule: DelistedRule): Record<string, string | null> =>
  Object.fromEntries([['participant_id', row.participant_id], ...rule.fields.map((field) => [field, row[field]])])
