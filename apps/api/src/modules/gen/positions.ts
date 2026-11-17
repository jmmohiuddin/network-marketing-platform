import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { assertPositionsLimit } from '../par/index.js'
import { structuralRules } from '../ten/index.js'
import { sqlError, withSqlErrors } from './errors.js'
import { CURRENT, validKnownAt, type Kind } from './read-model.js'

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
  /** W-B3-8: how the row was made (enrolment, change, correction, rule, migration) and the plan rule behind a 'rule' row. */
  event_type: string
  rule_id: string | null
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
       to_char(r.valid_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS valid_from, r.leg, r.event_type, r.rule_id
     FROM relationship r JOIN position p ON p.id = r.parent_position_id
     WHERE r.child_position_id = $1 AND ${CURRENT('r')}`,
    [id],
  )
  const parent = (kind: ParentRow['kind']) => {
    const row = parents.rows.find((candidate) => candidate.kind === kind)
    if (row === undefined) return null
    const base = { position_id: row.position_id, position_ref: row.position_ref, valid_from: row.valid_from, event_type: row.event_type, rule_id: row.rule_id }
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

export interface Reparented {
  readonly position_id: string
  readonly tree: Kind
  readonly rule_id: string
}

/** A row under the terminated position that a re-parenting rule moves, from `from_at` = greatest(T, its valid_from). */
interface RowUnder {
  readonly id: string
  readonly child: string
  readonly leg: string | null
  readonly from_at: string
  /** Open and started before T: G2's 'rule' write closes it at T. */
  readonly open_before: boolean
}

/**
 * A 'rule' row G2 cannot write (its 'rule' event only closes the child's open row): the row ends at a pending change, or
 * starts after a backdated termination. As G2's correction write: the row is superseded, its part before `from_at` kept,
 * and [from_at, its valid_to) goes to the new parent; the guard trigger checks overlap, leg and cycle under the tree lock.
 */
async function moveSegment(tx: Tx, tree: Kind, row: RowUnder, parent: string, ruleId: string): Promise<void> {
  const { rowCount } = await tx.query(`SELECT 1 FROM position WHERE id = $1 AND status <> 'terminated'`, [parent])
  if (rowCount !== 1) throw sqlError({ code: 'GN004' })!
  await tx.query('UPDATE relationship SET superseded_at = now() WHERE id = $1', [row.id])
  const copy = 'tenant_id, kind, parent_position_id, child_position_id, leg, valid_from, valid_to, event_type, case_id, rule_id'
  await withSqlErrors(() => tx.query(
    `INSERT INTO relationship (${copy})
     SELECT tenant_id, kind, parent_position_id, child_position_id, leg, valid_from, $2, event_type, case_id, rule_id
     FROM relationship WHERE id = $1 AND valid_from < $2::timestamptz`,
    [row.id, row.from_at],
  ))
  await withSqlErrors(() => tx.query(
    `INSERT INTO relationship (${copy})
     SELECT tenant_id, kind, $3, child_position_id, leg, $2, valid_to, 'rule', NULL, $4 FROM relationship WHERE id = $1`,
    [row.id, row.from_at, parent, ruleId],
  ))
  await enqueueOutbox(tx, {
    type: 'genealogy.changed', key: row.child,
    payload: { kind: tree, child_position_id: row.child, valid_from: row.from_at, event_type: 'rule' },
  })
}

/**
 * D-B3-07 / FR-GEN-009: each reparent_on_termination rule in force moves the terminated position's direct children in
 * its tree to the position's parent at the termination instant T (event 'rule', the rule id as approver): every row
 * under it still valid after T moves from greatest(T, its start), so a backdated termination also moves children that
 * joined after T, and a child's pending change keeps its date. Without a rule nothing moves (BR-GEN-07); a root position
 * has no parent to move them to, so its children stay.
 * shortcut: placement children keep their leg and a taken leg refuses the termination (409 GEN_SLOT_TAKEN); place them
 * by the auto rule when a plan uses placement re-parenting with legs.
 */
async function reparentOnTermination(tx: Tx, id: string, effectiveFrom: string): Promise<Reparented[]> {
  const { rows: position } = await tx.query<{ market_id: string }>('SELECT market_id FROM position WHERE id = $1', [id])
  const rules = await structuralRules(tx, position[0]!.market_id, effectiveFrom, 'genealogy.reparent_on_termination')
  const moved: Reparented[] = []
  for (const rule of rules) {
    const tree = rule.params.tree
    // G2's tree lock, taken before reading the rows to move.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('genealogy:' || app_tenant_id() || ':' || $1, 0))`, [tree])
    const { rows: parents } = await tx.query<{ parent: string }>(
      `SELECT u.parent_position_id AS parent FROM relationship u
       WHERE u.kind = $1 AND u.child_position_id = $2 AND ${validKnownAt('u', '$3::timestamptz', 'now()')}`,
      [tree, id, effectiveFrom],
    )
    const parent = parents[0]?.parent
    if (parent === undefined) continue
    const { rows } = await tx.query<RowUnder>(
      `SELECT r.id, r.child_position_id AS child, r.leg, to_char(greatest(r.valid_from, $3::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS from_at,
         r.valid_to IS NULL AND r.valid_from < $3::timestamptz AS open_before
       FROM relationship r WHERE r.kind = $1 AND r.parent_position_id = $2 AND r.superseded_at IS NULL
         AND (r.valid_to IS NULL OR r.valid_to > $3::timestamptz)
       ORDER BY r.child_position_id, r.valid_from`,
      [tree, id, effectiveFrom],
    )
    for (const row of rows) {
      if (!row.open_before) await moveSegment(tx, tree, row, parent, rule.rule_id)
      else {
        await withSqlErrors(() => tx.query(
          `SELECT gen_apply_relationship($1, $2, $3, $4, $5, 'rule', NULL, $6)`, [tree, row.child, parent, row.leg, effectiveFrom, rule.rule_id],
        ))
      }
    }
    const children = [...new Set(rows.map((row) => row.child))]
    if (children.length === 0) continue
    await recordAudit(tx, {
      action: 'GENEALOGY.REPARENTED', objectType: 'position', objectId: id,
      after: { rule_id: rule.rule_id, tree, parent_position_id: parent, children, valid_from: effectiveFrom },
    })
    moved.push(...children.map((child) => ({ position_id: child, tree, rule_id: rule.rule_id })))
  }
  return moved
}

/**
 * FR-PAR-005 through G5: the dated status change with its history row; a termination reassigns the position's
 * customers (FR-CRM-002) and applies the plan's re-parenting rules (D-B3-07) in the same transaction. Audited here.
 */
export async function changeStatus(tx: Tx, id: string, change: StatusChange): Promise<{ reassigned: number; reparented: Reparented[] }> {
  const { rows: before } = await tx.query<{ status: string; market_id: string; owner: string | null }>(
    'SELECT status, market_id, gen_owner_at(id, now()) AS owner FROM position WHERE id = $1', [id])
  // D-B3-07: a reinstated position counts toward its owner's positions limit again.
  if (before[0]?.status === 'terminated' && change.status !== 'terminated' && before[0].owner !== null) {
    await assertPositionsLimit(tx, before[0].owner, before[0].market_id)
  }
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
  const reparented = change.status === 'terminated' ? await reparentOnTermination(tx, id, change.effectiveFrom) : []
  return { reassigned, reparented }
}
