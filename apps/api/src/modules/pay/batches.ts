import { eligibleApprovers, type Tx } from '@nmp/db'
import type { FastifyRequest } from 'fastify'
import { recordAudit } from '../../lib/audit.js'
import type { AuthContext } from '../../lib/auth.js'
import { ApiError, notFound } from '../../lib/errors.js'
import { envelope } from '../../lib/http.js'
import type { StoredResponse } from '../../lib/idempotency.js'
import { enqueue } from '../../lib/jobs.js'
import { enqueueOutbox } from '../../lib/outbox.js'
import { approveOrRefuse } from '../ten/index.js'
import { batchDispatchJob, sandboxAdapter } from './dispatch.js'
import { createInstruction, NOT_RETRIED } from './instructions.js'
import { lockLedger } from './ledger.js'
import { candidates, marketPolicy, split, type Exclusion, type Line } from './selection.js'

// D-B4-12: payout batches. One open (draft/reviewed) batch per market; lines are the full payables of the payees no
// exclusion applies to; submit and approve recalculate; approval writes the signed instructions and posting #2 in one
// transaction under the ledger lock.

export type Scope = readonly string[] | null
const inScope = (scope: Scope, marketId: string) => scope === null || scope.includes(marketId)

const OPEN_STATES = ['draft', 'reviewed']
const participant = (id: string) =>
  `(SELECT jsonb_build_object('id', x.id, 'external_ref', x.external_ref, 'display_name', x.display_name) FROM participant x WHERE x.id = ${id})`

const BATCH_VIEW = `
  SELECT b.id, jsonb_build_object('id', m.id, 'code', m.code) AS market,
         jsonb_build_object('id', c.id, 'provider', c.provider, 'adapter', c.adapter, 'state', c.state) AS provider,
         jsonb_build_object('id', p.id, 'starts_at', p.starts_at, 'ends_at', p.ends_at, 'state', p.state) AS period,
         b.state, b.total_minor::text AS total_minor, b.currency,
         (SELECT count(*)::int FROM payout_batch_line l WHERE l.batch_id = b.id) AS line_count,
         coalesce((SELECT jsonb_agg(jsonb_build_object('participant', ${participant(`(e ->> 'participant_id')::uuid`)}, 'reasons', e -> 'reasons'))
                   FROM jsonb_array_elements(b.exclusions) e), '[]') AS exclusions,
         coalesce((SELECT jsonb_object_agg(s.state, s.n) FROM (SELECT i.state, count(*) AS n FROM payout_instruction i
                   WHERE i.batch_id = b.id AND ${NOT_RETRIED} GROUP BY i.state) s), '{}') AS instruction_counts,
         jsonb_build_object('id', pu.id, 'display_name', pu.display_name) AS prepared_by,
         CASE WHEN su.id IS NOT NULL THEN jsonb_build_object('id', su.id, 'display_name', su.display_name) END AS submitted_by,
         CASE WHEN au.id IS NOT NULL THEN jsonb_build_object('id', au.id, 'display_name', au.display_name) END AS approved_by,
         b.submitted_at, b.approved_at, b.cancelled_at, b.cancel_reason, b.created_at
  FROM payout_batch b JOIN market m ON m.id = b.market_id JOIN provider_config c ON c.id = b.provider_config_id
  JOIN period p ON p.id = b.period_id JOIN user_account pu ON pu.id = b.prepared_by
  LEFT JOIN user_account su ON su.id = b.submitted_by
  LEFT JOIN approval a ON a.id = b.approval_id LEFT JOIN user_account au ON au.id = a.approver_id`

export interface BatchView {
  readonly id: string
  readonly market: { id: string; code: string }
  readonly state: string
  readonly [field: string]: unknown
}

export async function batchView(tx: Tx, id: string): Promise<BatchView> {
  const { rows } = await tx.query<BatchView>(`${BATCH_VIEW} WHERE b.id = $1`, [id])
  return rows[0]!
}

export interface BatchFilter {
  readonly market_id?: string | undefined
  readonly state?: string | undefined
}

export async function listBatches(tx: Tx, scope: Scope, filter: BatchFilter, after: [string, string] | undefined, limit: number): Promise<BatchView[]> {
  const { rows } = await tx.query<BatchView>(
    `${BATCH_VIEW}
     WHERE ($1::uuid[] IS NULL OR b.market_id = ANY ($1)) AND ($2::uuid IS NULL OR b.market_id = $2) AND ($3::text IS NULL OR b.state = $3)
       AND ($4::timestamptz IS NULL OR (b.created_at, b.id) < ($4, $5::uuid))
     ORDER BY b.created_at DESC, b.id DESC LIMIT $6`,
    [scope, filter.market_id ?? null, filter.state ?? null, after?.[0] ?? null, after?.[1] ?? null, limit + 1],
  )
  return rows
}

