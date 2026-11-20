import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Tx } from '@nmp/db'
import {
  parseEngineJson, stringifyEngineJson, type AdjustmentOrigin, type Order, type OrderEvent, type OrderEventType,
  type PeriodSummary, type PlanVersion, type Position, type PriorState, type QualificationStateRow, type Receivable, type Relationship,
  type Snapshot,
} from '@nmp/engine'
import { ApiError } from '../../lib/errors.js'
import { previousPeriod, us, type PeriodRow } from './period.js'

// D-B3-08 / §0.1: the engine Snapshot of a period as the loading transaction sees it, stored gzip-compressed as
// canonical JSON (bigint as strings) with its sha256. Replay, trace expansion, late adjustments and simulations of
// committed periods read the stored content, never the live rows again.

const ENGINE_EVENT_TYPES: ReadonlySet<string> = new Set<OrderEventType>([
  'refund', 'return', 'exchange', 'chargeback', 'chargeback_reversed', 'cancelled',
])

export interface LoadedSnapshot {
  readonly snapshot: Snapshot
  readonly orderIds: readonly string[]
  readonly eventIds: readonly string[]
}

export interface ChainInputs {
  readonly priorState: PriorState | null
  readonly priorRunId: string | null
  readonly history: readonly PeriodSummary[]
}

/**
 * The plan of `calendarId` in the version's compiled document with the two fields every reader fills (D-B3-02):
 * contentHash = hex of the version's content hash (`hashHex` for a draft), effectiveFromUs = effective_from, or the
 * period start while unset.
 */
export async function planFor(tx: Tx, versionId: string, calendarId: string, startsUs: string, hashHex?: string): Promise<PlanVersion> {
  const { rows } = await tx.query<{ plan: string | null; hash: string | null; effective_us: string | null }>(
    `SELECT (compiled -> $2::text)::text AS plan, encode(content_hash, 'hex') AS hash, ${us('effective_from')} AS effective_us
     FROM plan_version WHERE id = $1`,
    [versionId, calendarId],
  )
  const row = rows[0]
  if (row?.plan == null) throw new ApiError(422, 'PLAN_INVALID', 'The plan version has no compiled plan for this calendar.')
  const contentHash = hashHex ?? row.hash
  if (contentHash == null) throw new ApiError(422, 'PLAN_INVALID', 'The plan version has no content hash.')
  return { ...parseEngineJson<PlanVersion>(row.plan), contentHash, effectiveFromUs: BigInt(row.effective_us ?? startsUs) }
}

/** Longest rolling qualification window of the plan, minus the period itself (history entries a run needs). */
function historyNeeded(plan: PlanVersion): number {
  let periods = 1
  for (const ladder of plan.ladders) {
    for (const rank of ladder.ranks) {
      for (const requirement of rank.requires) {
        if (requirement.kind === 'measure' && requirement.window.type === 'rolling') periods = Math.max(periods, requirement.window.periods)
      }
    }
  }
  return periods - 1
}

interface StateRowText {
  position_id: string
  paid_as_rank: string
  highest_titles: string
  grace_used: string
  counters: string
  carry: string
  one_time_flags: string[]
  banked: string
  measures: string
}

async function stateRows(tx: Tx, runId: string): Promise<StateRowText[]> {
  const { rows } = await tx.query<StateRowText>(
    `SELECT position_id, paid_as_rank::text, highest_titles::text, grace_used::text, counters::text, carry::text,
            one_time_flags, banked::text, measures::text
     FROM qualification_state WHERE run_id = $1 ORDER BY position_id`,
    [runId],
  )
  return rows
}

function priorRow(row: Omit<StateRowText, 'measures'>): QualificationStateRow {
  return {
    positionId: row.position_id,
    paidAs: parseEngineJson(row.paid_as_rank),
    titles: parseEngineJson(row.highest_titles),
    graceUsed: parseEngineJson(row.grace_used),
    counters: parseEngineJson(row.counters),
    carry: parseEngineJson(row.carry),
    oneTimeFlags: row.one_time_flags,
    banked: parseEngineJson(row.banked),
  }
}

