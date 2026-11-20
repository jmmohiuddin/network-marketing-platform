import { withTenant, type Tx } from '@nmp/db'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, ownerRows, resetApiDb, runQueuedJobs, type TestUser,
} from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { backoffMs, batchDispatchJob, dispatchInstruction, sandboxAdapter, type PayoutAdapter } from './dispatch.js'
import { payCaseTypes, payModule } from './index.js'
import { signatureValid } from './signing.js'
import {
  approvedBatch, balance, bankVersion, credit, customRoleUser, participant, payWorld, post, provider, SECRET_KEY, setSettings, type PayWorld,
} from './test-support.js'

let app: FastifyInstance
let w: PayWorld
let other: PayWorld

closePoolsAfterAll()

const policy = (world: PayWorld, minimum = '1000', taxProfileRequired = false) => ({
  'payouts.market_policy': { [world.market]: { minimum_payout_minor: minimum, tax_profile_required: taxProfileRequired } },
  'payouts.bank_detail_cooling_off_hours': 72,
})

beforeAll(async () => {
  await resetApiDb()
  w = await payWorld()
  other = await payWorld()
  await setSettings(w, policy(w))
  await setSettings(other, policy(other))
  app = await buildTestApp({ modules: [payModule, createCasModule({ types: payCaseTypes })] })
}, 120_000)

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const dispatch = (adapter: PayoutAdapter = sandboxAdapter) => runQueuedJobs(batchDispatchJob({ adapter }) as never)
const instructions = (batchId: string) => ownerRows<{ id: string; state: string; amount_minor: string; attempts: number; provider_ref: string | null;
  last_error: string | null; bank_detail_version_id: string; retry_of: string | null; signature: Buffer; payee_participant_id: string; currency: string;
  tenant_id: string; idempotency_key: string; next_attempt_at: Date | null }>(
  'SELECT *, amount_minor::text AS amount_minor FROM payout_instruction WHERE batch_id = $1 ORDER BY created_at, id', [batchId])
const facts = (i: Awaited<ReturnType<typeof instructions>>[number]) => ({
  tenantId: i.tenant_id, instructionId: i.id, payeeId: i.payee_participant_id, bankDetailVersionId: i.bank_detail_version_id,
  amountMinor: i.amount_minor, currency: i.currency, idempotencyKey: i.idempotency_key,
})

const declareRelated = (world: PayWorld, u: TestUser, participantId: string) => ownerRows(
  `INSERT INTO user_related_participant (tenant_id, user_id, participant_id, relation, declared_by) VALUES ($1, $2, $3, 'relative', $4)`,
  [world.tenant.id, u.id, participantId, world.admin.id])

/** Closes the market's batch so the next test can prepare one (cancel while open). */
async function closeOpen(world: PayWorld) {
  const open = await ownerRows<{ id: string }>(`SELECT id FROM payout_batch WHERE market_id = $1 AND state IN ('draft', 'reviewed')`, [world.market])
  for (const batch of open) await post(app, world.officer, `/v1/payout-batches/${batch.id}/cancel`, { reason: 'test cleanup' })
}

