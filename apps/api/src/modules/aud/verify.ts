import { withSystem, type Tx } from '@nmp/db'
import { z } from 'zod'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { defineSystemJob, defineTenantJob, enqueue } from '../../lib/jobs.js'
import { enqueueOutbox } from '../../lib/outbox.js'

export interface ChainVerification {
  readonly intact: boolean
  readonly first_broken_seq: string | null
  /** Events checked: 0 means nothing was visible, not that a chain was proven intact. */
  readonly events: string
  readonly verified_at: Date
}

/**
 * Verifies the tenant's hash chain (AC-54.2, SEC-38). audit.verify_audit_chain is SECURITY INVOKER, so it
 * runs in the tenant's own transaction and sees exactly the tenant's events.
 */
export async function verifyChain(tx: Tx): Promise<ChainVerification> {
  const { rows } = await tx.query<{ first_broken: string | null; events: string }>(
    `SELECT audit.verify_audit_chain(app_tenant_id()) AS first_broken,
            (SELECT count(*) FROM audit.audit_event) AS events`,
  )
  const row = rows[0]!
  return { intact: row.first_broken === null, first_broken_seq: row.first_broken, events: row.events, verified_at: new Date() }
}

/** Per tenant: verify, and on a break raise the alert (outbox audit.chain.broken plus an error log line). */
export const verifyTenantChainJob = defineTenantJob({
  name: 'aud.verify-tenant-chain',
  payload: z.strictObject({}),
  async run(tx, _payload, ctx) {
    const result = await verifyChain(tx)
    if (result.intact) return
    ctx.log.error({ firstBrokenSeq: result.first_broken_seq }, 'audit chain broken')
    await enqueueOutbox(tx, { type: 'audit.chain.broken', key: 'audit-chain', payload: { first_broken_seq: result.first_broken_seq } })
  },
})

const DAILY_AT_0315_UTC = '15 3 * * *'

/** Daily (SEC-38): one verification job per tenant that is not archived. */
export const verifyAllChainsJob = defineSystemJob({
  name: 'aud.verify-chains',
  cron: DAILY_AT_0315_UTC,
  async run(ctx) {
    const { rows } = await withSystem((tx) => tx.query<{ id: string }>('SELECT system_tenant_ids() AS id'))
    for (const { id } of rows) {
      const actor = { actorType: 'system' as const, requestId: ctx.jobId, supportSessionId: null }
      await runInTenant({ tenantId: id, userId: SYSTEM_ACTOR_ID }, actor, (tx) => enqueue(tx, verifyTenantChainJob, {}))
    }
  },
})