async function covered(tx: Tx, periodId: string): Promise<boolean> {
  const { rows } = await tx.query<{ covered: boolean }>('SELECT plan_version_for_period($1) IS NOT NULL AS covered', [periodId])
  return rows[0]!.covered
}

/**
 * Prior state and history (§0.1): the committed run of the previous period, then contiguous committed periods back
 * as far as the plan's longest rolling window needs. A period whose previous period has no plan version is a chain
 * start (§2.4): no history, and no prior state unless it is a migration cutover (chainStart).
 */
export async function chainInputs(tx: Tx, period: PeriodRow, plan: PlanVersion): Promise<ChainInputs> {
  const previous = await previousPeriod(tx, period)
  if (previous === null || !(await covered(tx, previous.id))) return chainStart(tx, period, previous, plan)
  if (previous.committed_run_id === null) {
    throw new ApiError(422, 'PRIOR_STATE_MISSING', 'The previous period was committed without a run.', { period_id: previous.id })
  }
  const { rows } = await tx.query<{ plan_version_id: string }>('SELECT plan_version_id FROM run WHERE id = $1', [previous.committed_run_id])
  const priorState: PriorState = {
    planVersionId: rows[0]!.plan_version_id,
    periodId: previous.id,
    positions: (await stateRows(tx, previous.committed_run_id)).map(priorRow),
  }
  const history: PeriodSummary[] = []
  let at: PeriodRow | null = previous
  while (at !== null && at.committed_run_id !== null && history.length < historyNeeded(plan) && (await covered(tx, at.id))) {
    const positions = (await stateRows(tx, at.committed_run_id)).map((row) => ({
      positionId: row.position_id, measures: parseEngineJson<PeriodSummary['positions'][number]['measures']>(row.measures),
      paidAs: parseEngineJson<PeriodSummary['positions'][number]['paidAs']>(row.paid_as_rank),
    }))
    history.push({ periodId: at.id, startsAtUs: BigInt(at.starts_us), endsAtUs: BigInt(at.ends_us), positions })
    at = await previousPeriod(tx, at)
  }
  return { priorState, priorRunId: previous.committed_run_id, history }
}

/**
 * D-B6-10: a chain start that is a migration's cutover period starts from the migration's approved opening state (SQL
 * mig_opening_state_for), as the prior state of the plan version in force, so no transition applies; otherwise nothing.
 */
async function chainStart(tx: Tx, period: PeriodRow, previous: PeriodRow | null, plan: PlanVersion): Promise<ChainInputs> {
  const { rows } = await tx.query<Omit<StateRowText, 'measures'>>(
    `SELECT position_id, paid_as_rank::text, highest_titles::text, grace_used::text, counters::text, carry::text, one_time_flags, banked::text
     FROM mig_opening_state_for($1)`,
    [period.id],
  )
  if (rows.length === 0) return { priorState: null, priorRunId: null, history: [] }
  // The opening state holds as of C's start: the end of the previous period (C itself when it is the calendar's first).
  const priorState: PriorState = { planVersionId: plan.planVersionId, periodId: previous?.id ?? period.id, positions: rows.map(priorRow) }
  return { priorState, priorRunId: null, history: [] }
}

interface OrderRow {
  id: string
  buyer_id: string
  buyer_type_code: string
  purpose: Order['purpose']
  attributed_position_id: string | null
  credited_us: string
  lines: { line_no: number; sku: string; item_class: string; quantity: number; amount_minor: string; volumes: Record<string, string> }[]
}

interface EventRow {
  id: string
  order_id: string
  type: string
  at_us: string
  refund_minor: string
  fee_minor: string
  line_no: number | null
  quantity: number | null
}

/**
 * Orders of the calendar's market credited in [starts_at, ends_at) plus `extraOrderIds` (a late order replayed into
 * its committed period, D-B3-13), and every visible event of those orders.
 */
