import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import type { EffectEstimate } from './late.js'
import { sum } from './volumes.js'

// FR-ORD-005 late-transaction queue (SC-32): late.manage, market scope through the order's market. Lists order by
// creation time at millisecond precision, the precision of the cursor.
const ITEM_FROM = `
  FROM late_transaction x
  LEFT JOIN order_event e ON e.id = x.order_event_id
  JOIN sales_order o ON o.id = coalesce(x.order_id, e.order_id)
  JOIN period p ON p.id = x.original_period_id`
const IN_SCOPE = '($1::uuid[] IS NULL OR o.market_id = ANY ($1))'

export interface LateCursor {
  readonly created_at: string
  readonly id: string
}

export async function listLate(
  tx: Tx, scope: readonly string[] | null, filter: { state?: string | undefined; market_id?: string | undefined },
  after: LateCursor | undefined, limit: number,
): Promise<Record<string, unknown>[]> {
  const { rows } = await tx.query(
    `SELECT x.id, x.origin_type, coalesce(x.order_id, x.order_event_id) AS origin_id,
            jsonb_build_object('id', o.id, 'source_order_id', o.source_order_id) AS "order",
            jsonb_build_object('id', p.id, 'starts_at', p.starts_at, 'ends_at', p.ends_at, 'state', p.state) AS original_period,
            x.effect_estimate, x.handling, x.state, x.decided_by, x.decided_at, x.decision_reason, x.created_at
     ${ITEM_FROM}
     WHERE ${IN_SCOPE} AND ($2::text IS NULL OR x.state = $2) AND ($3::uuid IS NULL OR o.market_id = $3)
       AND ($4::timestamptz IS NULL OR (date_trunc('milliseconds', x.created_at), x.id) < ($4, $5::uuid))
     ORDER BY date_trunc('milliseconds', x.created_at) DESC, x.id DESC LIMIT $6`,
    [scope, filter.state ?? null, filter.market_id ?? null, after?.created_at ?? null, after?.id ?? null, limit + 1],
  )
  return rows
}

/** meta.counts of the queue: pending now, decided in the last 30 days. */
export async function lateCounts(tx: Tx, scope: readonly string[] | null): Promise<{ pending: number; decided_30d: number }> {
  const { rows } = await tx.query<{ pending: number; decided_30d: number }>(
    `SELECT count(*) FILTER (WHERE x.state = 'pending')::int AS pending,
            count(*) FILTER (WHERE x.state <> 'pending' AND x.decided_at > now() - interval '30 days')::int AS decided_30d
     ${ITEM_FROM} WHERE ${IN_SCOPE}`,
    [scope],
  )
  return rows[0]!
}

interface Selected {
  readonly id: string
  readonly effect_estimate: EffectEstimate
}

/** The selected pending items in scope (locked for a decision); unknown, foreign or decided ids are refused. */
async function selected(tx: Tx, scope: readonly string[] | null, ids: readonly string[], lock: boolean): Promise<Selected[]> {
  const { rows } = await tx.query<Selected & { state: string }>(
    `SELECT x.id, x.state, x.effect_estimate ${ITEM_FROM} WHERE ${IN_SCOPE} AND x.id = ANY ($2) ORDER BY x.id
     ${lock ? 'FOR UPDATE OF x' : ''}`,
    [scope, ids],
  )
  const found = new Set(rows.map((row) => row.id))
  const unknown = ids.filter((id) => !found.has(id))
  if (unknown.length > 0) {
    throw new ApiError(422, 'LATE_SELECTION_INVALID', 'Some selected items do not exist or are outside your markets.', { ids: unknown })
  }
  const decided = rows.filter((row) => row.state !== 'pending').map((row) => row.id)
  if (decided.length > 0) {
    throw lock
      ? new ApiError(409, 'LATE_NOT_PENDING', 'Some selected items were already decided.', { ids: decided })
      : new ApiError(422, 'LATE_SELECTION_INVALID', 'Some selected items were already decided.', { ids: decided })
  }
  return rows
}

/** AC-ORD5-1: count, volume and amount totals and affected positions of a selection; no side effects. */
export async function previewLate(tx: Tx, scope: readonly string[] | null, ids: readonly string[]): Promise<Record<string, unknown>> {
  const items = await selected(tx, scope, ids, false)
  const amount = items.reduce((total, item) => total + BigInt(item.effect_estimate.amount_minor), 0n)
  const positionIds = [...new Set(items.flatMap((item) => item.effect_estimate.attributed_position_id ?? []))]
  const { rows } = await tx.query('SELECT id, position_ref FROM position WHERE id = ANY ($1) ORDER BY position_ref', [positionIds])
  return {
    count: items.length,
    volumes: sum(items.map((item) => item.effect_estimate.volumes)),
    amount_minor: amount.toString(),
    affected_positions: rows,
  }
}

/** Decides every selected pending item once (proposed handling, or the one given), by the acting user. */
export async function decideLate(
  tx: Tx, scope: readonly string[] | null, decision: { ids: readonly string[]; handling?: 'adjust' | 'restatement' | undefined; reason: string },
): Promise<{ decided: number }> {
  const items = await selected(tx, scope, [...new Set(decision.ids)], true)
  const { rows } = await tx.query<{ id: string; handling: string }>(
    `UPDATE late_transaction SET handling = coalesce($2, handling), state = 'decided', decided_by = app_user_id(),
       decided_at = now(), decision_reason = $3
     WHERE id = ANY ($1) RETURNING id, handling`,
    [items.map((item) => item.id), decision.handling ?? null, decision.reason],
  )
  for (const row of rows) {
    await recordAudit(tx, {
      action: 'LATE_TRANSACTION.DECIDED', objectType: 'late_transaction', objectId: row.id,
      before: { state: 'pending' }, after: { state: 'decided', handling: row.handling }, reason: decision.reason,
    })
  }
  return { decided: rows.length }
}
