import { createHmac } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, mailsTo, ownerRows, resetApiDb, runQueuedJobs, type TestUser,
} from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { intModule } from '../int/index.js'
import { batchDispatchJob, sandboxAdapter } from './dispatch.js'
import { payCaseTypes, payModule } from './index.js'
import { noticeJob } from './notices.js'
import {
  approvedBatch, balance, bankVersion, committedPeriod, credit, IBAN, participant, payWorld, post, provider, setSettings, webhook, WEBHOOK_SECRET, type PayWorld,
} from './test-support.js'

let app: FastifyInstance
let w: PayWorld
let other: PayWorld
let payee: string
let sandbox: string
let bankFile: string
let firstBatch: string
let instructionId: string
let sandboxRef: string
const EMAIL = `payee-${Date.now()}@example.test`

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  w = await payWorld()
  other = await payWorld()
  await setSettings(w, {
    'payouts.market_policy': { [w.market]: { minimum_payout_minor: '1000', tax_profile_required: false } },
    'payouts.bank_detail_cooling_off_hours': 72,
  })
  app = await buildTestApp({ modules: [payModule, intModule, createCasModule({ types: payCaseTypes })] })
  payee = await participant(w.tenant.id, w.market, EMAIL)
  await credit(w, payee, '9800')
  await bankVersion(w.tenant.id, payee, { iban: IBAN.toLowerCase().replace(/(.{4})/g, '$1 ') }) // as staff may type it: the bank file normalises
  sandbox = await provider(app, w, 'sandbox')
  bankFile = await provider(app, w, 'bank_file_csv')
  firstBatch = await approvedBatch(app, w, sandbox)
  await runQueuedJobs(batchDispatchJob({ adapter: sandboxAdapter }) as never)
  const [row] = await ownerRows<{ id: string; provider_ref: string }>('SELECT id, provider_ref FROM payout_instruction WHERE batch_id = $1', [firstBatch])
  instructionId = row!.id
  sandboxRef = row!.provider_ref
}, 120_000)

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const event = (type: string, amount = '9800', extra: Record<string, unknown> = {}) =>
  ({ type, provider_ref: sandboxRef, amount_minor: amount, currency: 'GBP', ...extra })
const entries = (origin: string) => ownerRows<{ event_type: string }>('SELECT event_type FROM journal_entry WHERE origin_id = $1 ORDER BY posted_at, id', [origin])
const instruction = async (id: string) => (await ownerRows<{ state: string }>('SELECT state FROM payout_instruction WHERE id = $1', [id]))[0]!