async function orderInputs(tx: Tx, period: PeriodRow, extraOrderIds: readonly string[], ofPeriod = true) {
  const { rows: orders } = await tx.query<OrderRow>(
    `SELECT o.id, o.buyer_id, t.code AS buyer_type_code, o.purpose, o.attributed_position_id, ${us('o.credited_at')} AS credited_us,
            (SELECT jsonb_agg(jsonb_build_object('line_no', l.line_no, 'sku', l.sku, 'item_class', l.item_class,
                     'quantity', l.quantity, 'amount_minor', l.amount_minor::text, 'volumes', l.volumes) ORDER BY l.line_no)
             FROM order_line l WHERE l.order_id = o.id) AS lines
     FROM sales_order o JOIN participant_type t ON t.id = o.buyer_type_id, period p
     WHERE p.id = $1 AND (($4 AND o.market_id = $2 AND o.credited_at >= p.starts_at AND o.credited_at < p.ends_at)
                          OR o.id = ANY ($3::uuid[]))
     ORDER BY o.id`,
    [period.id, period.market_id, extraOrderIds, ofPeriod],
  )
  const orderIds = orders.map((order) => order.id)
  const { rows: events } = await tx.query<EventRow>(
    `SELECT e.id, e.order_id, e.type, ${us('e.occurred_at')} AS at_us, e.refund_minor::text, e.fee_minor::text, x.line_no, x.quantity
     FROM order_event e LEFT JOIN LATERAL jsonb_to_recordset(e.lines) AS x(line_no int, quantity int) ON true
     WHERE e.order_id = ANY ($1::uuid[]) ORDER BY e.id, x.line_no`,
    [orderIds],
  )
  return { orders, events, orderIds }
}

function engineOrder(row: OrderRow): Order {
  return {
    orderId: row.id,
    buyerParticipantId: row.buyer_id,
    buyerTypeCode: row.buyer_type_code,
    purpose: row.purpose,
    creditPositionId: row.attributed_position_id,
    creditedAtUs: BigInt(row.credited_us),
    lines: (row.lines ?? []).map((line) => ({
      lineId: String(line.line_no),
      productId: line.sku,
      itemClass: line.item_class,
      category: '', // no category column; rules naming categories are refused by validation (D-B3-18)
      quantity: line.quantity,
      amountMinor: BigInt(line.amount_minor),
      // shortcut: order_line has no tax column, so amount_ex_tax measures equal amount; add per-line tax with B-MKT tax data
      taxMinor: 0n,
      // order_line.volumes are line totals (per-unit map value x quantity, D-B2-17): exact division back to per unit (BUG-084)
      volumes: Object.keys(line.volumes).sort().map((name) => ({ name, perUnitMinor: BigInt(line.volumes[name]!) / BigInt(line.quantity) })),
    })),
  }
}

// One engine event per (event, line): the event's refund and fee travel with each line, which keeps the fee share
// refund / (refund + fee) the engine uses. shortcut: events without lines (amount-only refunds) and renewal_failed
// carry no volume reversal here (an amount-only reversal is a blocking review exception, review.ts; late ones are
// clawed back by comp/late.ts); add order-level reversals when the engine models them.
function engineEvents(rows: readonly EventRow[]): OrderEvent[] {
  return rows.flatMap((row) =>
    row.line_no === null || row.quantity === null || !ENGINE_EVENT_TYPES.has(row.type) ? [] : [{
      eventId: `${row.id}:${row.line_no}`,
      orderId: row.order_id,
      lineId: String(row.line_no),
      type: row.type as OrderEventType,
      quantity: row.quantity,
      refundMinor: BigInt(row.refund_minor),
      restockingFeeMinor: BigInt(row.fee_minor),
      atUs: BigInt(row.at_us),
    }],
  )
}

/**
 * Late orders replayed into a committed period's stored input (D-B3-13): the orders without their events, and their
 * buyers missing from that input.
 */
export async function lateOrders(tx: Tx, period: PeriodRow, ids: readonly string[], known: Snapshot): Promise<Pick<Snapshot, 'orders' | 'participants'>> {
  const { orders } = await orderInputs(tx, period, ids, false)
  const present = new Set(known.participants.map((p) => p.participantId))
  const buyers = orders.map((o) => o.buyer_id).filter((id) => !present.has(id))
  return { orders: orders.map(engineOrder), participants: buyers.length === 0 ? [] : await participants(tx, period, buyers) }
}

/**
 * Every position and relationship of the tenant (sponsor chains cross markets, D-B2-21), owner and status as of the
 * period's last instant (ends_at - 1 µs). Relationships are read first: see buildSnapshot.
 */
