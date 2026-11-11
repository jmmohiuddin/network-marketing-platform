import {
  computeReports, METHOD_VERSION, type ComplianceConfigInput, type ComplianceFacts, type OrderFact, type PayoutLineFact,
  type ReportPeriod,
} from '@nmp/compliance'
import type { Tx } from '@nmp/db'
import { getSettingsVersion, type EffectiveSettings } from '../ten/index.js'
import type { Snapshot } from './snapshot-row.js'

/** The recorded inputs of a snapshot can no longer be applied (method version moved on, settings version missing). */
export class SnapshotInputError extends Error {
  override readonly name = 'SnapshotInputError'
}

/** Tenant settings as compute input. An unset key stays null, never a default (DEC-14, E-ADR-11). */
export function complianceConfig(settings: EffectiveSettings | null): ComplianceConfigInput {
  const values = settings?.values ?? {}
  const active = values['compliance.active_pv_minor']
  const ranks = values['compliance.rank_thresholds_pv_minor']
  const flag = values['compliance.personal_share_flag']
  return {
    activePvMinor: active === undefined ? null : BigInt(active),
    rankThresholdsPvMinor: ranks === undefined ? null : Object.fromEntries(Object.entries(ranks).map(([rank, pv]) => [rank, BigInt(pv)])),
    lateOrderDay: values['compliance.late_order_day'] ?? null,
    personalShareFlag: flag === undefined ? null : { numerator: BigInt(flag.numerator), denominator: BigInt(flag.denominator) },
  }
}

interface ParticipantRow {
  participant_ref: string
  type_code: string
  counts_as_end_customer: boolean
  can_earn: boolean
  enrolled_month: string
  servicing_ref: string | null
}

interface OrderRow {
  order_ref: string
  order_month: string
  order_day: number
  buyer_ref: string
  amount_minor: string
  volume_minor: string
  purpose: OrderFact['purpose']
  is_starter_kit: boolean
  refunded_minor: string
  refund_month: string | null
}

interface LineRow {
  line_ref: string
  pay_month: string
  payee_ref: string
  bonus_type: string
  source_kind: PayoutLineFact['sourceKind']
  source_order_ref: string | null
  amount_minor: string
}

// Every batch carries the full participant file, so a participant appears once per batch: the latest load wins.
const PARTICIPANTS = `SELECT DISTINCT ON (participant_ref) participant_ref, type_code, counts_as_end_customer, can_earn,
    to_char(enrolled_month, 'YYYY-MM') AS enrolled_month, servicing_ref
  FROM cpl_fact_participant WHERE batch_id = ANY ($1::uuid[])
  ORDER BY participant_ref, created_at DESC, batch_id DESC`
const ORDERS = `SELECT order_ref, to_char(order_date, 'YYYY-MM') AS order_month, extract(day FROM order_date)::int AS order_day,
    buyer_ref, amount_minor, volume_minor, purpose, is_starter_kit, refunded_minor, to_char(refund_month, 'YYYY-MM') AS refund_month
  FROM cpl_fact_order WHERE batch_id = ANY ($1::uuid[])`
// Only the payout lines of the snapshot range: year figures (R3 year, R5) cover the range part of the year.
const PAYOUT_LINES = `SELECT line_ref, to_char(pay_month, 'YYYY-MM') AS pay_month, payee_ref, bonus_type, source_kind,
    source_order_ref, amount_minor
  FROM cpl_fact_payout_line WHERE batch_id = ANY ($1::uuid[]) AND to_char(pay_month, 'YYYY-MM') BETWEEN $2 AND $3`

/** The facts of the snapshot's input batches. Facts of a batch never change once loaded (BR-IMP-04, migration 0031). */
export async function loadFacts(tx: Tx, snapshot: Snapshot): Promise<ComplianceFacts> {
  const batches = snapshot.inputs.batch_ids
  const participants = await tx.query<ParticipantRow>(PARTICIPANTS, [batches])
  const orders = await tx.query<OrderRow>(ORDERS, [batches])
  const lines = await tx.query<LineRow>(PAYOUT_LINES, [batches, snapshot.period_from, snapshot.period_to])
  return {
    participants: participants.rows.map((p) => ({
      participantRef: p.participant_ref, typeCode: p.type_code, countsAsEndCustomer: p.counts_as_end_customer,
      canEarn: p.can_earn, enrolledMonth: p.enrolled_month, servicingRef: p.servicing_ref,
    })),
    orders: orders.rows.map((o) => ({
      orderRef: o.order_ref, orderMonth: o.order_month, orderDay: o.order_day, buyerRef: o.buyer_ref,
      amountMinor: BigInt(o.amount_minor), volumeMinor: BigInt(o.volume_minor), purpose: o.purpose,
      isStarterKit: o.is_starter_kit, refundedMinor: BigInt(o.refunded_minor), refundMonth: o.refund_month,
    })),
    payoutLines: lines.rows.map((l) => ({
      lineRef: l.line_ref, payMonth: l.pay_month, payeeRef: l.payee_ref, bonusType: l.bonus_type,
      sourceKind: l.source_kind, sourceOrderRef: l.source_order_ref, amountMinor: BigInt(l.amount_minor),
    })),
  }
}

const YEAR_LENGTH = 4

function inSnapshot(snapshot: Snapshot): (period: ReportPeriod) => boolean {
  const { period_from: from, period_to: to } = snapshot
  return (period) => {
    if (!snapshot.inputs.reports.includes(period.report)) return false
    const [low, high] = period.periodKind === 'month' ? [from, to] : [from.slice(0, YEAR_LENGTH), to.slice(0, YEAR_LENGTH)]
    return low <= period.period && period.period <= high
  }
}

export interface Reproduction {
  readonly periods: readonly ReportPeriod[]
  readonly facts: ComplianceFacts
}

// Exactly the version recorded at creation (null = the tenant had no settings), never a lookup by time: a
// settings save in flight at creation commits a version that starts before the snapshot but was not read by it.
async function recordedSettings(tx: Tx, snapshot: Snapshot): Promise<EffectiveSettings | null> {
  if (snapshot.settings_version_id === null) return null
  const settings = await getSettingsVersion(tx, snapshot.settings_version_id)
  if (settings === null) throw new SnapshotInputError('The settings version recorded on the snapshot does not exist.')
  return settings
}

/**
 * Computes the snapshot's report periods from its recorded inputs: input batches, settings version and method
 * version (BR-CPL-01). The same inputs always give the same figures. Throws SnapshotInputError when a recorded
 * version can no longer be applied, and ComplianceInputError (from @nmp/compliance) when the facts cannot be
 * computed on.
 */
export async function reproduce(tx: Tx, snapshot: Snapshot, drillIdCap: number): Promise<Reproduction> {
  if (snapshot.method_version !== METHOD_VERSION) {
    throw new SnapshotInputError(`The snapshot used method ${snapshot.method_version}; this server computes ${METHOD_VERSION}.`)
  }
  const settings = await recordedSettings(tx, snapshot)
  const facts = await loadFacts(tx, snapshot)
  const { reports } = computeReports(facts, complianceConfig(settings), { drillIdCap })
  return { periods: reports.filter(inSnapshot(snapshot)), facts }
}