describe('prepare, exclusions, approval (AC-47.1, AC-47.2, TS-17, TS-42)', () => {
  let a: string
  let b: string
  let c: string
  let sandbox: string
  let batchId: string

  beforeAll(async () => {
    sandbox = await provider(app, w, 'sandbox')
    a = await participant(w.tenant.id, w.market)
    b = await participant(w.tenant.id, w.market)
    c = await participant(w.tenant.id, w.market)
    await credit(w, a, '2300')
    await credit(w, b, '2400')
    await credit(w, c, '500')
    await bankVersion(w.tenant.id, a)
    await bankVersion(w.tenant.id, b, { coolingOffUntil: new Date(Date.now() + 72 * 3600_000) })
  })

  test('below the minimum and in cooling-off are excluded with every reason; their payables remain (AC-47.1)', async () => {
    const prepared = await post(app, w.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: sandbox })
    batchId = prepared.json().data.id

    expect(prepared.statusCode).toBe(201)
    expect(prepared.json().data).toMatchObject({ state: 'draft', total_minor: '2300', currency: 'GBP', line_count: 1, period: { id: w.period } })
    // BUG-120: the period's instants are UTC Z with milliseconds like every other instant.
    const [period] = await ownerRows<{ starts_at: Date; ends_at: Date }>('SELECT starts_at, ends_at FROM period WHERE id = $1', [w.period])
    expect(prepared.json().data.period).toMatchObject({ starts_at: period!.starts_at.toISOString(), ends_at: period!.ends_at.toISOString() })
    const exclusions = prepared.json().data.exclusions as { participant: { id: string }; reasons: { reason: string }[] }[]
    expect(Object.fromEntries(exclusions.map((e) => [e.participant.id, e.reasons.map((r) => r.reason)]))).toEqual({
      [b]: ['bank_detail_cooling_off'], [c]: ['below_minimum', 'no_bank_details'],
    })
    expect(await balance(w, b, 'payee_payable')).toBe('2400')
    const lines = await get(w.officer, `/v1/payout-batches/${batchId}/lines`)
    expect(lines.json().data).toEqual([{ participant: expect.objectContaining({ id: a }), amount_minor: '2300', bank_detail: { id: expect.any(String), masked: '•••• 5432' } }])
  })

  test('a second open batch is 409 BATCH_OPEN', async () => {
    const second = await post(app, w.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: sandbox })
    expect(second.statusCode).toBe(409)
    expect(second.json().error).toMatchObject({ code: 'BATCH_OPEN', details: { batch_id: batchId } })
  })

  test('approval: Payout officer 403, no step-up 403, preparer 422 SOD, Finance approver instructs (TS-42, AC-47.2)', async () => {
    const preparer = await customRoleUser(w.tenant.id, ['payout.read', 'payout.prepare', 'payout.approve'])
    expect((await post(app, w.officer, `/v1/payout-batches/${batchId}/submit`)).statusCode).toBe(200)
    const noStepUp = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Finance approver'] })

    expect((await post(app, w.officer, `/v1/payout-batches/${batchId}/approve`)).statusCode).toBe(403)
    expect((await post(app, noStepUp, `/v1/payout-batches/${batchId}/approve`)).json().error.code).toBe('STEP_UP_REQUIRED')
    // D-B4-11: an approver declared related to a payee of the batch does not release it.
    await declareRelated(w, w.finance2, a)
    const detail = await get(w.finance, `/v1/payout-batches/${batchId}`)
    const eligible = detail.json().data.eligible_approvers.map((u: { user_id: string }) => u.user_id)
    expect(eligible).toContain(w.finance.id)
    expect(eligible).not.toContain(w.finance2.id)
    expect((await post(app, w.finance2, `/v1/payout-batches/${batchId}/approve`)).json().error.code).toBe('SOD_SELF_APPROVAL')
    expect((await get(w.finance, `/v1/payout-batches/${batchId}`)).json().data.state).toBe('reviewed')
    const approved = await post(app, w.finance, `/v1/payout-batches/${batchId}/approve`)

    expect(approved.statusCode).toBe(200)
    expect(approved.json().data).toMatchObject({ state: 'instructing', instruction_count: 1, total_minor: '2300', approved_by: { id: w.finance.id } })
    const rows = await instructions(batchId)
    expect(rows.map((i) => i.amount_minor)).toEqual(['2300'])
    expect(signatureValid(SECRET_KEY, facts(rows[0]!), rows[0]!.signature)).toBe(true)
    expect(rows[0]!.idempotency_key).toBe(rows[0]!.id)
    expect(await balance(w, a, 'payee_payable')).toBe('0')
    expect(await balance(w, null, 'payout_in_transit')).toBe('2300')
    expect(await ownerRows(`SELECT topic FROM outbox_event WHERE tenant_id = $1 AND topic = 'payout.batch.approved'`, [w.tenant.id])).toHaveLength(1)

    // TS-42 preparer side: a batch the custom-role user prepared and submitted
    await bankVersion(w.tenant.id, b)
    const own = await post(app, preparer, '/v1/payout-batches', { market_id: w.market, provider_config_id: sandbox })
    await post(app, preparer, `/v1/payout-batches/${own.json().data.id}/submit`)
    const refused = await post(app, preparer, `/v1/payout-batches/${own.json().data.id}/approve`)
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error.code).toBe('SOD_SELF_APPROVAL')
    expect(await auditActions(w.tenant.id)).toEqual(expect.arrayContaining(['PAYOUT.BATCH_PREPARED', 'PAYOUT.BATCH_SUBMITTED', 'PAYOUT.BATCH_APPROVED', 'APPROVAL.REFUSED']))
    await closeOpen(w)
  })

  test('the dispatcher submits to the sandbox once: accepted with an sbx_ reference', async () => {
    await dispatch()
    const [row] = await instructions(batchId)
    expect(row).toMatchObject({ state: 'accepted', attempts: 1, provider_ref: expect.stringMatching(/^sbx_/) })
    expect(await ownerRows('SELECT 1 FROM sandbox_provider_payment WHERE idempotency_key = $1', [row!.id])).toHaveLength(1)
  })

  test('cancel works on an open batch only (409 BATCH_STATE otherwise)', async () => {
    expect((await post(app, w.officer, `/v1/payout-batches/${batchId}/cancel`, { reason: 'too late' })).json().error.code).toBe('BATCH_STATE')
  })
})

