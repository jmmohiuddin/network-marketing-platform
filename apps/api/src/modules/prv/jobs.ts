import { eligibleApprovers, withSystem, type Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { defineSystemJob, defineTenantJob, type JobContext } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'
import { referenceOf, requesterSchema, unsealFor } from './requests.js'

const DEADLINE_BATCH = 500

const OUTCOME_TEXT: Readonly<Record<string, string>> = {
  fulfilled: 'has been completed',
  refused: 'could not be completed. Contact us if you want to know more or to make a new request',
}

/**
 * D-B5-16: tells a public-form or staff requester the outcome, after the decision committed. For an erasure the
 * requester's own sealed details are cleared once the mail is written (erasure kept them for this mail only).
 */
export const sendOutcomeJob = defineTenantJob({
  name: 'prv.send-outcome',
  payload: z.strictObject({ request_id: z.uuid() }),
  async run(tx, payload, ctx) {
    const { rows } = await tx.query<{ type: string; outcome: string | null; requester_sealed: string | null }>(
      'SELECT type, outcome, requester_sealed FROM privacy_request WHERE id = $1 FOR UPDATE', [payload.request_id])
    const request = rows[0]
    if (request?.outcome == null || request.requester_sealed === null) return
    const email = unsealFor(payload.request_id, request.requester_sealed, requesterSchema).email
    const erasure = request.type === 'erasure'
    if (erasure) await tx.query('UPDATE privacy_request SET requester_sealed = NULL WHERE id = $1', [payload.request_id])
    await recordAudit(tx, {
      action: 'PRIVACY_REQUEST.OUTCOME_SENT', objectType: 'privacy_request', objectId: payload.request_id,
      after: { mailed: email !== undefined, requester_cleared: erasure },
    })
    if (email === undefined) return
    const reference = referenceOf(payload.request_id)
    await sendMail(ctx.config.mailDir, {
      to: email,
      subject: `Your privacy request ${reference}`,
      text: `Your ${request.type} request with reference ${reference} ${OUTCOME_TEXT[request.outcome]}.`,
    })
  },
})

interface Escalation {
  readonly requestId: string
  readonly due: string
  readonly to: readonly string[]
}

// Escalates and audits in the tenant transaction; the mails are written by the caller after the commit, so a failed
// mail never rolls back an escalation whose other mails were already written (no duplicates on the next run).
async function escalate(tx: Tx, requestId: string): Promise<Escalation | null> {
  const { rows } = await tx.query<{ market_id: string | null; due: string }>(
    `UPDATE privacy_request r SET escalated_at = now() FROM case_file c
     WHERE r.id = $1 AND c.id = r.case_id AND r.escalated_at IS NULL AND r.closed_at IS NULL
     RETURNING c.market_id, to_char(r.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS due`,
    [requestId],
  )
  const request = rows[0]
  if (request === undefined) return null
  // A request without a market is handled by all-market holders only (D-B5-23).
  const holders = await eligibleApprovers(tx, {
    permission: 'privacy.manage', marketId: request.market_id, excludeUserIds: [], allMarkets: request.market_id === null,
  })
  await recordAudit(tx, {
    action: 'PRIVACY_REQUEST.ESCALATED', objectType: 'privacy_request', objectId: requestId, after: { due_at: request.due, recipients: holders.length },
  })
  return { requestId, due: request.due, to: holders.map((holder) => holder.email) }
}

async function mailEscalation(ctx: JobContext, { requestId, due, to }: Escalation): Promise<void> {
  const reference = referenceOf(requestId)
  for (const address of to) {
    await sendMail(ctx.config.mailDir, {
      to: address,
      subject: `Privacy request ${reference} is due ${due}`,
      text: `Privacy request ${reference} must be answered by ${due} (UTC). Open it in Privacy requests.`,
    })
  }
}

/** One batch of due requests; the number escalated (a failed request is logged and returned again by the next batch). */
async function escalateBatch(ctx: JobContext): Promise<{ found: number; escalated: number }> {
  const { rows } = await withSystem((tx) =>
    tx.query<{ tenant_id: string; request_id: string }>('SELECT tenant_id, request_id FROM privacy_deadline_lookup($1)', [DEADLINE_BATCH]))
  let escalated = 0
  for (const row of rows) {
    try {
      const done = await runInTenant({ tenantId: row.tenant_id, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: ctx.jobId, supportSessionId: null },
        (tx) => escalate(tx, row.request_id))
      if (done === null) continue
      escalated += 1
      await mailEscalation(ctx, done)
    } catch (error) {
      ctx.log.error({ err: error, tenantId: row.tenant_id, requestId: row.request_id }, 'privacy request escalation failed')
    }
  }
  return { found: rows.length, escalated }
}

/** D-B5-16 daily: open requests within privacy.policy.escalate_before_days of their deadline are escalated once. */
export const deadlinesCron = defineSystemJob({
  name: 'prv.requests.deadlines',
  cron: '0 6 * * *',
  async run(ctx) {
    // Batches until one is short; stops early when a whole batch failed, so persistent failures cannot loop.
    let batch: { found: number; escalated: number }
    do {
      batch = await escalateBatch(ctx)
    } while (batch.found === DEADLINE_BATCH && batch.escalated > 0)
  },
})
