import { withSystem, type Tx } from '@nmp/db'
import type { FastifyBaseLogger } from 'fastify'
import type { Config } from '../../config.js'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { defineSystemJob } from '../../lib/jobs.js'
import { sendMail } from '../../lib/mailer.js'
import { renderNotification } from './templates.js'

// D-B5-14 delivery: queued email rows are claimed one per transaction (FOR UPDATE SKIP LOCKED), rendered, and mailed to the
// contact email on record at send time (MAIL_DIR only). No address -> undeliverable; a failed write retries with
// backoff and ends failed after MAX_ATTEMPTS. The in-app row stays the fallback channel either way.

const DUE_LIMIT = 500
export const MAX_ATTEMPTS = 5
const BACKOFF_BASE_MS = 60_000
const BACKOFF_CAP_MS = 3_600_000
const LAST_ERROR_MAX = 500

/** Wait before attempt `attempts + 1`: min(1 min x 2^(attempts - 1), 1 h). */
export const backoffMs = (attempts: number): number => Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS)

interface DueRow {
  readonly id: string
  readonly template: string
  readonly params: unknown
  readonly locale: string
  readonly attempts: number
  readonly email: string | null
  readonly time_zone: string
}

/** The outcome's state change and its audit event (ids only), in the transaction that claimed the row. */
async function settle(tx: Tx, row: DueRow, action: string, update: string, params: readonly unknown[] = []): Promise<void> {
  await tx.query(update, [row.id, ...params])
  await recordAudit(tx, { action, objectType: 'notification', objectId: row.id, after: { template: row.template } })
}

async function deliverOne(tx: Tx, row: DueRow, config: Config, log: FastifyBaseLogger): Promise<void> {
  if (row.email === null || row.email === '') {
    await settle(tx, row, 'NOTIFICATION.UNDELIVERABLE', `UPDATE notification SET state = 'undeliverable', next_attempt_at = NULL WHERE id = $1`)
    return
  }
  try {
    await sendMail(config.mailDir, { to: row.email, ...renderNotification(row.template, row.params, row.locale, row.time_zone, config.webUrl, log) })
  } catch (error) {
    const attempts = row.attempts + 1
    const failed = attempts >= MAX_ATTEMPTS
    await settle(tx, row, failed ? 'NOTIFICATION.FAILED' : 'NOTIFICATION.RETRY_SCHEDULED',
      `UPDATE notification SET state = $2, attempts = $3, last_error = left($4, ${LAST_ERROR_MAX}),
         next_attempt_at = CASE WHEN $2 = 'failed' THEN NULL ELSE now() + make_interval(secs => $5::double precision / 1000) END
       WHERE id = $1`,
      [failed ? 'failed' : 'queued', attempts, error instanceof Error ? error.message : 'mail not written', backoffMs(attempts)])
    return
  }
  await settle(tx, row, 'NOTIFICATION.SENT',
    `UPDATE notification SET state = 'sent', attempts = attempts + 1, sent_at = now(), next_attempt_at = NULL WHERE id = $1`)
}

/** One due email row of the tenant, if still due and no other worker holds it. */
async function deliverDue(tx: Tx, id: string, config: Config, log: FastifyBaseLogger): Promise<void> {
  const { rows } = await tx.query<DueRow>(
    `SELECT n.id, n.template, n.params, n.locale, n.attempts, x.contact ->> 'email' AS email, m.time_zone
     FROM notification n
     JOIN participant x ON x.tenant_id = n.tenant_id AND x.id = n.recipient_participant_id
     JOIN market m ON m.tenant_id = x.tenant_id AND m.id = x.market_id
     WHERE n.id = $1 AND n.channel = 'email' AND n.state = 'queued' AND n.next_attempt_at <= now()
     FOR UPDATE OF n SKIP LOCKED`,
    [id],
  )
  if (rows[0] !== undefined) await deliverOne(tx, rows[0], config, log)
}

/**
 * Cron dist.notifications.deliver (every minute): one transaction per row, so a written mail is followed by its
 * committed state at once (a later failure never sends it again).
 */
export const deliverCron = defineSystemJob({
  name: 'dist.notifications.deliver',
  cron: '* * * * *',
  async run(ctx) {
    const { rows } = await withSystem((tx) =>
      tx.query<{ tenant_id: string; notification_id: string }>('SELECT tenant_id, notification_id FROM dist_due_notifications($1)', [DUE_LIMIT]))
    const actor = { actorType: 'system' as const, requestId: ctx.jobId, supportSessionId: null }
    for (const row of rows) {
      try {
        await runInTenant({ tenantId: row.tenant_id, userId: SYSTEM_ACTOR_ID }, actor, (tx) => deliverDue(tx, row.notification_id, ctx.config, ctx.log))
      } catch (error) {
        ctx.log.error({ err: error, tenantId: row.tenant_id, notificationId: row.notification_id }, 'notification delivery failed')
      }
    }
  },
})