describe('recalculation (AC-PAY1-1, T-B4-12) and empty batches', () => {
  let sandbox: string
  let payee: string

  beforeAll(async () => {
    sandbox = await provider(app, other, 'sandbox')
    payee = await participant(other.tenant.id, other.market)
    await bankVersion(other.tenant.id, payee)
  })

  test('an empty batch cannot be submitted (422 BATCH_EMPTY)', async () => {
    const prepared = await post(app, other.officer, '/v1/payout-batches', { market_id: other.market, provider_config_id: sandbox })
    const submitted = await post(app, other.officer, `/v1/payout-batches/${prepared.json().data.id}/submit`)
    expect(submitted.json().error.code).toBe('BATCH_EMPTY')
    await closeOpen(other)
  })

  test('a payable raised between submit and approve: 409 BATCH_RECALCULATED (stored), draft, line updated', async () => {
    await credit(other, payee, '5000')
    const prepared = await post(app, other.officer, '/v1/payout-batches', { market_id: other.market, provider_config_id: sandbox })
    const id = prepared.json().data.id
    await post(app, other.officer, `/v1/payout-batches/${id}/submit`)
    await credit(other, payee, '700')

    const key = `recalc-${id}`
    const first = await call(app, { method: 'POST', url: `/v1/payout-batches/${id}/approve`, as: other.finance, idempotencyKey: key })
    const replay = await call(app, { method: 'POST', url: `/v1/payout-batches/${id}/approve`, as: other.finance, idempotencyKey: key })

    expect(first.statusCode).toBe(409)
    expect(first.json().error).toMatchObject({ code: 'BATCH_RECALCULATED', details: { changed: [{ participant_id: payee, before_minor: '5000', after_minor: '5700' }] } })
    expect(replay.statusCode).toBe(409)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    const detail = await get(other.officer, `/v1/payout-batches/${id}`)
    expect(detail.json().data).toMatchObject({ state: 'draft', total_minor: '5700' })
    expect(await ownerRows('SELECT 1 FROM payout_instruction WHERE batch_id = $1', [id])).toHaveLength(0)
    await closeOpen(other)
  })
})

