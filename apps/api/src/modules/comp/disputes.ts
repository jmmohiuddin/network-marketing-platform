import { eligibleApprovers, withSystem, type Tx } from '@nmp/db'
import { z } from 'zod'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { defineSystemJob } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'
import { escalateCase, openPortalCase, type CaseRecord, type CaseTypeDefinition } from '../cas/index.js'
import { getSetting } from '../ten/index.js'

// FR-CAS-003 (D-B5-15): a commission dispute is case type 'dispute' on a result line, opened and submitted in one
// portal transaction by the line's payee with the line's stored trace; decided by case.dispute.approve holders of the
// line's position market; escalated once by the daily overdue job.

export const DISPUTE_REASON = 'DISTRIBUTOR_DISPUTE'
const UNIQUE_VIOLATION = '23505'
const OVERDUE_BATCH = 500

export const disputeMessage = z.string().trim().min(1).max(2000)

const payload = z.strictObject({
  line_id: z.uuid(), run_id: z.uuid(), participant_id: z.uuid(), message: disputeMessage, trace: z.unknown(),
})
type Payload = z.infer<typeof payload>

async function lineMarket(tx: Tx, lineId: string): Promise<{ marketId: string } | null> {
  const { rows } = await tx.query<{ market_id: string }>(
    'SELECT x.market_id FROM result_line l JOIN position x ON x.id = l.payee_position_id WHERE l.id = $1', [lineId])
  return rows[0] === undefined ? null : { marketId: rows[0].market_id }
}

/** The line, its position and period, for the analyst (case detail). */
async function effectPreview(tx: Tx, c: CaseRecord<Payload>) {
  const { rows } = await tx.query(
    `SELECT jsonb_build_object('id', l.id, 'amount_minor', l.amount_minor::text, 'currency', l.currency, 'rule_key', l.rule_key) AS line,
            jsonb_build_object('id', x.id, 'position_ref', x.position_ref) AS position, r.id AS run_id,
            jsonb_build_object('id', p.id, 'starts_at', json_instant(p.starts_at), 'ends_at', json_instant(p.ends_at)) AS period
     FROM result_line l JOIN position x ON x.id = l.payee_position_id JOIN run r ON r.id = l.run_id JOIN period p ON p.id = r.period_id
     WHERE l.id = $1`,
    [c.subject_id],
  )
  return rows[0]
}

/** Submit + the market's response days (disputes.policy.response_days); unset market: no due date (DEC-14). */
async function dueAt(tx: Tx, c: CaseRecord<Payload>): Promise<Date | null> {
  const days = (await getSetting(tx, 'disputes.policy'))?.response_days[c.market_id!]
  if (days === undefined) return null
  const { rows } = await tx.query<{ due_at: Date }>('SELECT now() + make_interval(days => $1::int) AS due_at', [days])
  return rows[0]!.due_at
}

export const DISPUTE_CASE_TYPE: CaseTypeDefinition<Payload> = {
  type: 'dispute',
  subjectTypes: ['result_line'],
  // Only the line owner opens a dispute (openDispute): no reason code a staff user may choose, so POST /v1/cases refuses it.
  reasonCodes: [],
  systemReasonCodes: [DISPUTE_REASON],
  evidenceRequired: false,
  // No create permission exists (PLAN B5 section 3); the slot names the deciding permission, which opens nothing here
  // (no user reason code, and a dispute is never open after its portal transaction).
  permissions: { read: 'case.dispute.read', create: 'case.dispute.approve', decide: 'case.dispute.approve' },
  payload,
  resolveSubject: async (tx, _type, id) => lineMarket(tx, id),
  effectPreview,
  dueAt,
  async excludedApprovers(tx, c) {
    const { rows } = await tx.query<{ id: string }>('SELECT staff_related_users($1) AS id', [c.payload.participant_id])
    return rows.map((row) => row.id)
  },
  async onDecision(tx, c, decision) {
    const params = { case_id: c.id, outcome: decision === 'approved' ? 'upheld' : 'not_upheld' }
    await tx.query(`SELECT notify_participant($1, 'dispute.updated', $2::jsonb)`, [c.payload.participant_id, JSON.stringify(params)])
  },
}

