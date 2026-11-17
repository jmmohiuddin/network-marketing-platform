import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { withSqlErrors } from './errors.js'
import { CURRENT } from './read-model.js'

interface PositionRow {
  id: string
  position_ref: string
  market: { id: string; code: string }
  brand_id: string | null
  status: string
  status_from: Date
}

interface OwnershipRow {
  participant: { id: string; external_ref: string; display_name: string | null }
  valid_from: Date
  valid_to: Date | null
  case_id: string | null
  current: boolean
}

interface ParentRow {
  kind: 'sponsor' | 'placement'
  position_id: string
  position_ref: string
  /** Microsecond UTC text: a correction "from the current parent's start" sends it back and must match the row exactly. */
  valid_from: string
  leg: string | null
}

/** The position's market and status, locked for a status change; null when the tenant has no such position. */
export async function lockPositionStatus(tx: Tx, id: string): Promise<{ market_id: string; status: string } | null> {
  const { rows } = await tx.query<{ market_id: string; status: string }>(
    'SELECT market_id, status FROM position WHERE id = $1 FOR UPDATE', [id])
  return rows[0] ?? null
}

/** GET /v1/positions/:id (PLAN B2 2.5): the position, its owners over time, status history and current parents. */
export async function positionDetail(tx: Tx, id: string) {
  const { rows } = await tx.query<PositionRow>(
    `SELECT p.id, p.position_ref, jsonb_build_object('id', m.id, 'code', m.code) AS market, p.brand_id, p.status, p.status_from
     FROM position p JOIN market m ON m.tenant_id = p.tenant_id AND m.id = p.market_id WHERE p.id = $1`,
    [id],
  )
  const position = rows[0]
  if (position === undefined) return null
  const ownership = await tx.query<OwnershipRow>(
    `SELECT jsonb_build_object('id', o.participant_id, 'external_ref', d.external_ref, 'display_name', d.display_name) AS participant,
       o.valid_from, o.valid_to, o.case_id, o.valid_from <= now() AND (o.valid_to IS NULL OR o.valid_to > now()) AS current
     FROM position_ownership o LEFT JOIN LATERAL par_display(ARRAY[o.participant_id]) d ON true
     WHERE o.position_id = $1 ORDER BY o.valid_from, o.id`,
    [id],
  )
  const history = await tx.query(
    `SELECT from_status, to_status, effective_from, reason, case_id, recorded_at FROM position_status_history
     WHERE position_id = $1 ORDER BY effective_from, recorded_at, id`,
    [id],
  )
  const parents = await tx.query<ParentRow>(
    `SELECT r.kind, r.parent_position_id AS position_id, p.position_ref,
       to_char(r.valid_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS valid_from, r.leg
     FROM relationship r JOIN position p ON p.id = r.parent_position_id
     WHERE r.child_position_id = $1 AND ${CURRENT('r')}`,
    [id],
  )
  const parent = (kind: ParentRow['kind']) => {
    const row = parents.rows.find((candidate) => candidate.kind === kind)
    if (row === undefined) return null
    const base = { position_id: row.position_id, position_ref: row.position_ref, valid_from: row.valid_from }
    return kind === 'placement' ? { ...base, leg: row.leg } : base
  }
  const owner = ownership.rows.find((row) => row.current)?.participant
  return {
    ...position,
    owner: owner === undefined ? null : { participant_id: owner.id, external_ref: owner.external_ref, display_name: owner.display_name },
    ownership: ownership.rows.map(({ current: _current, ...row }) => row),
    status_history: history.rows,
    parents: { sponsor: parent('sponsor'), placement: parent('placement') },
  }
}

export interface StatusChange {
  readonly status: 'active' | 'suspended' | 'terminated'
  readonly effectiveFrom: string
  readonly reason: string
}

/**
 * FR-PAR-005 through G5: the dated status change with its history row; a termination reassigns the position's
 * customers in the same transaction (FR-CRM-002). Relationships are never touched (BR-GEN-07). Audited here.
 */
export async function changeStatus(tx: Tx, id: string, change: StatusChange): Promise<number> {
  const { rows: before } = await tx.query<{ status: string }>('SELECT status FROM position WHERE id = $1', [id])
  const { rows } = await withSqlErrors(() => tx.query<{ reassigned: number }>(
    'SELECT gen_set_position_status($1, $2, $3, $4, NULL) AS reassigned',
    [id, change.status, change.effectiveFrom, change.reason],
  ))
  const reassigned = rows[0]!.reassigned
  await recordAudit(tx, {
    action: 'POSITION.STATUS_CHANGED', objectType: 'position', objectId: id, reason: change.reason,
    before: { status: before[0]?.status ?? null },
    after: { status: change.status, effective_from: change.effectiveFrom, reassigned_customers: reassigned },
  })
  if (reassigned > 0) {
    await recordAudit(tx, {
      action: 'SERVICING.REASSIGNED', objectType: 'position', objectId: id,
      after: { position_id: id, customers: reassigned, effective_from: change.effectiveFrom },
    })
  }
  return reassigned
}