describe('dispatcher (TS-16, T-B4-16, T-B4-17, AC-PAY3-1) and retry-failed (T-B4-13)', () => {
  let sandbox: string

  beforeAll(async () => {
    sandbox = await provider(app, other, 'sandbox')
  })

  async function oneBatch(amount: string) {
    const payee = await participant(other.tenant.id, other.market)
    await credit(other, payee, amount)
    const version = await bankVersion(other.tenant.id, payee)
    const id = await approvedBatch(app, other, sandbox)
    return { payee, version, id }
  }

  test('backoff doubles from 30 s up to 1 h, within 10 % jitter', () => {
    expect(backoffMs(1, 0.5)).toBe(30_000)
    expect(backoffMs(3, 0.5)).toBe(120_000)
    expect(backoffMs(20, 0.5)).toBe(3_600_000)
    expect(backoffMs(1, 0)).toBe(27_000)
    expect(backoffMs(1, 1)).toBe(33_000)
  })

  test('TS-16: a submit timing out after the provider recorded it is instructed; the next dispatch queries and accepts it', async () => {
    const { id } = await oneBatch('3000')
    const timeout: PayoutAdapter = {
      ...sandboxAdapter,
      async submit(tx, request) {
        await sandboxAdapter.submit(tx, request)
        throw new Error('sandbox timeout')
      },
    }
    await dispatch(timeout)
    const [instructed] = await instructions(id)
    expect(instructed).toMatchObject({ state: 'instructed', attempts: 1, last_error: 'PROVIDER_OUTCOME_UNKNOWN' })
    expect(instructed!.next_attempt_at!.getTime()).toBeGreaterThan(Date.now() + 20_000)

    await ownerRows('UPDATE payout_instruction SET next_attempt_at = now() WHERE id = $1', [instructed!.id])
    let submits = 0
    const counting: PayoutAdapter = { ...sandboxAdapter, async submit(tx, request) { submits += 1; return sandboxAdapter.submit(tx, request) } }
    await withTenant({ tenantId: other.tenant.id, userId: '00000000-0000-0000-0000-000000000000' }, (tx) =>
      dispatchInstruction(tx, instructed!.id, counting, SECRET_KEY))

    const [accepted] = await instructions(id)
    expect(accepted).toMatchObject({ state: 'accepted', idempotency_key: instructed!.id })
    expect(submits).toBe(0)
    expect(await ownerRows('SELECT 1 FROM sandbox_provider_payment WHERE idempotency_key = $1', [instructed!.id])).toHaveLength(1)
  })

  test('AC-PAY3-1: a tampered amount is not sent (SIGNATURE_INVALID, audited, stays pending)', async () => {
    const { id } = await oneBatch('1500')
    await ownerRows('UPDATE payout_instruction SET amount_minor = 150000 WHERE batch_id = $1', [id])
    await dispatch()
    const [row] = await instructions(id)
    expect(row).toMatchObject({ state: 'pending', last_error: 'SIGNATURE_INVALID', next_attempt_at: null })
    expect(await ownerRows('SELECT 1 FROM sandbox_provider_payment WHERE idempotency_key = $1', [row!.id])).toHaveLength(0)
    expect(await auditActions(other.tenant.id)).toContain('PAYOUT.SIGNATURE_INVALID')
  })

  test('a permanent rejection fails the instruction and restores the payable; retry-failed re-checks every exclusion', async () => {
    const { payee, version, id } = await oneBatch('4000')
    const rejecting: PayoutAdapter = { ...sandboxAdapter, async submit() { return { accepted: false, reason: 'ACCOUNT_CLOSED' } } }
    await dispatch(rejecting)
    expect((await instructions(id))[0]).toMatchObject({ state: 'failed', last_error: 'ACCOUNT_CLOSED' })
    expect(await balance(other, payee, 'payee_payable')).toBe('4000')
    expect((await get(other.officer, `/v1/payout-batches/${id}`)).json().data.state).toBe('failed')

    expect((await post(app, other.officer, `/v1/payout-batches/${id}/retry-failed`)).statusCode).toBe(403)
    const hold = await post(app, other.compliance, `/v1/payees/${payee}/holds`, { market_id: other.market, reason: 'KYC review' })
    const newer = await bankVersion(other.tenant.id, payee, { coolingOffUntil: new Date(Date.now() + 3600_000) })
    const blocked = await post(app, other.finance, `/v1/payout-batches/${id}/retry-failed`)
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error.code).toBe('NOTHING_TO_RETRY')
    expect(blocked.json().error.details.skipped[0].reasons.map((r: { reason: string }) => r.reason)).toEqual(['bank_detail_cooling_off', 'hold'])
    expect(blocked.json().error.details.skipped[0].participant).toMatchObject({ id: payee, external_ref: expect.any(String) })
    const failedCount = async () => (await get(other.officer, `/v1/payout-reconciliation/summary?provider_config_id=${sandbox}`)).json().data.providers[0].failed.count as number
    const failedBefore = await failedCount()

    await post(app, other.compliance, `/v1/payout-holds/${hold.json().data.id}/release`, { reason: 'KYC cleared' })
    const current = await bankVersion(other.tenant.id, payee)
    await credit(other, payee, '1') // payable 4001: the retry pays min(failed 4000, payable)
    await declareRelated(other, other.finance, payee)
    expect((await post(app, other.finance, `/v1/payout-batches/${id}/retry-failed`)).json().error.code).toBe('SOD_SELF_APPROVAL')
    const retried = await post(app, other.finance2, `/v1/payout-batches/${id}/retry-failed`)

    expect(retried.statusCode).toBe(200)
    expect(retried.json().data).toMatchObject({ batch: { state: 'instructing' }, skipped: [] })
    // The replaced failure no longer counts: neither on the batch nor in the reconciliation summary.
    expect(retried.json().data.batch.instruction_counts).toEqual({ pending: 1 })
    expect(await failedCount()).toBe(failedBefore - 1)
    const rows = await instructions(id)
    const retry = rows.find((row) => row.retry_of !== null)!
    expect(retry).toMatchObject({ state: 'pending', amount_minor: '4000', bank_detail_version_id: current, retry_of: rows[0]!.id })
    expect([version, newer]).not.toContain(retry.bank_detail_version_id)
    expect(retry.id).not.toBe(rows[0]!.id)
    expect(signatureValid(SECRET_KEY, facts(retry), retry.signature)).toBe(true)
    expect(await balance(other, payee, 'payee_payable')).toBe('1')
    expect(await auditActions(other.tenant.id)).toContain('PAYOUT.BATCH_RETRIED')
  })
})