async function genealogy(tx: Tx, period: PeriodRow) {
  const { rows: relationships } = await tx.query<{
    kind: Relationship['kind']; parent: string; child: string; leg: string | null; from_us: string; to_us: string | null
    recorded_us: string; superseded_us: string | null
  }>(
    `SELECT kind, parent_position_id AS parent, child_position_id AS child, leg, ${us('valid_from')} AS from_us,
            ${us('valid_to')} AS to_us, ${us('recorded_at')} AS recorded_us, ${us('superseded_at')} AS superseded_us
     FROM relationship ORDER BY child_position_id, kind, valid_from, recorded_at, id`,
  )
  const { rows: positions } = await tx.query<{ id: string; owner: string; status: Position['status']; status_us: string }>(
    `WITH at AS (SELECT ends_at - interval '1 microsecond' AS t FROM period WHERE id = $1)
     SELECT p.id, o.participant_id AS owner, coalesce(h.to_status, p.status) AS status,
            ${us('coalesce(h.effective_from, p.status_from)')} AS status_us
     FROM position p CROSS JOIN at
     LEFT JOIN LATERAL (SELECT h.to_status, h.effective_from FROM position_status_history h
                        WHERE h.position_id = p.id AND h.effective_from <= at.t
                        ORDER BY h.effective_from DESC, h.recorded_at DESC LIMIT 1) h ON true
     JOIN LATERAL (SELECT w.participant_id FROM position_ownership w WHERE w.position_id = p.id
                   ORDER BY w.valid_from <= at.t DESC, CASE WHEN w.valid_from <= at.t THEN w.valid_from END DESC, w.valid_from
                   LIMIT 1) o ON true
     ORDER BY p.id`,
    [period.id],
  )
  return {
    positions: positions.map((row): Position => ({
      positionId: row.id, ownerParticipantId: row.owner, status: row.status, statusFromUs: BigInt(row.status_us),
    })),
    relationships: relationships.map((row): Relationship => ({
      kind: row.kind, parentPositionId: row.parent, childPositionId: row.child, leg: row.leg, validFromUs: BigInt(row.from_us),
      validToUs: row.to_us === null ? null : BigInt(row.to_us), recordedAtUs: BigInt(row.recorded_us),
      supersededAtUs: row.superseded_us === null ? null : BigInt(row.superseded_us),
    })),
  }
}

async function participants(tx: Tx, period: PeriodRow, ids: readonly string[]): Promise<Snapshot['participants']> {
  const { rows } = await tx.query<{ id: string; type_code: string; enrolled_us: string }>(
    `SELECT pa.id, ${us('pa.enrolled_at')} AS enrolled_us,
            coalesce((SELECT t.code FROM par_type_at(pa.id, p.ends_at - interval '1 microsecond') t LIMIT 1),
                     (SELECT t.code FROM participant_type_assignment a JOIN participant_type t ON t.id = a.type_id
                      WHERE a.participant_id = pa.id ORDER BY a.valid_from LIMIT 1)) AS type_code
     FROM participant pa, period p WHERE p.id = $1 AND pa.id = ANY ($2::uuid[]) ORDER BY pa.id`,
    [period.id, [...new Set(ids)]],
  )
  return rows.map((row) => ({ participantId: row.id, typeCode: row.type_code, enrolledAtUs: BigInt(row.enrolled_us), facts: [] }))
}

/**
 * §0.1: the engine Snapshot of `period` as this transaction sees it, known at its now(). Under READ COMMITTED each
 * statement sees newer commits than the one before, so every row is read before the rows it references (orders and
 * events, relationships, positions, participants, types): a row committed between two statements can add to the
 * snapshot but never leave it a reference to a row it lacks. This holds in every caller's transaction (run tx A, a
 * simulation job, the restatement sandbox inside the case request).
 */
