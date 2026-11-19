import { randomUUID } from 'node:crypto'
import { withSystem, type Tx } from '@nmp/db'
import { z } from 'zod'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { defineSystemJob, defineTenantJob, type SystemJob, type TenantJob } from '../../lib/jobs.js'
import { auditState, factsOf, failIfSuperseded, finishInstruction, INSTRUCTION_SELECT, type InstructionRow } from './instructions.js'
import { lockLedger } from './ledger.js'
import { signatureValid } from './signing.js'

// D-B4-13/14: the dispatcher sends due sandbox instructions. MONEY SAFETY: the only adapter is the in-process sandbox
// mock below; it never opens a connection (static test in network-guard.test.ts).

export interface SubmitRequest {
  readonly providerConfigId: string
  readonly idempotencyKey: string
  readonly amountMinor: string
  readonly currency: string
}

/** accepted with the provider's reference, or a permanent rejection. An ambiguous outcome (timeout) throws. */
export type SubmitResult = { readonly accepted: true; readonly providerRef: string } | { readonly accepted: false; readonly reason: string }

export interface PayoutAdapter {
  submit(tx: Tx, request: SubmitRequest): Promise<SubmitResult>
  /** The provider's reference for the key, or null when the provider has no payment under it. */
  queryStatus(tx: Tx, request: SubmitRequest): Promise<string | null>
}

async function sandboxPayment(tx: Tx, request: SubmitRequest): Promise<string | null> {
  const { rows } = await tx.query<{ provider_ref: string }>(
    'SELECT provider_ref FROM sandbox_provider_payment WHERE provider_config_id = $1 AND idempotency_key = $2',
    [request.providerConfigId, request.idempotencyKey],
  )
  return rows[0]?.provider_ref ?? null
}

/** SANDBOX provider: at most one payment per provider and key, reference sbx_<row id>; always accepts. */
export const sandboxAdapter: PayoutAdapter = {
  async submit(tx, request) {
    const id = randomUUID()
    await tx.query(
      `INSERT INTO sandbox_provider_payment (id, tenant_id, provider_config_id, idempotency_key, amount_minor, currency, provider_ref)
       VALUES ($1, app_tenant_id(), $2, $3, $4, $5, 'sbx_' || $1::uuid::text) ON CONFLICT (tenant_id, provider_config_id, idempotency_key) DO NOTHING`,
      [id, request.providerConfigId, request.idempotencyKey, request.amountMinor, request.currency],
    )
    return { accepted: true, providerRef: (await sandboxPayment(tx, request))! }
  },
  queryStatus: sandboxPayment,
}

const BASE_DELAY_MS = 30_000
const MAX_DELAY_MS = 3_600_000
const JITTER = 0.1

/** min(30 s x 2^(attempts-1), 1 h) +- 10 %. */
export function backoffMs(attempts: number, random: number = Math.random()): number {
  const delay = Math.min(BASE_DELAY_MS * 2 ** Math.max(attempts - 1, 0), MAX_DELAY_MS)
  return Math.round(delay * (1 + JITTER * (2 * random - 1)))
}

async function accept(tx: Tx, i: InstructionRow, providerRef: string): Promise<void> {
  await tx.query(
    `UPDATE payout_instruction SET state = 'accepted', provider_ref = $2, accepted_at = now(), instructed_at = coalesce(instructed_at, now()),
       next_attempt_at = NULL, last_error = NULL WHERE id = $1`,
    [i.id, providerRef],
  )
  await auditState(tx, i.id, i.state, 'accepted')
}