describe('a bank account superseded after approval is never paid (D-B4-12)', () => {
  test('sandbox: the pending instruction fails BANK_DETAIL_SUPERSEDED unsent, the payable is restored, retry pins the current version', async () => {
    const sandbox = await provider(app, other, 'sandbox')
    const payee = await participant(other.tenant.id, other.market)
    await credit(other, payee, '2500')
    await bankVersion(other.tenant.id, payee)
    const id = await approvedBatch(app, other, sandbox)
    const current = await bankVersion(other.tenant.id, payee)

    await dispatch()

    const [row] = await instructions(id)
    expect(row).toMatchObject({ state: 'failed', last_error: 'BANK_DETAIL_SUPERSEDED' })
    expect(await ownerRows('SELECT 1 FROM sandbox_provider_payment WHERE idempotency_key = $1', [row!.id])).toHaveLength(0)
    expect(await balance(other, payee, 'payee_payable')).toBe('2500')
    const retried = await post(app, other.finance, `/v1/payout-batches/${id}/retry-failed`)
    expect(retried.statusCode).toBe(200)
    expect((await instructions(id)).find((i) => i.retry_of === row!.id)).toMatchObject({ bank_detail_version_id: current })
  })

  test('bank file: a pending row whose account was superseded fails and is left out of the file', async () => {
    const bankFile = await provider(app, other, 'bank_file_csv')
    const payee = await participant(other.tenant.id, other.market)
    await credit(other, payee, '2600')
    await bankVersion(other.tenant.id, payee)
    const id = await approvedBatch(app, other, bankFile)
    await bankVersion(other.tenant.id, payee)

    const file = await post(app, other.officer, `/v1/payout-batches/${id}/bank-file`)

    expect(file.statusCode).toBe(200)
    expect(file.body.trim().split('\r\n')).toHaveLength(1)
    expect((await instructions(id))[0]).toMatchObject({ state: 'failed', last_error: 'BANK_DETAIL_SUPERSEDED' })
    expect(await balance(other, payee, 'payee_payable')).toBe('2600')
  })
})