/** The batch with its eligible approvers while it waits for approval (404 outside the scope). */
export async function batchDetail(tx: Tx, id: string, scope: Scope): Promise<BatchView> {
  const batch = await findBatch(tx, id, scope)
  const view = await batchView(tx, id)
  if (batch.state !== 'reviewed') return { ...view, eligible_approvers: null }
  const eligible = await eligibleApprovers(tx, {
    permission: 'payout.approve', marketId: batch.market_id, excludeUserIds: [batch.prepared_by, batch.submitted_by!, ...await relatedToLines(tx, id)],
  })
  return { ...view, eligible_approvers: eligible }
}

export interface BatchRow {
  readonly id: string
  readonly market_id: string
  readonly provider_config_id: string
  readonly period_id: string
  readonly state: string
  readonly currency: string
  readonly prepared_by: string
  readonly submitted_by: string | null
  readonly approval_id: string | null
}

/** The batch if its market is in scope, else 404; with lock: the market's ledger lock, then the row FOR UPDATE. */
export async function findBatch(tx: Tx, id: string, scope: Scope, lock = false): Promise<BatchRow> {
  const select = 'SELECT id, market_id, provider_config_id, period_id, state, currency, prepared_by, submitted_by, approval_id FROM payout_batch WHERE id = $1'
  const { rows } = await tx.query<BatchRow>(select, [id])
  const found = rows[0]
  if (found === undefined || !inScope(scope, found.market_id)) throw notFound()
  if (!lock) return found
  await lockLedger(tx, found.market_id)
  return (await tx.query<BatchRow>(`${select} FOR UPDATE`, [id])).rows[0]!
}

const batchState = (state: string) => new ApiError(409, 'BATCH_STATE', `The batch is ${state}: this action is not possible now.`, { state })
const providerNotEligible = () =>
  new ApiError(422, 'PROVIDER_NOT_ELIGIBLE', 'The payout provider is not a recorded payout provider of the market with a sandbox or bank-file adapter.')

/**
 * The market row FOR SHARE first (withdrawProvider locks it FOR UPDATE before its in-flight check), then the provider
 * check in a fresh statement: a withdrawal either waits for this transaction and then sees its instructions (409), or
 * commits first and this check sees it withdrawn (AC-PAY1-2: no money in flight on a withdrawn provider).
 */
async function assertProviderEligible(tx: Tx, providerId: string, marketId: string): Promise<void> {
  await tx.query('SELECT 1 FROM market WHERE id = $1 FOR SHARE', [marketId])
  const { rowCount } = await tx.query(
    `SELECT 1 FROM provider_config WHERE id = $1 AND market_id = $2 AND kind = 'payout' AND state = 'recorded' AND adapter IS NOT NULL`,
    [providerId, marketId],
  )
  if (rowCount === 0) throw providerNotEligible()
}

async function writeLines(tx: Tx, batchId: string, lines: readonly Line[], exclusions: readonly Exclusion[]): Promise<void> {
  await tx.query('DELETE FROM payout_batch_line WHERE batch_id = $1', [batchId])
  for (const line of lines) {
    await tx.query(
      `INSERT INTO payout_batch_line (tenant_id, batch_id, participant_id, amount_minor, bank_detail_version_id) VALUES (app_tenant_id(), $1, $2, $3, $4)`,
      [batchId, line.participant_id, line.amount_minor, line.bank_detail_version_id],
    )
  }
  const total = lines.reduce((sum, line) => sum + BigInt(line.amount_minor), 0n)
  await tx.query('UPDATE payout_batch SET total_minor = $2, exclusions = $3::jsonb WHERE id = $1', [batchId, total.toString(), JSON.stringify(exclusions)])
}

export interface NewBatch {
  readonly market_id: string
  readonly provider_config_id: string
}

