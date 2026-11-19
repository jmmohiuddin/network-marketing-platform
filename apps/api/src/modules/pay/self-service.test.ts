import { randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { bankFingerprint, BankDetails } from '../../lib/bank-crypto.js'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createPortalUser, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { payCaseTypes, payModule } from './index.js'
import { bankVersion, credit, evidenceDocument, participant, payWorld, post, provider, SECRET_KEY, setSettings, type PayWorld } from './test-support.js'

// FR-DIST-006 / D-B5-12 payee self-service bank details: TS-17 portal path, AC-17.1, AC-17.2, AC-DIST6-1, T-B5-22,
// payout notices (D-B5-24) and the erased-version exclusion.

let app: FastifyInstance
let w: PayWorld
const SHARED_IBAN = 'DE89370400440532013000'
const OWN_IBAN = 'GB33BUKB20201555555555'

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  w = await payWorld()
  await setSettings(w, {
    'payouts.market_policy': { [w.market]: { minimum_payout_minor: '100', tax_profile_required: false } },
    'payouts.bank_detail_cooling_off_hours': 72,
    'payouts.shared_account_threshold': 2,
  })
  app = await buildTestApp({ modules: [payModule, createCasModule({ types: payCaseTypes })] })
}, 120_000)

afterAll(async () => {
  await app.close()
})

const iban = (value: string) => ({ scheme: 'iban', account_holder: 'Dana Payee', iban: value })
const put = (as: TestUser, body: unknown = iban(OWN_IBAN), key?: string) =>
  call(app, { method: 'PUT', url: '/v1/me/bank-details', as, body, ...(key === undefined ? { idempotencyKey: true } : { headers: { 'idempotency-key': key } }) })
const get = (as: TestUser) => call(app, { method: 'GET', url: '/v1/me/bank-details', as })

async function payee(world: Pick<PayWorld, 'tenant' | 'market'>, stepUp = true) {
  const id = await participant(world.tenant.id, world.market, `self-${Date.now()}-${Math.random()}@example.test`)
  return { id, user: await createPortalUser({ tenantId: world.tenant.id, participantId: id, stepUp }) }
}

