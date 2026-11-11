import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, runInVendor, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { defineSystemJob } from '../../lib/jobs.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { REQUEST_TTL_MINUTES } from './sessions.js'

const EVERY_MINUTE = '* * * * *'

// Support sessions are vendor-visible metadata, so the vendor realm finds the tenants with work to do.
async function tenantsWithDueSessions(requestId: string): Promise<string[]> {
  const actor = { actorType: 'system' as const, requestId, supportSessionId: null }
  const { rows } = await runInVendor(SYSTEM_ACTOR_ID, actor, (tx) =>
    tx.query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id FROM support_session
       WHERE (state IN ('approved', 'active') AND ends_at <= now())
          OR (state = 'requested' AND created_at <= now() - make_interval(mins => $1))`,
      [REQUEST_TTL_MINUTES],
    ),
  )
  return rows.map((row) => row.tenant_id)
}

async function close(tx: Tx, sql: string, action: string, params: unknown[] = []): Promise<number> {
  const { rows } = await tx.query<{ id: string; before: string }>(sql, params)
  for (const { id, before } of rows) {
    await recordAudit(tx, { action, objectType: 'support_session', objectId: id, before: { state: before } })
    // The session report to the tenant (SECURITY_IAM_TENANCY 5.1 step 6): GET /v1/support-sessions/{id}/log.
    await enqueueOutbox(tx, { type: 'support_session.closed', key: id, payload: { support_session_id: id, action } })
  }
  return rows.length
}

/**
 * The tenant's due sessions, in its own transaction as the system actor: a window that has run out ends
 * as expired (approved but never used included); a request undecided for REQUEST_TTL_MINUTES is auto-denied
 * (decided_by stays NULL). Access itself already stops at ends_at (supportSessionAccess checks the window).
 */
function closeDueSessions(tenantId: string, requestId: string): Promise<number> {
  const actor = { actorType: 'system' as const, requestId, supportSessionId: null }
  return runInTenant({ tenantId, userId: SYSTEM_ACTOR_ID }, actor, async (tx) => {
    const expired = await close(
      tx,
      `UPDATE support_session s SET state = 'expired' FROM support_session o
       WHERE s.id = o.id AND s.state IN ('approved', 'active') AND s.ends_at <= now() RETURNING s.id, o.state AS before`,
      'SUPPORT_SESSION.EXPIRED',
    )
    const denied = await close(
      tx,
      `UPDATE support_session s SET state = 'denied' FROM support_session o
       WHERE s.id = o.id AND s.state = 'requested' AND s.created_at <= now() - make_interval(mins => $1)
       RETURNING s.id, o.state AS before`,
      'SUPPORT_SESSION.AUTO_DENIED',
      [REQUEST_TTL_MINUTES],
    )
    return expired + denied
  })
}

/** Every minute (FR-IAM-005 auto-expiry): closes due sessions tenant by tenant. */
export const expireSupportSessionsJob = defineSystemJob({
  name: 'support.expire-sessions',
  cron: EVERY_MINUTE,
  async run(ctx) {
    for (const tenantId of await tenantsWithDueSessions(ctx.jobId)) await closeDueSessions(tenantId, ctx.jobId)
  },
})