export async function prepareBatch(tx: Tx, scope: Scope, input: NewBatch): Promise<BatchView> {
  if (!inScope(scope, input.market_id)) {
    throw new ApiError(403, 'SCOPE_NOT_HELD', 'Your payout.prepare permission does not cover this market.', { permission: 'payout.prepare' })
  }
  const { rows: markets } = await tx.query<{ currency: string }>('SELECT currency FROM market WHERE id = $1', [input.market_id])
  if (markets[0] === undefined) {
    throw new ApiError(422, 'VALIDATION_FAILED', 'market_id is not valid: no such market.', { issues: [{ path: 'market_id', message: 'no such market' }] })
  }
  await lockLedger(tx, input.market_id)
  const { rows: open } = await tx.query<{ id: string }>('SELECT id FROM payout_batch WHERE market_id = $1 AND state = ANY ($2)', [input.market_id, OPEN_STATES])
  if (open[0] !== undefined) throw new ApiError(409, 'BATCH_OPEN', 'The market already has an open payout batch.', { batch_id: open[0].id })
  await assertProviderEligible(tx, input.provider_config_id, input.market_id)
  const { rows: periods } = await tx.query<{ id: string | null }>('SELECT led_attribution_period($1) AS id', [input.market_id])
  const periodId = periods[0]!.id
  if (periodId === null) throw new ApiError(422, 'NO_COMMITTED_PERIOD', 'The market has no committed period to pay.')
  const { lines, exclusions } = split(await candidates(tx, input.market_id, await marketPolicy(tx, input.market_id)))
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO payout_batch (tenant_id, market_id, provider_config_id, period_id, currency, prepared_by)
     VALUES (app_tenant_id(), $1, $2, $3, $4, app_user_id()) RETURNING id`,
    [input.market_id, input.provider_config_id, periodId, markets[0].currency],
  )
  const id = rows[0]!.id
  await writeLines(tx, id, lines, exclusions)
  await recordAudit(tx, {
    action: 'PAYOUT.BATCH_PREPARED', objectType: 'payout_batch', objectId: id,
    after: { market_id: input.market_id, provider_config_id: input.provider_config_id, period_id: periodId, line_count: lines.length, excluded_count: exclusions.length },
  })
  return batchView(tx, id)
}

interface Recalculation {
  readonly lines: Line[]
  readonly exclusions: Exclusion[]
  readonly changed: { participant_id: string; before_minor: string | null; after_minor: string | null }[]
}

async function recalculate(tx: Tx, batch: BatchRow): Promise<Recalculation> {
  const { lines, exclusions } = split(await candidates(tx, batch.market_id, await marketPolicy(tx, batch.market_id)))
  const { rows: stored } = await tx.query<Line>(
    'SELECT participant_id, amount_minor::text AS amount_minor, bank_detail_version_id FROM payout_batch_line WHERE batch_id = $1', [batch.id])
  const key = (line: Line) => `${line.amount_minor}:${line.bank_detail_version_id}`
  const before = new Map(stored.map((line) => [line.participant_id, line]))
  const after = new Map(lines.map((line) => [line.participant_id, line]))
  const changed = [...new Set([...before.keys(), ...after.keys()])].sort()
    .filter((id) => before.get(id) === undefined || after.get(id) === undefined || key(before.get(id)!) !== key(after.get(id)!))
    .map((id) => ({ participant_id: id, before_minor: before.get(id)?.amount_minor ?? null, after_minor: after.get(id)?.amount_minor ?? null }))
  return { lines, exclusions, changed }
}

/** 409 BATCH_RECALCULATED as a stored response: the rewritten draft commits with it (D-B4-12). */
async function recalculated(tx: Tx, request: FastifyRequest, batch: BatchRow, result: Recalculation): Promise<StoredResponse> {
  if (batch.state !== 'draft') await tx.query(`UPDATE payout_batch SET state = 'draft' WHERE id = $1`, [batch.id])
  await writeLines(tx, batch.id, result.lines, result.exclusions)
  await recordAudit(tx, {
    action: 'PAYOUT.BATCH_RECALCULATED', objectType: 'payout_batch', objectId: batch.id,
    before: { state: batch.state }, after: { state: 'draft', changed: result.changed },
  })
  return {
    statusCode: 409,
    body: { error: { code: 'BATCH_RECALCULATED', message: 'Payables changed since the batch was prepared: its lines were recalculated and it is a draft again.', details: { changed: result.changed }, request_id: request.id } },
  }
}

export async function submitBatch(tx: Tx, request: FastifyRequest, id: string, scope: Scope): Promise<StoredResponse> {
  const batch = await findBatch(tx, id, scope, true)
  if (batch.state !== 'draft') throw batchState(batch.state)
  await assertProviderEligible(tx, batch.provider_config_id, batch.market_id)
  const result = await recalculate(tx, batch)
  if (result.changed.length > 0) return recalculated(tx, request, batch, result)
  if (result.lines.length === 0) throw new ApiError(422, 'BATCH_EMPTY', 'The batch has no lines to pay.')
  await tx.query(
    `UPDATE payout_batch SET state = 'reviewed', submitted_by = app_user_id(), submitted_at = now(), exclusions = $2::jsonb WHERE id = $1`,
    [id, JSON.stringify(result.exclusions)],
  )
  await recordAudit(tx, { action: 'PAYOUT.BATCH_SUBMITTED', objectType: 'payout_batch', objectId: id, before: { state: 'draft' }, after: { state: 'reviewed' } })
  return { statusCode: 200, body: envelope(await batchView(tx, id)) }
}

/** Users declared related to any of the payees (D-B4-11): they never approve a payment to their own or a relative's account. */
async function relatedTo(tx: Tx, payees: readonly string[]): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>('SELECT DISTINCT staff_related_users(p) AS id FROM unnest($1::uuid[]) AS p ORDER BY id', [payees])
  return rows.map((row) => row.id)
}

async function relatedToLines(tx: Tx, batchId: string): Promise<string[]> {
  const { rows } = await tx.query<{ participant_id: string }>('SELECT participant_id FROM payout_batch_line WHERE batch_id = $1', [batchId])
  return relatedTo(tx, rows.map((row) => row.participant_id))
}

async function recordBatchApproval(tx: Tx, auth: AuthContext, batch: BatchRow, excludedIds: readonly string[]): Promise<string> {
  const { approvalId } = await approveOrRefuse(tx, {
    objectType: 'payout_batch', objectId: batch.id, preparerId: batch.prepared_by,
    contributorIds: batch.submitted_by === null ? [] : [batch.submitted_by], excludedIds, decision: 'approved', reason: null,
    factorVerifiedAt: auth.stepUpAt, approverPermission: 'payout.approve', marketId: batch.market_id,
  })
  return approvalId
}

/** The preparer, the submitter or a user related to a payee is refused before anything else is touched. */
async function refuseSelfApproval(tx: Tx, auth: AuthContext, batch: BatchRow, excludedIds: readonly string[]): Promise<void> {
  if ([batch.prepared_by, batch.submitted_by, ...excludedIds].includes(auth.userId)) await recordBatchApproval(tx, auth, batch, excludedIds)
}

/**
 * The tenant's audit-chain lock (audit.audit_event_chain, migration 0003), taken before payables and bank details are
 * read: a bank-detail decision holds it from its first audit write until it commits, and supersedes the version only
 * after that write, so the versions read here stay current until the instructions pin them.
 */
const lockAuditChain = (tx: Tx) => tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('audit.audit_event:' || app_tenant_id(), 0))`)