describe('PUT /v1/me/bank-details (AC-17.1, AC-17.2, TS-17)', () => {
  test('without re-authentication: 403 STEP_UP_REQUIRED and no rows', async () => {
    const p = await payee(w, false)
    expect((await put(p.user)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect(await ownerRows('SELECT 1 FROM bank_detail_request WHERE participant_id = $1', [p.id])).toHaveLength(0)
  })

  test('invalid details: 422 BANK_DETAILS_INVALID with the path', async () => {
    const p = await payee(w)
    const refused = await put(p.user, iban('GB00BUKB20201555555555'))
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'BANK_DETAILS_INVALID', details: { path: 'iban' } })
  })

  test('a new self version waits the cooling-off, supersedes the old one, notifies, and a batch in the window holds the payee', async () => {
    const p = await payee(w)
    await bankVersion(w.tenant.id, p.id)
    await credit(w, p.id, '5000')
    const before = Date.now()
    const key = `self-${before}`
    const saved = await put(p.user, iban(OWN_IBAN), key)
    expect(saved.statusCode).toBe(201)
    const until = saved.json().data.until as string
    expect(saved.json().data.state).toBe('pending_cooling_off')
    expect(new Date(until).getTime()).toBeGreaterThanOrEqual(before + 72 * 3600_000 - 5000)
    // replay: the same response, one version
    expect((await put(p.user, iban(OWN_IBAN), key)).json().data.until).toBe(until)
    expect(await ownerRows(`SELECT 1 FROM bank_detail_version WHERE participant_id = $1 AND created_via = 'self'`, [p.id])).toHaveLength(1)

    const read = await get(p.user)
    expect(read.json().data).toMatchObject({
      current: { masked: '•••• 5555', scheme: 'iban', created_via: 'self', cooling_off_until: until },
      pending_review: null,
      history: [expect.objectContaining({ masked: '•••• 5432', created_via: 'migration', superseded_at: expect.any(String) })],
      owed: [{ market_code: 'GB', currency: 'GBP', minor_unit: 2, payable_minor: '5000' }],
    })
    expect(read.body).not.toMatch(/sealed|fingerprint|GB33BUKB/)
    const notices = await ownerRows<{ channel: string; mandatory: boolean }>(
      `SELECT channel, mandatory FROM notification WHERE recipient_participant_id = $1 AND template = 'bank_detail.changed' ORDER BY channel`, [p.id])
    expect(notices).toEqual([{ channel: 'email', mandatory: true }, { channel: 'in_app', mandatory: true }])
    const audit = await ownerRows<{ after: Record<string, unknown> }>(
      `SELECT after_ref::jsonb -> 'after' AS after FROM audit.audit_event WHERE tenant_id = $1 AND action = 'BANK_DETAIL.CHANGED' ORDER BY seq`, [w.tenant.id])
    expect(audit.at(-1)!.after).toMatchObject({ created_via: 'self', shared_check: 'below_threshold', masked: '•••• 5555' })
    expect(JSON.stringify(audit)).not.toContain('GB33BUKB')

    // TS-17: inside the window the batch lists the payee with the cooling-off end; the approval writes payout.held
    const paid = await participant(w.tenant.id, w.market)
    await bankVersion(w.tenant.id, paid)
    await credit(w, paid, '7000')
    const sandbox = await provider(app, w, 'sandbox')
    const prepared = await post(app, w.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: sandbox })
    const exclusion = prepared.json().data.exclusions.find((e: { participant: { id: string } }) => e.participant.id === p.id)
    expect(exclusion.reasons).toEqual([{ reason: 'bank_detail_cooling_off', detail: { until } }])
    const batchId = prepared.json().data.id as string
    expect((await post(app, w.officer, `/v1/payout-batches/${batchId}/submit`)).statusCode).toBe(200)
    expect((await post(app, w.finance, `/v1/payout-batches/${batchId}/approve`)).statusCode).toBe(200)
    const held = await ownerRows<{ params: Record<string, unknown> }>(
      `SELECT params FROM notification WHERE recipient_participant_id = $1 AND template = 'payout.held' AND channel = 'in_app'`, [p.id])
    expect(held).toEqual([{ params: expect.objectContaining({ batch_id: batchId, amount_minor: '5000', until, reasons: [{ reason: 'bank_detail_cooling_off', until }] }) }])
    expect(await ownerRows(
      `SELECT 1 FROM notification WHERE recipient_participant_id = $1 AND template = 'payout.sent' AND params ->> 'amount_minor' = '7000'`, [paid])).toHaveLength(1)
  })

  test('an account shared with the threshold of other payees opens a SHARED_ACCOUNT review instead of a version', async () => {
    for (let i = 0; i < 2; i += 1) await bankVersion(w.tenant.id, await participant(w.tenant.id, w.market), { iban: SHARED_IBAN })
    const p = await payee(w)
    const review = await put(p.user, iban(SHARED_IBAN))
    expect(review.statusCode).toBe(202)
    const caseId = review.json().data.case_id as string
    expect(review.json().data).toEqual({ state: 'review_required', case_id: caseId })
    expect(await ownerRows(`SELECT 1 FROM bank_detail_version WHERE participant_id = $1`, [p.id])).toHaveLength(0)
    expect(await ownerRows(
      `SELECT 1 FROM case_file WHERE id = $1 AND type = 'bank_detail' AND opened_by_kind = 'system' AND reason_code = 'SHARED_ACCOUNT'
         AND payload ->> 'participant_id' = $2`, [caseId, p.id])).toHaveLength(1)
    expect((await get(p.user)).json().data).toMatchObject({ current: null, pending_review: { case_id: caseId } })
    expect(await auditActions(w.tenant.id)).toContain('CASE.OPENED')

    // While the review is open the payee cannot record other details: the review would later supersede them.
    const again = await put(p.user, iban('GB29NWBK60161331926819'))
    expect([again.statusCode, again.json().error]).toEqual([409, expect.objectContaining({ code: 'BANK_DETAIL_REVIEW_PENDING', details: { case_id: caseId } })])
    expect(await ownerRows(`SELECT 1 FROM case_file WHERE type = 'bank_detail' AND subject_id = $1`, [p.id])).toHaveLength(1)

    // Staff may PATCH the system-opened review without replacing the payee's own request.
    const [stored] = await ownerRows<{ payload: unknown }>('SELECT payload FROM case_file WHERE id = $1', [caseId])
    expect((await call(app, { method: 'PATCH', url: `/v1/cases/${caseId}`, as: w.support, body: { payload: stored!.payload } })).statusCode).toBe(200)

    // Staff decide it as in B4 (Support adds evidence and submits, Compliance approves) into a 'case' version.
    await call(app, { method: 'POST', url: `/v1/cases/${caseId}/evidence`, as: w.support, idempotencyKey: true,
      body: { document_id: await evidenceDocument(w.tenant.id, w.support.id) } })
    expect((await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.support, body: {} })).statusCode).toBe(200)
    expect((await call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as: w.compliance, idempotencyKey: true,
      body: { decision: 'approve', reason: 'confirmed shared business account' } })).statusCode).toBe(200)
    expect((await get(p.user)).json().data).toMatchObject({ current: { masked: '•••• 3000', created_via: 'case' }, pending_review: null })

    // SHARED_ACCOUNT is a system reason: staff cannot choose it
    const chosen = await call(app, {
      method: 'POST', url: '/v1/cases', as: w.support, idempotencyKey: true,
      body: { type: 'bank_detail', subject_type: 'participant', subject_id: p.id, reason_code: 'SHARED_ACCOUNT', payload: { request_id: caseId } },
    })
    expect(chosen.json().error.code).toBe('REASON_CODE_INVALID')
  })

  test('a staff-opened case (no payload.participant_id) is the payee\'s pending review: 409 BANK_DETAIL_REVIEW_PENDING', async () => {
    const p = await payee(w)
    const requested = await post(app, w.support, `/v1/participants/${p.id}/bank-detail-requests`, iban('BE68539007547034'))
    const opened = await call(app, {
      method: 'POST', url: '/v1/cases', as: w.support, idempotencyKey: true,
      body: { type: 'bank_detail', subject_type: 'participant', subject_id: p.id, reason_code: 'PAYEE_REQUEST', payload: { request_id: requested.json().data.request_id } },
    })
    const caseId = opened.json().data.id as string

    const read = await get(p.user)
    const refused = await put(p.user, iban('NL91ABNA0417164300'))

    expect(read.json().data.pending_review).toMatchObject({ case_id: caseId })
    expect([refused.statusCode, refused.json().error]).toEqual([409, expect.objectContaining({ code: 'BANK_DETAIL_REVIEW_PENDING', details: { case_id: caseId } })])
  })

  test('a staff case decided after the payee\'s own newer change is refused: 409 BANK_DETAIL_SUPERSEDED', async () => {
    const p = await payee(w)
    await bankVersion(w.tenant.id, p.id)
    const requested = await post(app, w.support, `/v1/participants/${p.id}/bank-detail-requests`, iban('BE68539007547034'))
    // The payee's own change lands after the staff request was recorded and before staff open its case.
    expect((await put(p.user, iban('NL91ABNA0417164300'))).statusCode).toBe(201)
    const opened = await call(app, {
      method: 'POST', url: '/v1/cases', as: w.support, idempotencyKey: true,
      body: { type: 'bank_detail', subject_type: 'participant', subject_id: p.id, reason_code: 'PAYEE_REQUEST', payload: { request_id: requested.json().data.request_id } },
    })
    const caseId = opened.json().data.id as string
    await call(app, { method: 'POST', url: `/v1/cases/${caseId}/evidence`, as: w.support, idempotencyKey: true,
      body: { document_id: await evidenceDocument(w.tenant.id, w.support.id) } })
    expect((await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.support, body: {} })).statusCode).toBe(200)

    const decided = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as: w.compliance, idempotencyKey: true,
      body: { decision: 'approve', reason: 'verified by phone' } })
    expect([decided.statusCode, decided.json().error.code]).toEqual([409, 'BANK_DETAIL_SUPERSEDED'])
    expect((await get(p.user)).json().data.current).toMatchObject({ masked: '•••• 4300', created_via: 'self' })
  })

  test('a participant whose every position is terminated still changes its account (D-B5-06): 201', async () => {
    const p = await payee(w)
    await ownerRows(
      `WITH x AS (INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
                  VALUES ($1, $2, $3, 'terminated', '2020-01-01', $4, 'system') RETURNING id)
       INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
       SELECT $1, x.id, $5, '2020-01-01', $4, 'system' FROM x`,
      [w.tenant.id, `T-${randomUUID().slice(0, 8)}`, w.market, '00000000-0000-0000-0000-000000000000', p.id])
    expect((await put(p.user, iban('GB94BARC10201530093459'))).statusCode).toBe(201)
  })

  test('in a portal transaction the shared count sees other payees while a plain SELECT sees none', async () => {
    const p = await payee(w)
    const fingerprint = bankFingerprint(SECRET_KEY, w.tenant.id, BankDetails.parse(iban(SHARED_IBAN)))
    const seen = await withTenant({ tenantId: w.tenant.id, userId: p.user.id, participantId: p.id }, async (tx) => ({
      count: (await tx.query<{ n: number }>('SELECT pay_shared_fingerprint_count($1, $2) AS n', [p.id, fingerprint])).rows[0]!.n,
      rows: (await tx.query('SELECT 1 FROM bank_detail_version WHERE fingerprint = $1', [fingerprint])).rowCount,
    }))
    expect(seen.count).toBeGreaterThanOrEqual(2)
    expect(seen.rows).toBe(0)
  })

  test('threshold unset: direct version audited not_configured; cooling-off unset: 422 SETTING_NOT_CONFIGURED', async () => {
    const plain = await payWorld('IE')
    const p = await payee(plain)
    expect((await put(p.user)).json().error).toMatchObject({ code: 'SETTING_NOT_CONFIGURED', details: { key: 'payouts.bank_detail_cooling_off_hours' } })
    expect(await ownerRows('SELECT 1 FROM bank_detail_request WHERE participant_id = $1', [p.id])).toHaveLength(0)
    await setSettings(plain, { 'payouts.bank_detail_cooling_off_hours': 24 })
    expect((await put(p.user)).statusCode).toBe(201)
    const audit = await ownerRows<{ after: Record<string, unknown> }>(
      `SELECT after_ref::jsonb -> 'after' AS after FROM audit.audit_event WHERE tenant_id = $1 AND action = 'BANK_DETAIL.CHANGED'`, [plain.tenant.id])
    expect(audit).toEqual([{ after: expect.objectContaining({ shared_check: 'not_configured' }) }])
  })

  test('only the payee itself: another participant or tenant sees nothing of it; staff sessions are refused', async () => {
    const p = await payee(w)
    await put(p.user)
    const neighbour = await payee(w)
    expect((await get(neighbour.user)).json().data).toEqual({ current: null, pending_review: null, history: [], owed: [] })
    const foreign = await payWorld('NL')
    expect((await get((await payee(foreign)).user)).json().data.current).toBeNull()
    expect((await get(w.support)).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await put(w.support)).json().error.code).toBe('REALM_FORBIDDEN')
  })
})