describe('signed sandbox webhook (AC-16.2, AC-16.3, TS-40)', () => {
  test('a bad signature is 401 and stores nothing; an unknown provider is 404', async () => {
    const before = await ownerRows('SELECT 1 FROM inbound_event WHERE tenant_id = $1', [w.tenant.id])
    const bad = await webhook(app, sandbox, event('payout.returned'), { secret: 'not-the-provider-secret-at-all' })
    expect(bad.statusCode).toBe(401)
    expect(bad.json().error.code).toBe('SIGNATURE_INVALID')
    expect(await ownerRows('SELECT 1 FROM inbound_event WHERE tenant_id = $1', [w.tenant.id])).toHaveLength(before.length)
    expect((await webhook(app, bankFile, event('payout.returned'))).statusCode).toBe(404)
  })

  test('a JSON number amount is 422 PAYLOAD_INVALID, stored as a rejected inbound event', async () => {
    const invalid = await webhook(app, sandbox, { ...event('payout.settled'), amount_minor: 9800 }, { eventId: 'evt-invalid' })
    expect(invalid.statusCode).toBe(422)
    expect(invalid.json().error.code).toBe('PAYLOAD_INVALID')
    expect(await ownerRows(`SELECT 1 FROM inbound_event WHERE idempotency_key = 'evt-invalid' AND state = 'rejected'`)).toHaveLength(1)
    expect((await instruction(instructionId)).state).toBe('accepted')
  })

  test('the signature covers the event id and a timestamp: a captured body under a new id, or a stale one, is 401', async () => {
    const stale = await webhook(app, sandbox, event('payout.failed'), { at: Math.floor(Date.now() / 1000) - 301 })
    expect([stale.statusCode, stale.json().error.code]).toEqual([401, 'SIGNATURE_INVALID'])
    const raw = JSON.stringify(event('payout.failed'))
    const at = String(Math.floor(Date.now() / 1000))
    const replayed = await app.inject({
      method: 'POST', url: `/v1/webhooks/providers/${sandbox}`, payload: raw,
      headers: {
        'content-type': 'application/json', 'x-sandbox-event-id': 'evt-replayed', 'x-sandbox-timestamp': at,
        'x-sandbox-signature': createHmac('sha256', WEBHOOK_SECRET).update(`evt-captured.${at}.${raw}`).digest('base64'),
      },
    })
    expect([replayed.statusCode, replayed.json().error.code]).toEqual([401, 'SIGNATURE_INVALID'])
    expect((await instruction(instructionId)).state).toBe('accepted')
  })

  test('returned: payable back, case opened, notice sent, batch partially settled, period paid; a repeat changes nothing', async () => {
    const first = await webhook(app, sandbox, event('payout.returned', '9800', { reason: 'ACCOUNT_CLOSED' }), { eventId: 'evt-return-1' })
    const repeat = await webhook(app, sandbox, event('payout.returned', '9800', { reason: 'ACCOUNT_CLOSED' }), { eventId: 'evt-return-1' })

    expect(first.statusCode).toBe(200)
    expect(repeat.statusCode).toBe(200)
    expect((await instruction(instructionId)).state).toBe('returned')
    expect((await entries(instructionId)).map((e) => e.event_type)).toEqual(['payout_instructed', 'payout_returned'])
    expect(await balance(w, payee, 'payee_payable')).toBe('9800')
    expect(await balance(w, null, 'payout_in_transit')).toBe('0')
    const cases = await ownerRows<{ id: string; state: string; opened_by_kind: string }>(
      `SELECT id, state, opened_by_kind FROM case_file WHERE type = 'returned_payment' AND subject_id = $1`, [instructionId])
    expect(cases).toMatchObject([{ state: 'open', opened_by_kind: 'system' }])
    expect((await get(w.officer, `/v1/payout-batches/${firstBatch}`)).json().data).toMatchObject({ state: 'partially_settled', instruction_counts: { returned: 1 } })
    expect(await ownerRows(`SELECT 1 FROM period WHERE id = $1 AND state = 'paid'`, [w.period])).toHaveLength(1)
    const outbox = await ownerRows<{ payload: { case_id: string } }>(`SELECT payload FROM outbox_event WHERE topic = 'payout.returned' AND tenant_id = $1`, [w.tenant.id])
    expect(outbox).toEqual([{ payload: expect.objectContaining({ instruction_id: instructionId, case_id: cases[0]!.id, amount_minor: '9800' }) }])

    await runQueuedJobs(noticeJob as never)
    const mails = await mailsTo(EMAIL)
    expect(mails).toHaveLength(1)
    expect(mails[0]).toContain('98.00 GBP')
    expect(mails[0]).not.toContain(IBAN)
    expect(await auditActions(w.tenant.id)).toEqual(expect.arrayContaining(['PAYOUT.INSTRUCTION_STATE', 'PERIOD.PAID', 'NOTICE.SENT']))
  })

  test('valid events for a terminal instruction or another amount open exceptions without changing it', async () => {
    await webhook(app, sandbox, event('payout.settled'))
    await webhook(app, sandbox, event('payout.settled', '9700'))
    // the same signed bodies replayed under new event ids open nothing more
    await webhook(app, sandbox, event('payout.settled'))
    await webhook(app, sandbox, event('payout.settled', '9700'))
    const exceptions = await get(w.officer, '/v1/payout-exceptions?state=open')
    expect(exceptions.json().data.map((e: { kind: string }) => e.kind).sort()).toEqual(['amount_mismatch', 'duplicate_settlement'])
    expect((await instruction(instructionId)).state).toBe('returned')
  })

  test('while the returned-payment case is open the payee is excluded; the case closes by submit and decision', async () => {
    const prepared = await post(app, w.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: bankFile })
    expect(prepared.json().data.exclusions[0].reasons.map((r: { reason: string }) => r.reason)).toEqual(['returned_payment_open'])
    await post(app, w.officer, `/v1/payout-batches/${prepared.json().data.id}/cancel`, { reason: 'case open' })

    // only in the returned instruction's market (D-B4-23): a batch of another market pays the payee there
    const ie = await createMarket(w.tenant.id, 'IE')
    const ieWorld = { ...w, market: ie, period: await committedPeriod(w.tenant.id, ie) }
    await setSettings(w, { 'payouts.market_policy': {
      [w.market]: { minimum_payout_minor: '1000', tax_profile_required: false }, [ie]: { minimum_payout_minor: '1000', tax_profile_required: false },
    } })
    await credit(ieWorld, payee, '4000')
    const ieBatch = await post(app, w.officer, '/v1/payout-batches', { market_id: ie, provider_config_id: await provider(app, ieWorld, 'sandbox') })
    expect(ieBatch.json().data).toMatchObject({ line_count: 1, total_minor: '4000', exclusions: [] })
    await post(app, w.officer, `/v1/payout-batches/${ieBatch.json().data.id}/cancel`, { reason: 'scope checked' })

    const [opened] = await ownerRows<{ id: string }>(`SELECT id FROM case_file WHERE type = 'returned_payment' AND subject_id = $1`, [instructionId])
    const caseId = opened!.id
    const noNote = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.officer, body: {} })
    expect([noNote.statusCode, noNote.json().error.code]).toEqual([422, 'VALIDATION_FAILED'])
    const patched = await call(app, { method: 'PATCH', url: `/v1/cases/${caseId}`, as: w.officer, body: { payload: { instruction_id: instructionId, note: 'Payee confirmed a new account' } } })
    expect(patched.statusCode).toBe(200)
    expect((await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.officer, body: {} })).statusCode).toBe(200)
    const decided = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as: w.finance, body: { decision: 'approve', reason: 'resolved' }, idempotencyKey: true })
    expect(decided.statusCode).toBe(200)
    expect(decided.json().data.effect_preview).toMatchObject({ amount_minor: '9800', reason: 'ACCOUNT_CLOSED', instruction: { id: instructionId, bank_detail_masked: '•••• 5432' } })
  })
})