const dispatchSoon = (tx: Tx, batchId: string) => enqueue(tx, batchDispatchJob({ adapter: sandboxAdapter }), { batchId }) // enqueue reads name and payload only

export async function approveBatch(tx: Tx, request: FastifyRequest, auth: AuthContext, id: string, scope: Scope): Promise<StoredResponse> {
  const batch = await findBatch(tx, id, scope, true)
  if (batch.state !== 'reviewed') throw batchState(batch.state)
  await assertProviderEligible(tx, batch.provider_config_id, batch.market_id)
  await lockAuditChain(tx)
  const related = await relatedToLines(tx, id) // a recalculation that changes the lines answers 409 before approving
  await refuseSelfApproval(tx, auth, batch, related)
  const result = await recalculate(tx, batch)
  if (result.changed.length > 0) return recalculated(tx, request, batch, result)
  const approvalId = await recordBatchApproval(tx, auth, batch, related)
  await tx.query(`UPDATE payout_batch SET state = 'approved', approval_id = $2, approved_at = now() WHERE id = $1`, [id, approvalId])
  for (const line of result.lines) {
    await createInstruction(tx, request.server.config.secretKey, {
      batchId: id, marketId: batch.market_id, periodId: batch.period_id, payeeId: line.participant_id,
      bankDetailVersionId: line.bank_detail_version_id, amountMinor: line.amount_minor, currency: batch.currency, retryOf: null,
    }, approvalId)
  }
  await tx.query(`UPDATE payout_batch SET state = 'instructing' WHERE id = $1`, [id])
  const total = result.lines.reduce((sum, line) => sum + BigInt(line.amount_minor), 0n).toString()
  await recordAudit(tx, {
    action: 'PAYOUT.BATCH_APPROVED', objectType: 'payout_batch', objectId: id,
    before: { state: 'reviewed' }, after: { state: 'instructing', approval_id: approvalId, instruction_count: result.lines.length, total_minor: total },
  })
  await enqueueOutbox(tx, { type: 'payout.batch.approved', payload: { batch_id: id, market_id: batch.market_id, total_minor: total }, key: id })
  await dispatchSoon(tx, id)
  return { statusCode: 200, body: envelope({ ...(await batchView(tx, id)), instruction_count: result.lines.length }) }
}