describe('settings, providers and scope', () => {
  test('an unset market policy refuses prepare with 422 SETTING_NOT_CONFIGURED', async () => {
    const bare = await payWorld('IE')
    const sandbox = await provider(app, bare, 'sandbox')
    const refused = await post(app, bare.officer, '/v1/payout-batches', { market_id: bare.market, provider_config_id: sandbox })
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'SETTING_NOT_CONFIGURED', details: { key: 'payouts.market_policy' } })
  })

  test('a withdrawn provider is not eligible; withdrawing one with money in flight is 409 BATCH_OPEN', async () => {
    const sandbox = await provider(app, w, 'sandbox')
    const payee = await participant(w.tenant.id, w.market)
    await credit(w, payee, '9000')
    await bankVersion(w.tenant.id, payee)
    await approvedBatch(app, w, sandbox)
    const withdraw = await post(app, w.admin, `/v1/provider-configs/${sandbox}/withdraw`, { reason: 'contract ended' })
    expect(withdraw.json().error).toMatchObject({ code: 'BATCH_OPEN', details: { batch_id: expect.any(String) } })

    const unused = await provider(app, w, 'sandbox')
    await post(app, w.admin, `/v1/provider-configs/${unused}/withdraw`, { reason: 'not needed' })
    const refused = await post(app, w.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: unused })
    expect(refused.json().error.code).toBe('PROVIDER_NOT_ELIGIBLE')

    // PLAN 2.3: a draft of a provider withdrawn after preparation can only be cancelled.
    const later = await provider(app, w, 'sandbox')
    const draft = (await post(app, w.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: later })).json().data.id as string
    await post(app, w.admin, `/v1/provider-configs/${later}/withdraw`, { reason: 'contract ended' })
    expect((await post(app, w.officer, `/v1/payout-batches/${draft}/submit`)).json().error.code).toBe('PROVIDER_NOT_ELIGIBLE')
    expect((await post(app, w.officer, `/v1/payout-batches/${draft}/cancel`, { reason: 'provider withdrawn' })).statusCode).toBe(200)
  })

  /** Sends the approval, commits `holder` once the approval waits on one of its locks (or has finished), returns the answer. */
  async function approveAround(holder: Tx, batchId: string) {
    let done = false
    const approving = post(app, w.finance, `/v1/payout-batches/${batchId}/approve`).finally(() => { done = true })
    while (!done && (await holder.query('SELECT 1 FROM pg_stat_activity WHERE pg_backend_pid() = ANY (pg_blocking_pids(pid))')).rowCount === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await holder.query('COMMIT')
    return approving
  }

  async function reviewedBatch(amount: string) {
    const sandbox = await provider(app, w, 'sandbox')
    const payee = await participant(w.tenant.id, w.market)
    await credit(w, payee, amount)
    await bankVersion(w.tenant.id, payee)
    const id = (await post(app, w.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: sandbox })).json().data.id as string
    await post(app, w.officer, `/v1/payout-batches/${id}/submit`)
    return { sandbox, payee, id }
  }

  test('a provider withdrawal committing while an approval runs: 422 PROVIDER_NOT_ELIGIBLE, no instruction (AC-PAY1-2)', async () => {
    const { sandbox, id } = await reviewedBatch('3100')
    const holder = await getOwnerPool().connect()
    try {
      // withdrawProvider's locks and write: the market row, then the provider withdrawn, not yet committed
      await holder.query('BEGIN')
      await holder.query('SELECT 1 FROM market WHERE id = $1 FOR UPDATE', [w.market])
      await holder.query(`UPDATE provider_config SET state = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2 WHERE id = $1`, [sandbox, w.admin.id])
      const approved = await approveAround(holder, id)

      expect([approved.statusCode, approved.json().error?.code]).toEqual([422, 'PROVIDER_NOT_ELIGIBLE'])
      expect(await instructions(id)).toEqual([])
    } finally {
      holder.release()
    }
    await closeOpen(w)
  })

  test('bank details superseded while an approval runs: 409 BATCH_RECALCULATED, never a 500 (D-B4-12)', async () => {
    const { payee, id } = await reviewedBatch('3200')
    const holder = await getOwnerPool().connect()
    try {
      // a bank-detail decision between its first audit write and its commit: audit-chain lock held, version superseded
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('audit.audit_event:' || $1::text, 0))`, [w.tenant.id])
      await holder.query('UPDATE bank_detail_version SET superseded_at = now() WHERE participant_id = $1 AND superseded_at IS NULL', [payee])
      const approved = await approveAround(holder, id)

      expect(approved.statusCode, approved.body).toBe(409)
      expect(approved.json().error).toMatchObject({ code: 'BATCH_RECALCULATED', details: { changed: [{ participant_id: payee, before_minor: '3200', after_minor: null }] } })
      expect(await instructions(id)).toEqual([])
    } finally {
      holder.release()
    }
    await closeOpen(w)
  })

  test('another tenant sees and touches nothing (404 / 422); a role without payout permissions is 403', async () => {
    const [batch] = await ownerRows<{ id: string }>('SELECT id FROM payout_batch WHERE tenant_id = $1 LIMIT 1', [w.tenant.id])
    const id = batch!.id
    for (const url of [`/v1/payout-batches/${id}`, `/v1/payout-batches/${id}/lines`, `/v1/payout-batches/${id}/instructions`]) {
      expect((await get(other.finance, url)).statusCode).toBe(404)
    }
    for (const action of ['submit', 'approve', 'retry-failed', 'bank-file']) {
      const as = action === 'submit' || action === 'bank-file' ? other.officer : other.finance
      expect((await post(app, as, `/v1/payout-batches/${id}/${action}`)).statusCode).toBe(404)
    }
    expect((await post(app, other.officer, `/v1/payout-batches/${id}/cancel`, { reason: 'x' })).statusCode).toBe(404)
    expect((await get(other.finance, '/v1/payout-batches')).json().data.map((b: { id: string }) => b.id)).not.toContain(id)
    expect((await post(app, other.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: id })).json().error.code).toBe('VALIDATION_FAILED')

    const analyst = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Commission analyst'], stepUp: true })
    expect((await get(analyst, '/v1/payout-batches')).statusCode).toBe(403)
    expect((await get(analyst, `/v1/payout-batches/${id}`)).statusCode).toBe(403)
    expect((await post(app, analyst, '/v1/payout-batches', { market_id: w.market, provider_config_id: id })).statusCode).toBe(403)
    for (const action of ['submit', 'approve', 'retry-failed', 'bank-file']) {
      expect((await post(app, analyst, `/v1/payout-batches/${id}/${action}`)).statusCode).toBe(403)
    }
  })
})