describe('bank file and result file (AC-PAY2-2, AC-PAY4-1, TS-40 end)', () => {
  let batchId: string
  let reinstructed: string
  let reconciler: TestUser

  beforeAll(async () => {
    reconciler = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Payout officer'] })
  })

  test('bank file: step-up required; one row with decrypted details; second generation the same; nothing stored', async () => {
    batchId = await approvedBatch(app, w, bankFile)
    const noStepUp = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Payout officer'] })
    expect((await post(app, noStepUp, `/v1/payout-batches/${batchId}/bank-file`)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await post(app, w.officer, `/v1/payout-batches/${firstBatch}/bank-file`)).json().error.code).toBe('ADAPTER_MISMATCH')
    const exportsBefore = await ownerRows('SELECT 1 FROM export_job WHERE tenant_id = $1', [w.tenant.id])

    const file = await post(app, w.officer, `/v1/payout-batches/${batchId}/bank-file`)
    const again = await post(app, w.officer, `/v1/payout-batches/${batchId}/bank-file`)

    expect(file.statusCode).toBe(200)
    expect(file.headers['cache-control']).toBe('no-store')
    expect(file.headers['content-disposition']).toBe(`attachment; filename="payouts-${batchId}.csv"`)
    const [row] = await ownerRows<{ id: string; state: string; provider_ref: string }>('SELECT id, state, provider_ref FROM payout_instruction WHERE batch_id = $1', [batchId])
    reinstructed = row!.id
    expect(row).toMatchObject({ state: 'instructed', provider_ref: row!.id })
    const lines = file.body.trim().split('\r\n')
    expect(lines[0]).toBe('end_to_end_id,payee_ref,account_holder,scheme,iban,bic,account_number,bank_code,amount,currency')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain(`${reinstructed},`)
    expect(lines[1]).toContain(`,${IBAN},`)
    expect(lines[1]!.endsWith(',98.00,GBP')).toBe(true)
    expect(again.body).toBe(file.body)
    expect(await ownerRows('SELECT 1 FROM export_job WHERE tenant_id = $1', [w.tenant.id])).toHaveLength(exportsBefore.length)
    const audits = await ownerRows<{ after_ref: string }>(`SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1`, [w.tenant.id])
    expect(audits.some((a) => (a.after_ref ?? '').includes(IBAN))).toBe(false)
  })

  test('result file: only a bank-file provider takes one, and not from whoever prepared, submitted or generated the batch', async () => {
    const send = (providerId: string, as: TestUser, body: string) => call(app, {
      method: 'POST', url: `/v1/payout-providers/${providerId}/settlement-reports`, as, idempotencyKey: true, headers: { 'content-type': 'text/csv' }, body,
    })
    // A sandbox payment's outcome is its signed webhook: a file saying an accepted one failed would let retry-failed pay twice.
    const exceptionsBefore = await ownerRows('SELECT 1 FROM payout_exception WHERE provider_config_id = $1', [sandbox])
    const forged = await send(sandbox, reconciler, `end_to_end_id,status,amount_minor,reason\r\n${sandboxRef},failed,9800,BOGUS\r\n`)
    expect([forged.statusCode, forged.json().error.code]).toEqual([422, 'ADAPTER_MISMATCH'])
    expect(await ownerRows('SELECT 1 FROM payout_exception WHERE provider_config_id = $1', [sandbox])).toHaveLength(exceptionsBefore.length)

    const own = await send(bankFile, w.officer, `end_to_end_id,status,amount_minor,reason\r\n${reinstructed},failed,9800,BOGUS\r\n`)
    expect(own.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01', batch_ids: [batchId] } })
    expect((await instruction(reinstructed)).state).toBe('instructed')
  })

  test('result file: settles, records the unknown row as an exception; the same file again changes nothing', async () => {
    const csv = `end_to_end_id,status,amount_minor,reason\r\n${reinstructed},settled,9800,\r\nunknown-ref,settled,100,\r\n`
    const send = (body: string) => call(app, {
      method: 'POST', url: `/v1/payout-providers/${bankFile}/settlement-reports`, as: reconciler, idempotencyKey: true,
      headers: { 'content-type': 'text/csv' }, body,
    })
    const bad = await send('end_to_end_id,status,amount_minor,reason\r\nx,settled,98.00,\r\n')
    expect(bad.json().error).toMatchObject({ code: 'REPORT_INVALID', details: { line: 2 } })

    const first = await send(csv)
    const second = await send(csv)
    expect(first.json().data).toEqual({ rows: 2, settled: 1, returned: 0, failed: 0, exceptions: 1, unchanged: 0 })
    expect(second.json().data).toEqual({ rows: 2, settled: 0, returned: 0, failed: 0, exceptions: 0, unchanged: 2 })
    expect((await instruction(reinstructed)).state).toBe('settled')
    expect(await balance(w, payee, 'payee_payable')).toBe('0')
    expect(await balance(w, null, 'payout_in_transit')).toBe('0')
    expect(await balance(w, null, 'settled_clearing')).toBe('9800')
    expect((await get(w.officer, `/v1/payout-batches/${batchId}`)).json().data.state).toBe('settled')
    expect(await ownerRows(`SELECT 1 FROM outbox_event WHERE topic = 'payout.settled' AND tenant_id = $1`, [w.tenant.id])).toHaveLength(1)
  })

  test('exceptions are resolved once with a note (audited)', async () => {
    const [open] = await ownerRows<{ id: string }>(`SELECT id FROM payout_exception WHERE reference = 'unknown-ref'`)
    const url = `/v1/payout-exceptions/${open!.id}/resolve`
    expect((await post(app, w.officer, url, {})).statusCode).toBe(400)
    expect((await post(app, other.officer, url, { note: 'not mine' })).statusCode).toBe(404)
    expect((await post(app, w.officer, url, { note: 'Bank test row' })).statusCode).toBe(200)
    expect((await post(app, w.officer, url, { note: 'again' })).json().error.code).toBe('EXCEPTION_RESOLVED')
    expect(await auditActions(w.tenant.id)).toContain('PAYOUT.EXCEPTION_RESOLVED')
  })

  test('reconciliation summary and items; another tenant sees none of it', async () => {
    const summary = await get(w.officer, `/v1/payout-reconciliation/summary?provider_config_id=${bankFile}`)
    expect(summary.json().data.providers).toEqual([expect.objectContaining({
      id: bankFile, in_transit: { count: 0, amount_minor: '0' }, settled: { count: 1, amount_minor: '9800' }, open_exceptions: 0,
    })])
    const items = await get(w.officer, `/v1/payout-reconciliation/items?state=returned`)
    expect(items.json().data).toEqual([expect.objectContaining({ id: instructionId, returned_case_id: expect.any(String) })])
    expect(items.json().data[0].events.map((e: { type: string }) => e.type)).toEqual(['created', 'instructed', 'accepted', 'returned'])

    expect((await get(other.officer, '/v1/payout-reconciliation/items')).json().data).toEqual([])
    expect((await get(other.officer, '/v1/payout-exceptions')).json().data).toEqual([])
    expect((await get(other.officer, `/v1/payout-reconciliation/summary?provider_config_id=${bankFile}`)).json().data.providers).toEqual([])
    const foreign = await call(app, {
      method: 'POST', url: `/v1/payout-providers/${bankFile}/settlement-reports`, as: other.officer, idempotencyKey: true,
      headers: { 'content-type': 'text/csv' }, body: 'end_to_end_id,status,amount_minor,reason\r\n',
    })
    expect(foreign.statusCode).toBe(404)
    for (const url of ['/v1/payout-reconciliation/items', '/v1/payout-exceptions', '/v1/payout-reconciliation/summary']) {
      expect((await get(w.support, url)).statusCode).toBe(403)
    }
    expect((await call(app, { method: 'POST', url: `/v1/payout-providers/${bankFile}/settlement-reports`, as: w.finance, idempotencyKey: true,
      headers: { 'content-type': 'text/csv' }, body: 'x' })).statusCode).toBe(403)
  })
})