/** Sends one due instruction of a sandbox provider (skipped when another worker holds it or it is not due). */
export async function dispatchInstruction(tx: Tx, id: string, adapter: PayoutAdapter, secretKey: Buffer): Promise<void> {
  const { rows: markets } = await tx.query<{ market_id: string }>(
    'SELECT b.market_id FROM payout_instruction i JOIN payout_batch b ON b.id = i.batch_id WHERE i.id = $1', [id])
  if (markets[0] === undefined) return
  await lockLedger(tx, markets[0].market_id) // lock order of every PAY writer: the ledger, then the instruction
  const { rows } = await tx.query<InstructionRow>(
    `${INSTRUCTION_SELECT} WHERE i.id = $1 AND i.state IN ('pending', 'instructed') AND i.next_attempt_at <= now()
       AND c.adapter = 'sandbox' FOR UPDATE OF i SKIP LOCKED`,
    [id],
  )
  const i = rows[0]
  if (i === undefined) return
  if (!signatureValid(secretKey, factsOf(i), i.signature)) {
    await tx.query(`UPDATE payout_instruction SET last_error = 'SIGNATURE_INVALID', next_attempt_at = NULL WHERE id = $1`, [i.id])
    await recordAudit(tx, { action: 'PAYOUT.SIGNATURE_INVALID', objectType: 'payout_instruction', objectId: i.id, after: { batch_id: i.batch_id } })
    return
  }
  const request = { providerConfigId: i.provider_config_id, idempotencyKey: i.idempotency_key, amountMinor: i.amount_minor, currency: i.currency }
  if (i.state === 'instructed') {
    // Outcome unknown: ask before sending again, so the same key never pays twice.
    const found = await adapter.queryStatus(tx, request)
    if (found !== null) return accept(tx, i, found)
  }
  if (await failIfSuperseded(tx, i)) return
  let result: SubmitResult
  try {
    result = await adapter.submit(tx, request)
  } catch {
    const attempts = i.attempts + 1
    await tx.query(
      `UPDATE payout_instruction SET state = 'instructed', attempts = $2, instructed_at = coalesce(instructed_at, now()),
         next_attempt_at = now() + make_interval(secs => $3::double precision / 1000), last_error = 'PROVIDER_OUTCOME_UNKNOWN' WHERE id = $1`,
      [i.id, attempts, backoffMs(attempts)],
    )
    if (i.state !== 'instructed') await auditState(tx, i.id, i.state, 'instructed')
    return
  }
  await tx.query('UPDATE payout_instruction SET attempts = attempts + 1 WHERE id = $1', [i.id])
  if (result.accepted) return accept(tx, i, result.providerRef)
  await finishInstruction(tx, i, 'failed', result.reason)
}

const DUE_LIMIT = 500
const systemActor = (requestId: string) => ({ actorType: 'system' as const, requestId, supportSessionId: null })

export interface DispatchDeps {
  readonly adapter: PayoutAdapter
}

/** Cron pay.instructions.dispatch (every minute): every due sandbox instruction of every tenant, one transaction each. */
export function dispatchCron(deps: DispatchDeps): SystemJob {
  return defineSystemJob({
    name: 'pay.instructions.dispatch',
    cron: '* * * * *',
    async run(ctx) {
      const { rows } = await withSystem((tx) =>
        tx.query<{ tenant_id: string; instruction_id: string }>('SELECT tenant_id, instruction_id FROM pay_due_instructions($1)', [DUE_LIMIT]))
      for (const row of rows) {
        try {
          await runInTenant({ tenantId: row.tenant_id, userId: SYSTEM_ACTOR_ID }, systemActor(ctx.jobId), (tx) =>
            dispatchInstruction(tx, row.instruction_id, deps.adapter, ctx.config.secretKey))
        } catch (error) {
          ctx.log.error({ err: error, tenantId: row.tenant_id, instructionId: row.instruction_id }, 'payout instruction dispatch failed')
        }
      }
    },
  })
}

/** Tenant job pay.batch.dispatch, enqueued at approval and retry: the batch's due instructions right away. */
export function batchDispatchJob(deps: DispatchDeps): TenantJob<{ batchId: string }> {
  return defineTenantJob({
    name: 'pay.batch.dispatch',
    payload: z.strictObject({ batchId: z.uuid() }),
    async run(tx, payload, ctx) {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM payout_instruction WHERE batch_id = $1 AND state IN ('pending', 'instructed') ORDER BY id`, [payload.batchId])
      for (const row of rows) await dispatchInstruction(tx, row.id, deps.adapter, ctx.config.secretKey)
    },
  })
}