const disputeOpen = (caseId: string | null) =>
  new ApiError(409, 'DISPUTE_OPEN', 'This line already has a dispute in progress.', caseId === null ? {} : { case_id: caseId })

/**
 * POST /v1/me/disputes: the participant's line of a committed run (else 404), no dispute of it open (409), the dispute
 * window not closed (422); opened and submitted as the portal user (CAS openPortalCase), with the line's trace.
 */
export async function openDispute(tx: Tx, participantId: string, lineId: string, message: string) {
  // Serialises the one-open-dispute check per line before anything is audited; the unique index is the backstop.
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('dispute:' || $1, 0))`, [lineId])
  const windowDays = (await getSetting(tx, 'disputes.policy'))?.window_days ?? null
  const { rows } = await tx.query<{ run_id: string; trace: unknown; closed_at: Date | null; closed: boolean | null }>(
    `SELECT l.run_id, l.trace, r.committed_at + make_interval(days => $3::int) AS closed_at, r.committed_at + make_interval(days => $3::int) < now() AS closed
     FROM result_line l JOIN run r ON r.id = l.run_id AND r.state = 'committed' WHERE l.id = $1 AND l.payee_participant_id = $2`,
    [lineId, participantId, windowDays],
  )
  const line = rows[0]
  if (line === undefined) throw notFound()
  const { rows: open } = await tx.query<{ id: string }>(
    `SELECT id FROM case_file WHERE type = 'dispute' AND subject_id = $1 AND state IN ('open', 'submitted') LIMIT 1`, [lineId])
  if (open[0] !== undefined) throw disputeOpen(open[0].id)
  if (line.closed === true) throw new ApiError(422, 'DISPUTE_WINDOW_CLOSED', 'Disputes of this statement are closed.', { closed_at: line.closed_at })
  const subject = (await lineMarket(tx, lineId))!
  try {
    const c = await openPortalCase(tx, DISPUTE_CASE_TYPE as CaseTypeDefinition, {
      subjectType: 'result_line', subjectId: lineId, reasonCode: DISPUTE_REASON, marketId: subject.marketId,
      payload: { line_id: lineId, run_id: line.run_id, participant_id: participantId, message, trace: line.trace },
    })
    return { case_id: c.id, state: 'opened', due_at: c.due_at }
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) throw disputeOpen(null)
    throw error
  }
}

interface DisputeRow {
  readonly case_id: string
  readonly line_id: string
  readonly run_id: string
  readonly period: unknown
  readonly amount_minor: string
  readonly state: string
  readonly assigned: boolean
  readonly opened_at: Date
  readonly due_at: Date | null
  readonly overdue: boolean
  readonly explanation: string | null
}

/** Opened = submitted and unassigned, under review = assigned, upheld = approved, not upheld = rejected (C-B5-11). */
const portalState = (row: DisputeRow): string =>
  row.state === 'approved' ? 'upheld' : row.state === 'rejected' ? 'not_upheld' : row.assigned ? 'under_review' : 'opened'

/** GET /v1/me/disputes(/:id): the participant's disputes, newest first; the decision reason is the explanation. */
export async function listDisputes(tx: Tx, participantId: string, filter: { id?: string; after?: string }, limit: number) {
  const { rows } = await tx.query<DisputeRow>(
    `SELECT c.id AS case_id, l.id AS line_id, l.run_id,
            jsonb_build_object('id', p.id, 'starts_at', json_instant(p.starts_at), 'ends_at', json_instant(p.ends_at)) AS period,
            l.amount_minor::text, c.state, c.assigned_to IS NOT NULL AS assigned, c.created_at AS opened_at, c.due_at,
            (c.state = 'submitted' AND c.due_at IS NOT NULL AND c.due_at < now()) AS overdue,
            (SELECT e.data ->> 'reason' FROM case_event e WHERE e.case_id = c.id AND e.kind IN ('approved', 'rejected')
             ORDER BY e.occurred_at DESC LIMIT 1) AS explanation
     FROM case_file c JOIN result_line l ON l.id = c.subject_id JOIN run r ON r.id = l.run_id JOIN period p ON p.id = r.period_id
     WHERE c.type = 'dispute' AND c.state <> 'withdrawn' AND c.payload ->> 'participant_id' = $1::text
       AND ($2::uuid IS NULL OR c.id = $2)
       AND ($3::uuid IS NULL OR (c.created_at, c.id) < (SELECT created_at, id FROM case_file WHERE id = $3))
     ORDER BY c.created_at DESC, c.id DESC LIMIT $4`,
    [participantId, filter.id ?? null, filter.after ?? null, limit + 1],
  )
  return rows.map((row) => {
    const { assigned: _assigned, ...view } = row
    return { ...view, state: portalState(row) }
  })
}

export async function disputeDetail(tx: Tx, participantId: string, caseId: string) {
  const [row] = await listDisputes(tx, participantId, { id: caseId }, 1)
  if (row === undefined) throw notFound()
  return row
}

interface Escalated { readonly code: string; readonly dueAt: Date; readonly emails: readonly string[] }

/** One overdue dispute: event escalated (once); returns the case.dispute.approve holders of its market to mail. */
async function escalate(tx: Tx, caseId: string): Promise<Escalated | null> {
  const { rows } = await tx.query<{ market_id: string; code: string; due_at: Date }>(
    `SELECT c.market_id, m.code, c.due_at FROM case_file c JOIN market m ON m.id = c.market_id
     WHERE c.id = $1 AND c.type = 'dispute' AND c.state = 'submitted' AND c.due_at < now()
       AND NOT EXISTS (SELECT 1 FROM case_event e WHERE e.case_id = c.id AND e.kind = 'escalated')
     FOR UPDATE OF c`,
    [caseId],
  )
  const dispute = rows[0]
  if (dispute === undefined) return null
  const approvers = await eligibleApprovers(tx, { permission: 'case.dispute.approve', marketId: dispute.market_id, excludeUserIds: [] })
  await escalateCase(tx, caseId, { due_at: dispute.due_at.toISOString(), notified: approvers.length })
  return { code: dispute.code, dueAt: dispute.due_at, emails: approvers.map((approver) => approver.email) }
}

/** Daily 06:00 UTC (PLAN B5 section 4.3): every submitted dispute past its due date, one tenant transaction each. */
export const overdueDisputesJob = defineSystemJob({
  name: 'comp.disputes.overdue',
  cron: '0 6 * * *',
  async run(ctx) {
    const { rows } = await withSystem((tx) =>
      tx.query<{ tenant_id: string; case_id: string }>('SELECT tenant_id, case_id FROM comp_overdue_disputes($1)', [OVERDUE_BATCH]))
    for (const row of rows) {
      let escalated: Escalated | null
      try {
        escalated = await runInTenant({ tenantId: row.tenant_id, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: ctx.jobId, supportSessionId: null },
          (tx) => escalate(tx, row.case_id))
      } catch (error) {
        ctx.log.error({ err: error, tenantId: row.tenant_id, caseId: row.case_id }, 'dispute escalation failed; retried tomorrow')
        continue
      }
      if (escalated === null) continue
      // Mailed after the escalation commits: a failed mail never rolls it back, so no approver is mailed twice (TS-68).
      // shortcut: a mail that fails here is logged, not retried (the case still lists as overdue), move to a mail outbox when one exists.
      for (const email of escalated.emails) {
        await sendMail(ctx.config.mailDir, {
          to: email,
          subject: `Commission dispute overdue (${escalated.code})`,
          text: `The commission dispute ${row.case_id} in market ${escalated.code} passed its response date ${escalated.dueAt.toISOString()}. Decide it in Cases.`,
        }).catch((error: unknown) => ctx.log.error({ err: error, tenantId: row.tenant_id, caseId: row.case_id }, 'overdue dispute mail failed; the escalation stands'))
      }
    }
  },
})