export async function buildSnapshot(
  tx: Tx, period: PeriodRow,
  input: {
    snapshotId: string; chain: ChainInputs; adjustments: readonly AdjustmentOrigin[]; extraOrderIds?: readonly string[]
    /** D-B4-07: runs only; simulations and the restatement sandbox net against nothing. */
    receivables?: readonly Receivable[]
  },
): Promise<LoadedSnapshot> {
  const { rows: known } = await tx.query<{ known_us: string }>(`SELECT ${us('now()')} AS known_us`)
  const { orders, events, orderIds } = await orderInputs(tx, period, input.extraOrderIds ?? [])
  const tree = await genealogy(tx, period)
  const people = await participants(tx, period, [...tree.positions.map((p) => p.ownerParticipantId), ...orders.map((o) => o.buyer_id)])
  const { rows: types } = await tx.query<{ code: string; can_earn: boolean; counts_as_end_customer: boolean; can_sponsor: boolean; can_hold_positions: boolean }>(
    `SELECT code, can_earn, counts_as_end_customer, can_sponsor, can_hold_positions FROM participant_type
     WHERE state = 'active' ORDER BY code`,
  )
  const snapshot: Snapshot = {
    snapshotId: input.snapshotId,
    market: { marketId: period.market_id, currency: period.currency, minorDigits: period.minor_unit },
    period: { periodId: period.id, calendar: period.calendar_id, startsAtUs: BigInt(period.starts_us), endsAtUs: BigInt(period.ends_us) },
    knownAtUs: BigInt(known[0]!.known_us),
    participantTypes: types.map((t) => ({
      code: t.code, canEarn: t.can_earn, countsAsEndCustomer: t.counts_as_end_customer, canSponsor: t.can_sponsor,
      canHoldPositions: t.can_hold_positions,
    })),
    participants: people,
    positions: tree.positions,
    relationships: tree.relationships,
    orders: orders.map(engineOrder),
    orderEvents: engineEvents(events),
    history: input.chain.history,
    priorState: input.chain.priorState,
    adjustments: input.adjustments,
    receivables: input.receivables ?? [],
    withholding: [], // B4 (the engine warns NO_WITHHOLDING_RULE)
  }
  return { snapshot, orderIds, eventIds: [...new Set(events.map((event) => event.id))] }
}

export function rowCounts(loaded: LoadedSnapshot, lateItemIds: readonly string[]): Record<string, unknown> {
  const s = loaded.snapshot
  return {
    participants: s.participants.length, positions: s.positions.length, relationships: s.relationships.length,
    orders: s.orders.length, order_events: loaded.eventIds.length, history: s.history.length, adjustments: s.adjustments.length,
    // The late items this run consumes (D-B3-13), also those whose origins rounded to nothing: commit consumes them.
    late_item_ids: lateItemIds,
  }
}

/** Inserts the snapshot (id = snapshot.snapshotId, known_at = this transaction's now()). */
export async function storeSnapshot(
  tx: Tx, loaded: LoadedSnapshot, meta: { periodId: string; priorRunId: string | null; rowCounts: Record<string, unknown> },
): Promise<void> {
  const content = gzipSync(stringifyEngineJson(loaded.snapshot))
  await tx.query(
    `INSERT INTO run_snapshot (id, tenant_id, period_id, known_at, prior_state_run_id, content, content_sha256, row_counts,
                               order_ids, order_event_ids)
     VALUES ($1, app_tenant_id(), $2, now(), $3, $4, $5, $6, $7, $8)`,
    [loaded.snapshot.snapshotId, meta.periodId, meta.priorRunId, content, createHash('sha256').update(content).digest(),
      meta.rowCounts, loaded.orderIds, loaded.eventIds],
  )
}

export class SnapshotCorrupt extends Error {
  constructor(readonly snapshotId: string) {
    super(`run snapshot ${snapshotId} does not match its sha256`)
  }
}

/** The stored Snapshot, after checking its content against content_sha256 (AC-COMP8-1). */
export async function readSnapshot(tx: Tx, snapshotId: string): Promise<Snapshot> {
  const { rows } = await tx.query<{ content: Buffer; intact: boolean }>(
    `SELECT content, digest(content, 'sha256') = content_sha256 AS intact FROM run_snapshot WHERE id = $1`,
    [snapshotId],
  )
  const row = rows[0]
  if (row === undefined) throw new Error(`run snapshot ${snapshotId} does not exist`)
  if (!row.intact) throw new SnapshotCorrupt(snapshotId)
  return parseEngineJson<Snapshot>(gunzipSync(row.content).toString('utf8'))
}