export async function cancelBatch(tx: Tx, id: string, scope: Scope, reason: string): Promise<BatchView> {
  const batch = await findBatch(tx, id, scope, true)
  if (!OPEN_STATES.includes(batch.state)) throw batchState(batch.state)
  await tx.query(
    `UPDATE payout_batch SET state = 'cancelled', cancelled_by = app_user_id(), cancelled_at = now(), cancel_reason = $2 WHERE id = $1`, [id, reason])
  await recordAudit(tx, { action: 'PAYOUT.BATCH_CANCELLED', objectType: 'payout_batch', objectId: id, before: { state: batch.state }, after: { state: 'cancelled' }, reason })
  return batchView(tx, id)
}

/**
 * D-B4-12 retry-failed: new instructions for the failed payees no retry replaced yet, each re-checked against every
 * exclusion, on the payee's current bank details, for min(failed amount, payable), approved by its own approval.
 */
export async function retryFailed(tx: Tx, request: FastifyRequest, auth: AuthContext, id: string, scope: Scope): Promise<StoredResponse> {
  const batch = await findBatch(tx, id, scope, true)
  if (batch.state !== 'failed') throw batchState(batch.state)
  await assertProviderEligible(tx, batch.provider_config_id, batch.market_id)
  await lockAuditChain(tx)
  const { rows: failed } = await tx.query<{ id: string; payee: string; amount_minor: string }>(
    `SELECT i.id, i.payee_participant_id AS payee, i.amount_minor::text AS amount_minor FROM payout_instruction i
     WHERE i.batch_id = $1 AND i.state = 'failed' AND ${NOT_RETRIED}
     ORDER BY i.payee_participant_id`,
    [id],
  )
  const related = await relatedTo(tx, failed.map((f) => f.payee))
  await refuseSelfApproval(tx, auth, batch, related)
  const rows = await candidates(tx, batch.market_id, await marketPolicy(tx, batch.market_id), failed.map((f) => f.payee))
  const byPayee = new Map(rows.map((row) => [row.participant_id, row]))
  const eligible = failed.filter((f) => byPayee.get(f.payee)?.reasons.length === 0)
  const skipped = failed.filter((f) => !eligible.includes(f))
    .map((f) => ({ participant: f.payee, reasons: byPayee.get(f.payee)?.reasons ?? [{ reason: 'nothing_payable', detail: {} }] }))
  const { rows: people } = await tx.query<{ id: string; view: unknown }>(`SELECT p.id, ${participant('p.id')} AS view FROM participant p WHERE p.id = ANY ($1)`,
    [skipped.map((s) => s.participant)])
  const views = new Map(people.map((p) => [p.id, p.view]))
  const skippedViews = skipped.map((s) => ({ participant: views.get(s.participant), reasons: s.reasons }))
  if (eligible.length === 0) throw new ApiError(409, 'NOTHING_TO_RETRY', 'No failed payee can be paid again now.', { skipped: skippedViews })
  const approvalId = await recordBatchApproval(tx, auth, batch, related)
  const reinstructed: string[] = []
  for (const f of eligible) {
    const candidate = byPayee.get(f.payee)!
    const amount = BigInt(f.amount_minor) < BigInt(candidate.payable_minor) ? f.amount_minor : candidate.payable_minor
    reinstructed.push(await createInstruction(tx, request.server.config.secretKey, {
      batchId: id, marketId: batch.market_id, periodId: batch.period_id, payeeId: f.payee, bankDetailVersionId: candidate.version_id!,
      amountMinor: amount, currency: batch.currency, retryOf: f.id,
    }, approvalId))
  }
  await tx.query(`UPDATE payout_batch SET state = 'instructing' WHERE id = $1`, [id])
  await recordAudit(tx, {
    action: 'PAYOUT.BATCH_RETRIED', objectType: 'payout_batch', objectId: id,
    before: { state: 'failed' }, after: { state: 'instructing', approval_id: approvalId, reinstructed, skipped_count: skipped.length },
  })
  await dispatchSoon(tx, id)
  return {
    statusCode: 200,
    body: envelope({ batch: await batchView(tx, id), reinstructed, skipped: skippedViews }),
  }
}
