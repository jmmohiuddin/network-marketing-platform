import { randomUUID } from 'node:crypto'
import type { Tx } from '@nmp/db'
import { recordAudit } from '../../lib/audit.js'
import { enqueue } from '../../lib/jobs.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { openSystemCase } from '../cas/index.js'
import { postInstruction } from './ledger.js'
import { noticeJob } from './notices.js'
import { signInstruction, type SignedFacts } from './signing.js'

// D-B4-13/15: an instruction is written pending with its posting #2 (it is the outbox record the dispatcher works);
// it ends settled, returned or failed with posting #3/#4, the batch state and the period's Paid flip.

export interface InstructionRow {
  readonly id: string
  readonly tenant_id: string
  readonly batch_id: string
  readonly market_id: string
  readonly period_id: string
  readonly payee_participant_id: string
  readonly bank_detail_version_id: string
  readonly amount_minor: string
  readonly currency: string
  readonly idempotency_key: string
  readonly signature: Buffer
  readonly state: string
  readonly provider_ref: string | null
  readonly attempts: number
  readonly provider_config_id: string
  readonly adapter: string | null
  readonly bank_detail_superseded: boolean
}

/** Joins the batch; callers add WHERE and locking. */
export const INSTRUCTION_SELECT = `
  SELECT i.id, i.tenant_id, i.batch_id, b.market_id, b.period_id, i.payee_participant_id, i.bank_detail_version_id,
         i.amount_minor::text AS amount_minor, i.currency, i.idempotency_key, i.signature, i.state, i.provider_ref, i.attempts,
         b.provider_config_id, c.adapter,
         (SELECT v.superseded_at IS NOT NULL FROM bank_detail_version v WHERE v.id = i.bank_detail_version_id) AS bank_detail_superseded
  FROM payout_instruction i JOIN payout_batch b ON b.id = i.batch_id JOIN provider_config c ON c.id = b.provider_config_id`

export const factsOf = (i: InstructionRow): SignedFacts => ({
  tenantId: i.tenant_id, instructionId: i.id, payeeId: i.payee_participant_id, bankDetailVersionId: i.bank_detail_version_id,
  amountMinor: i.amount_minor, currency: i.currency, idempotencyKey: i.idempotency_key,
})

export interface NewInstruction {
  readonly batchId: string
  readonly marketId: string
  readonly periodId: string
  readonly payeeId: string
  readonly bankDetailVersionId: string
  readonly amountMinor: string
  readonly currency: string
  readonly retryOf: string | null
}

/** Inserts a signed pending instruction (due now) and posts it as instructed with the batch approval. */
export async function createInstruction(tx: Tx, secretKey: Buffer, input: NewInstruction, approvalId: string): Promise<string> {
  const id = randomUUID()
  const { rows } = await tx.query<{ tenant_id: string }>('SELECT app_tenant_id() AS tenant_id')
  const signature = signInstruction(secretKey, {
    tenantId: rows[0]!.tenant_id, instructionId: id, payeeId: input.payeeId, bankDetailVersionId: input.bankDetailVersionId,
    amountMinor: input.amountMinor, currency: input.currency, idempotencyKey: id,
  })
  await tx.query(
    `INSERT INTO payout_instruction (id, tenant_id, batch_id, payee_participant_id, bank_detail_version_id, amount_minor, currency,
       idempotency_key, signature, next_attempt_at, retry_of)
     VALUES ($1, app_tenant_id(), $2, $3, $4, $5, $6, $1::uuid::text, $7, now(), $8)`,
    [id, input.batchId, input.payeeId, input.bankDetailVersionId, input.amountMinor, input.currency, signature, input.retryOf],
  )
  await postInstruction(tx, 'instructed', { id, marketId: input.marketId, periodId: input.periodId, payeeId: input.payeeId, amountMinor: input.amountMinor }, approvalId)
  return id
}

export async function auditState(tx: Tx, id: string, from: string, to: string, extra: Record<string, unknown> = {}): Promise<void> {
  await recordAudit(tx, { action: 'PAYOUT.INSTRUCTION_STATE', objectType: 'payout_instruction', objectId: id, before: { state: from }, after: { state: to, ...extra } })
}

/** SQL: instruction `i` has not been replaced by a retry (D-B4-12); replaced instructions no longer count for their batch. */
export const NOT_RETRIED = 'NOT EXISTS (SELECT 1 FROM payout_instruction r WHERE r.retry_of = i.id)'

