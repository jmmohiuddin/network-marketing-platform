import { eligibleApprovers, withSystem, type Tx } from '@nmp/db'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { defineSystemJob } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'
import { escalateCase } from '../cas/index.js'

// D-BM-08 escalation: once per deadline (ack while open, resolution while submitted) from due - escalation_lead_hours
// (absent: at the deadline), as SQL cpl_grievance_escalation_due and the case-event guard decide. Ids only in events,
// audit, logs and mails: a grievance holds no personal data.

const BATCH = 1000

type Deadline = 'ack' | 'resolution'

interface Escalated { readonly code: string; readonly dueAt: string; readonly emails: readonly string[] }

async function escalate(tx: Tx, caseId: string, deadline: Deadline): Promise<Escalated | null> {
  const { rows } = await tx.query<{ market_id: string; code: string; due_at: string }>(
    `SELECT c.market_id, m.code, json_instant(CASE $2::text WHEN 'ack' THEN d.ack_due_at ELSE d.resolution_due_at END) AS due_at
     FROM case_file c JOIN market m ON m.id = c.market_id CROSS JOIN LATERAL cpl_grievance_deadlines(c.id) d
     WHERE c.id = $1 AND cpl_grievance_escalation_due(c.id, $2)
     FOR UPDATE OF c`,
    [caseId, deadline],
  )
  const grievance = rows[0]
  if (grievance === undefined) return null
  const approvers = await eligibleApprovers(tx, { permission: 'case.grievance.approve', marketId: grievance.market_id, excludeUserIds: [] })
  await escalateCase(tx, caseId, { deadline, due_at: grievance.due_at, notified: approvers.length })
  return { code: grievance.code, dueAt: grievance.due_at, emails: approvers.map((approver) => approver.email) }
}

const mailText = (caseId: string, deadline: Deadline, e: Escalated) => ({
  subject: `Grievance ${deadline === 'ack' ? 'acknowledgement' : 'resolution'} due (${e.code})`,
  text: `The grievance ${caseId} in market ${e.code} must be ${deadline === 'ack' ? 'acknowledged' : 'resolved'} by ${e.dueAt}. Handle it in Cases.`,
})

/** Hourly at :15 (PLAN B-MKT section 4.3): candidates across tenants, then one tenant transaction per grievance. */
export const grievanceEscalationJob = defineSystemJob({
  name: 'cpl.grievances.escalate',
  cron: '15 * * * *',
  async run(ctx) {
    const { rows } = await withSystem((tx) =>
      tx.query<{ tenant_id: string; case_id: string; deadline: Deadline }>('SELECT tenant_id, case_id, deadline FROM cpl_grievances_to_escalate($1)', [BATCH]))
    const actor = { actorType: 'system' as const, requestId: ctx.jobId, supportSessionId: null }
    for (const row of rows) {
      let escalated: Escalated | null
      try {
        escalated = await runInTenant({ tenantId: row.tenant_id, userId: SYSTEM_ACTOR_ID }, actor, (tx) => escalate(tx, row.case_id, row.deadline))
      } catch (error) {
        // A guard refusal or the once-per-deadline index: a concurrent run escalated it first.
        ctx.log.error({ err: error, tenantId: row.tenant_id, caseId: row.case_id, deadline: row.deadline }, 'grievance escalation failed; skipped')
        continue
      }
      if (escalated === null) continue
      // Mailed after the escalation commits: a failed mail never rolls it back, so no approver is mailed twice.
      // shortcut: a mail that fails here is logged, not retried (the register shows the escalation), move to a mail outbox when one exists.
      for (const email of escalated.emails) {
        await sendMail(ctx.config.mailDir, { to: email, ...mailText(row.case_id, row.deadline, escalated) })
          .catch((error: unknown) => ctx.log.error({ err: error, tenantId: row.tenant_id, caseId: row.case_id }, 'grievance escalation mail failed; the escalation stands'))
      }
    }
  },
})
