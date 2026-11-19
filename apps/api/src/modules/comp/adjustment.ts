import type { Tx } from '@nmp/db'
import type { AdjustmentOrigin } from '@nmp/engine'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { ApiError } from '../../lib/errors.js'
import type { CaseRecord, CaseTypeDefinition } from '../cas/index.js'
import { getSetting } from '../ten/index.js'
import { tryShareMarketPeriods } from './period.js'

// D-B4-09: a manual adjustment is case type 'adjustment' on a payee position. Approval inserts one manual origin that
// the next calculation of its own period pays and that period's commit consumes. Related or new payee accounts are
// blocked or escalated to two approvals (BR-ADJ-03); users related to the payee never approve it.

export const MANUAL_RULE_KEY = 'manual_adjustment'
const OPEN_STATES = ['open', 'calculating', 'calculated']
const LOCK_NOT_AVAILABLE = '55P03'

const payload = z.strictObject({
  period_id: z.uuid(),
  amount_minor: z.string().regex(/^-?[1-9]\d{0,17}$/, 'a non-zero amount in minor units'),
  note: z.string().trim().min(1).max(2000),
})
type Payload = z.infer<typeof payload>

interface Subject {
  readonly market_id: string
  readonly position_ref: string
  readonly participant_id: string
  readonly external_ref: string
  readonly display_name: string | null
  readonly period_market_id: string | null
  readonly starts_at: Date | null
  readonly ends_at: Date | null
  readonly state: string | null
  readonly related: boolean
  readonly new_account: boolean
}

const periodNotOpen = (state: string | null) =>
  new ApiError(409, 'PERIOD_NOT_OPEN', 'The period is already committed: adjust a later period instead.', { state })

/**
 * The payee position and the period with the BR-ADJ-03 facts: the payee (owner at the period's last instant) declared
 * related to a preparer (the case's opener or assignee, both of whom may edit it, or the acting user, who may edit or
 * submit it), or enrolled within the policy's new_account_days. 422 when the period is not one of the
 * position's market, 409 PERIOD_NOT_OPEN once it is committed, 422 SETTING_NOT_CONFIGURED without a policy.
 */
async function assess(tx: Tx, positionId: string, p: Payload, preparers: readonly (string | null)[]) {
  const policy = await getSetting(tx, 'adjustments.policy')
  if (policy === null) {
    throw new ApiError(422, 'SETTING_NOT_CONFIGURED', 'Set the adjustment policy before proposing adjustments.', { key: 'adjustments.policy' })
  }
  const { rows } = await tx.query<Subject>(
    `SELECT s.market_id, s.position_ref, pt.id AS participant_id, pt.external_ref, pt.display_name, c.market_id AS period_market_id,
            o.starts_at, o.ends_at, o.state,
            EXISTS (SELECT 1 FROM staff_related_users(pt.id) AS r(id) WHERE r.id = ANY ($3::uuid[]) OR r.id = app_user_id()) AS related,
            pt.enrolled_at > now() - make_interval(days => $4::int) AS new_account
     FROM position s LEFT JOIN period o ON o.id = $2 LEFT JOIN calendar c ON c.id = o.calendar_id
     JOIN participant pt ON pt.id = gen_owner_at(s.id, coalesce(o.ends_at - interval '1 microsecond', now()))
     WHERE s.id = $1`,
    [positionId, p.period_id, preparers, policy.new_account_days],
  )
  const subject = rows[0]
  if (subject === undefined || subject.period_market_id !== subject.market_id) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Choose a period of the position\'s market.', { issues: [{ path: 'payload.period_id', message: 'not a period of the position\'s market' }] })
  }
  if (!OPEN_STATES.includes(subject.state!)) throw periodNotOpen(subject.state)
  const flagged = [...(subject.related ? ['related_party'] : []), ...(subject.new_account ? ['new_account'] : [])]
  if (flagged.length > 0 && policy.related_account_action === 'block') {
    throw new ApiError(422, 'ADJUSTMENT_BLOCKED', 'Adjustments to this payee are blocked by the adjustment policy.', { reason: flagged[0] })
  }
  const aboveThreshold = (BigInt(p.amount_minor) < 0n ? -BigInt(p.amount_minor) : BigInt(p.amount_minor)) > BigInt(policy.second_approver_above_minor)
  const escalations = [...flagged, ...(aboveThreshold ? ['above_threshold'] : [])]
  return { subject, escalations, approvals: escalations.length > 0 ? 2 as const : 1 as const }
}

const preparersOf = (c: Pick<CaseRecord, 'opened_by' | 'assigned_to'>) => [c.opened_by, c.assigned_to]