describe('payout.held at approval (D-B5-24)', () => {
  test('a hold placed after submit on a payee already below the minimum is announced with the reason in force at approval', async () => {
    const x = await payWorld('DE')
    await setSettings(x, {
      'payouts.market_policy': { [x.market]: { minimum_payout_minor: '100', tax_profile_required: false } },
      'payouts.bank_detail_cooling_off_hours': 72,
    })
    const small = await participant(x.tenant.id, x.market)
    await bankVersion(x.tenant.id, small)
    await credit(x, small, '50')
    const paid = await participant(x.tenant.id, x.market)
    await bankVersion(x.tenant.id, paid)
    await credit(x, paid, '7000')
    const sandbox = await provider(app, x, 'sandbox')
    const prepared = await post(app, x.officer, '/v1/payout-batches', { market_id: x.market, provider_config_id: sandbox })
    expect(prepared.statusCode).toBe(201)
    const batchId = prepared.json().data.id as string
    expect((await post(app, x.officer, `/v1/payout-batches/${batchId}/submit`)).statusCode).toBe(200)
    expect((await post(app, x.compliance, `/v1/payees/${small}/holds`, { market_id: x.market, reason: 'Fraud review' })).statusCode).toBe(201)
    expect((await post(app, x.finance, `/v1/payout-batches/${batchId}/approve`)).statusCode).toBe(200)

    const held = await ownerRows<{ params: Record<string, unknown> }>(
      `SELECT params FROM notification WHERE recipient_participant_id = $1 AND template = 'payout.held' AND channel = 'in_app'`, [small])
    expect(held).toEqual([{ params: expect.objectContaining({ batch_id: batchId, amount_minor: '50', reasons: [{ reason: 'hold' }] }) }])
    expect(JSON.stringify(held)).not.toContain('Fraud review')
    const [batch] = await ownerRows<{ reasons: string[] }>(
      `SELECT array(SELECT r ->> 'reason' FROM jsonb_array_elements(b.exclusions) e, jsonb_array_elements(e -> 'reasons') r
                    WHERE e ->> 'participant_id' = $2) AS reasons FROM payout_batch b WHERE b.id = $1`, [batchId, small])
    expect(batch!.reasons).toEqual(expect.arrayContaining(['below_minimum', 'hold']))
  })
})

describe('erased bank details (D-B5-12)', () => {
  test('a version whose sealed details were erased is no_bank_details in the batch selection', async () => {
    const de = await payWorld('DE')
    await setSettings(de, {
      'payouts.market_policy': { [de.market]: { minimum_payout_minor: '100', tax_profile_required: false } },
      'payouts.bank_detail_cooling_off_hours': 72,
    })
    const p = await participant(de.tenant.id, de.market)
    const version = await bankVersion(de.tenant.id, p)
    await credit(de, p, '3000')
    await ownerRows(`UPDATE bank_detail_version SET details_sealed = NULL, masked = 'erased' WHERE id = $1`, [version])
    const sandbox = await provider(app, de, 'sandbox')
    const prepared = await post(app, de.officer, '/v1/payout-batches', { market_id: de.market, provider_config_id: sandbox })
    const exclusion = prepared.json().data.exclusions.find((e: { participant: { id: string } }) => e.participant.id === p)
    expect(exclusion.reasons).toEqual([{ reason: 'no_bank_details', detail: {} }])
  })
})