// The batch follows its instructions (those no retry replaced): some terminal -> partially_settled; all terminal: all
// settled -> settled, any failed -> failed, otherwise (returned) partially_settled (D-B4-12).
const NEXT_BATCH_STATE = `
  WITH live AS (
    SELECT i.state FROM payout_instruction i
    WHERE i.batch_id = $1 AND ${NOT_RETRIED}
  ), counts AS (
    SELECT count(*) AS total, count(*) FILTER (WHERE state IN ('settled', 'returned', 'failed', 'cancelled')) AS terminal,
           count(*) FILTER (WHERE state = 'settled') AS settled, count(*) FILTER (WHERE state = 'failed') AS failed
    FROM live
  )
  SELECT b.state AS current,
         CASE WHEN c.terminal = 0 THEN b.state
              WHEN c.terminal < c.total THEN 'partially_settled'
              WHEN c.settled = c.total THEN 'settled'
              WHEN c.failed > 0 THEN 'failed'
              ELSE 'partially_settled' END AS next
  FROM payout_batch b, counts c WHERE b.id = $1 FOR UPDATE OF b`

export async function refreshBatchState(tx: Tx, batchId: string): Promise<void> {
  const { rows } = await tx.query<{ current: string; next: string }>(NEXT_BATCH_STATE, [batchId])
  const { current, next } = rows[0]!
  if (current === next || !['instructing', 'partially_settled'].includes(current)) return
  await tx.query('UPDATE payout_batch SET state = $2 WHERE id = $1', [batchId, next])
  await recordAudit(tx, { action: 'PAYOUT.BATCH_STATE', objectType: 'payout_batch', objectId: batchId, before: { state: current }, after: { state: next } })
}

export type TerminalState = 'settled' | 'returned' | 'failed'

/** Moves a live instruction to a terminal state with its posting, the batch state, the returned-payment case and Paid. */
export async function finishInstruction(tx: Tx, i: InstructionRow, state: TerminalState, reason: string | null): Promise<void> {
  await tx.query(
    `UPDATE payout_instruction SET state = $2, terminal_at = now(), next_attempt_at = NULL,
       last_error = CASE WHEN $2 = 'settled' THEN last_error ELSE left($3, 500) END WHERE id = $1`,
    [i.id, state, reason],
  )
  await postInstruction(tx, state, { id: i.id, marketId: i.market_id, periodId: i.period_id, payeeId: i.payee_participant_id, amountMinor: i.amount_minor }, null)
  await auditState(tx, i.id, i.state, state)
  const event = { instruction_id: i.id, batch_id: i.batch_id, participant_id: i.payee_participant_id, amount_minor: i.amount_minor }
  if (state === 'settled') await enqueueOutbox(tx, { type: 'payout.settled', payload: event, key: i.id })
  if (state === 'returned') {
    const opened = await openSystemCase(tx, {
      type: 'returned_payment', subjectType: 'payout_instruction', subjectId: i.id, reasonCode: 'RETURNED_BY_BANK',
      payload: { instruction_id: i.id }, marketId: i.market_id,
    })
    await enqueue(tx, noticeJob, { template: 'payout.returned', participant_id: i.payee_participant_id, ref_id: i.id })
    await enqueueOutbox(tx, { type: 'payout.returned', payload: { ...event, case_id: opened.id }, key: i.id })
  }
  await refreshBatchState(tx, i.batch_id)
  const { rows } = await tx.query<{ paid: boolean }>('SELECT period_mark_paid($1) AS paid', [i.period_id])
  if (rows[0]!.paid) await recordAudit(tx, { action: 'PERIOD.PAID', objectType: 'period', objectId: i.period_id, before: { state: 'committed' }, after: { state: 'paid' } })
}

/**
 * D-B4-12: a superseded account is never paid. An instruction not yet sent whose pinned version was superseded after
 * approval fails (posting #4 returns the amount to the payable); retry-failed pins the payee's current version.
 */
export async function failIfSuperseded(tx: Tx, i: InstructionRow): Promise<boolean> {
  if (!i.bank_detail_superseded) return false
  await finishInstruction(tx, i, 'failed', 'BANK_DETAIL_SUPERSEDED')
  return true
}