async function effectPreview(tx: Tx, c: CaseRecord<Payload>) {
  const { subject, escalations, approvals } = await assess(tx, c.subject_id, c.payload, preparersOf(c))
  return {
    payee: {
      participant: { id: subject.participant_id, external_ref: subject.external_ref, display_name: subject.display_name },
      position: { id: c.subject_id, position_ref: subject.position_ref },
    },
    period: { id: c.payload.period_id, starts_at: subject.starts_at, ends_at: subject.ends_at, state: subject.state },
    amount_minor: c.payload.amount_minor, approvals_required: approvals, escalations, included_in: 'next calculation of this period',
  }
}

/** Users declared related to the payee (an approver's own or relative's account) never approve it. */
async function excludedApprovers(tx: Tx, c: CaseRecord<Payload>): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT staff_related_users(pt.id) AS id FROM period o, participant pt
     WHERE o.id = $2 AND pt.id = gen_owner_at($1, o.ends_at - interval '1 microsecond')`,
    [c.subject_id, c.payload.period_id],
  )
  return rows.map((row) => row.id)
}

const periodBusy = () => new ApiError(409, 'PERIOD_NOT_OPEN',
  'The period is being calculated, committed or restated: decide the case again once that is done.', { state: 'busy' })

/**
 * Approved: the market's periods lock held shared (late detection shares it; a commit or restatement holds it
 * exclusively), so approval and commit serialise; then the period row held shared and still open, and the manual
 * origin is inserted (the insert guard is the backstop). Neither lock is waited for: CAS has written this decision's
 * audit events already, holding the tenant's audit lock, which a commit, or a run request, finish or failure holding
 * the period row, needs next, so waiting here could deadlock (40P01). Busy answers 409 PERIOD_NOT_OPEN {state 'busy'};
 * the case stays submitted.
 */
async function onDecision(tx: Tx, c: CaseRecord<Payload>, decision: 'approved' | 'rejected'): Promise<void> {
  if (decision !== 'approved') return
  if (!(await tryShareMarketPeriods(tx, c.market_id!))) throw periodBusy()
  const period = await tx.query<{ state: string }>('SELECT state FROM period WHERE id = $1 FOR SHARE NOWAIT', [c.payload.period_id])
    .catch((error: unknown) => {
      throw (error as { code?: string }).code === LOCK_NOT_AVAILABLE ? periodBusy() : error
    })
  const state = period.rows[0]!.state
  if (!OPEN_STATES.includes(state)) throw periodNotOpen(state)
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO adjustment_origin (tenant_id, origin_type, case_id, payee_position_id, rule_key, source_kind, amount_minor, original_period_id,
       reason_code)
     VALUES (app_tenant_id(), 'manual', $1, $2, $3, 'other', $4, $5, $6) RETURNING id`,
    [c.id, c.subject_id, MANUAL_RULE_KEY, c.payload.amount_minor, c.payload.period_id, c.reason_code],
  )
  await recordAudit(tx, {
    action: 'ADJUSTMENT.ORIGIN_CREATED', objectType: 'adjustment_origin', objectId: rows[0]!.id,
    after: { case_id: c.id, position_id: c.subject_id, period_id: c.payload.period_id, amount_minor: c.payload.amount_minor },
  })
}

export const ADJUSTMENT_CASE_TYPE: CaseTypeDefinition<Payload> = {
  type: 'adjustment',
  subjectTypes: ['position'],
  reasonCodes: ['COMMISSION_ERROR', 'DATA_CORRECTION', 'DISPUTE_UPHELD', 'GOODWILL', 'OTHER'],
  evidenceRequired: true,
  permissions: { read: 'case.adjustment.read', create: 'case.adjustment.create', decide: 'case.adjustment.approve' },
  payload,
  async resolveSubject(tx, _type, id) {
    const { rows } = await tx.query<{ market_id: string }>('SELECT market_id FROM position WHERE id = $1', [id])
    return rows[0] === undefined ? null : { marketId: rows[0].market_id }
  },
  async validateCreate(tx, subject, p, _scope, stored) {
    await assess(tx, subject.id, p, stored === undefined ? [] : preparersOf(stored))
  },
  effectPreview,
  approvalsRequired: async (tx, c) => (await assess(tx, c.subject_id, c.payload, preparersOf(c))).approvals,
  excludedApprovers,
  onDecision,
}

/** Approved, unconsumed manual origins of the period, for its run's snapshot (D-B4-09). */
export async function manualOrigins(tx: Tx, periodId: string): Promise<AdjustmentOrigin[]> {
  const { rows } = await tx.query<{ id: string; payee_position_id: string; amount_minor: string; reason_code: string | null }>(
    `SELECT id, payee_position_id, amount_minor::text, reason_code FROM adjustment_origin
     WHERE case_id IS NOT NULL AND original_period_id = $1 AND consumed_run_id IS NULL ORDER BY id`,
    [periodId],
  )
  return rows.map((row) => ({
    originType: 'manual', originId: row.id, payeePositionId: row.payee_position_id, ruleKey: MANUAL_RULE_KEY, sourceKind: 'other',
    amountMinor: BigInt(row.amount_minor), originalPeriodId: periodId, reasonCode: row.reason_code,
  }))
}
