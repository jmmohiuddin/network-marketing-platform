import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, mailsTo, ownerRows, resetApiDb, runQueuedJobs, type TestUser,
} from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { payCaseTypes, payModule } from './index.js'
import { noticeJob } from './notices.js'
import { bankVersion, credit, customRoleUser, evidenceDocument, participant, payWorld, post, provider, setSettings, type PayWorld } from './test-support.js'

let app: FastifyInstance
let w: PayWorld
let other: PayWorld
let payee: string
const NEW_IBAN = 'DE89370400440532013000'
const CONTACT = `record-${Date.now()}@example.test`
const REQUEST_CONTACT = `request-${Date.now()}@example.test`

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  w = await payWorld()
  other = await payWorld()
  await setSettings(w, {
    'payouts.market_policy': { [w.market]: { minimum_payout_minor: '100', tax_profile_required: false } },
    'payouts.bank_detail_cooling_off_hours': 72,
    'payouts.shared_account_threshold': 3,
  })
  app = await buildTestApp({ modules: [payModule, createCasModule({ types: payCaseTypes })] })
  payee = await participant(w.tenant.id, w.market, CONTACT)
  await bankVersion(w.tenant.id, payee)
}, 120_000)

afterAll(async () => {
  await app.close()
})

/** Resolves once `count` sessions wait on a lock. */
async function lockWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await ownerRows(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`fewer than ${count} sessions waited on a lock`)
}

const details = (iban = NEW_IBAN) => ({ scheme: 'iban', account_holder: 'Dana Payee', iban, contact_email: REQUEST_CONTACT })
const request = (as: TestUser, id = payee, body: unknown = details()) => post(app, as, `/v1/participants/${id}/bank-detail-requests`, body)

async function openCase(as: TestUser, requestId: string) {
  const opened = await call(app, {
    method: 'POST', url: '/v1/cases', as, idempotencyKey: true,
    body: { type: 'bank_detail', subject_type: 'participant', subject_id: payee, reason_code: 'PAYEE_REQUEST', payload: { request_id: requestId } },
  })
  return opened
}

describe('bank-detail requests and the bank_detail case (AC-17.1, AC-17.2, AC-PAY5-1, AC-PAY5-2, T-B4-20)', () => {
  test('without a fresh second factor: 403 STEP_UP_REQUIRED and no row', async () => {
    const support = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Support agent'] })
    const refused = await request(support)
    expect(refused.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(await ownerRows('SELECT 1 FROM bank_detail_request WHERE participant_id = $1', [payee])).toHaveLength(0)
  })

  test('an invalid IBAN checksum is 422 BANK_DETAILS_INVALID with its path', async () => {
    const refused = await request(w.support, payee, details('DE89370400440532013001'))
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'BANK_DETAILS_INVALID', details: { path: 'iban' } })
  })

  test('approved change: new version in cooling-off, previous superseded, two notices; preview warns of shared accounts', async () => {
    for (let n = 0; n < 3; n += 1) await bankVersion(w.tenant.id, await participant(w.tenant.id, w.market), { iban: NEW_IBAN })
    const created = await request(w.support)
    expect(created.statusCode).toBe(201)
    expect(created.json().data).toEqual({ request_id: expect.any(String), masked: '•••• 3000', shared_with_count: 3 })
    const requestId = created.json().data.request_id as string
    expect(JSON.stringify(await ownerRows('SELECT details_sealed FROM bank_detail_request WHERE id = $1', [requestId]))).not.toContain(NEW_IBAN)

    const opened = await openCase(w.support, requestId)
    expect(opened.statusCode).toBe(201)
    const caseId = opened.json().data.id as string
    expect((await openCase(w.support, requestId)).json().error.code).toBe('REQUEST_USED')
    await call(app, { method: 'POST', url: `/v1/cases/${caseId}/evidence`, as: w.support, idempotencyKey: true,
      body: { document_id: await evidenceDocument(w.tenant.id, w.support.id) } })
    const submitted = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.support, body: {} })
    expect(submitted.json().data.effect_preview).toMatchObject({
      current_masked: '•••• 5432', new_masked: '•••• 3000', cooling_off_hours: 72, shared_with_count: 3, shared_account_threshold: 3, shared_above_threshold: true,
    })
    const decide = (as: TestUser) => call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as, idempotencyKey: true, body: { decision: 'approve', reason: 'verified by phone' } })
    expect((await decide(w.support)).statusCode).toBe(403)
    const before = Date.now()
    expect((await decide(w.compliance)).statusCode).toBe(200)

    const read = await call(app, { method: 'GET', url: `/v1/participants/${payee}/bank-details`, as: w.officer })
    const { current, history } = read.json().data
    expect(current).toMatchObject({ masked: '•••• 3000', created_via: 'case', in_cooling_off: true })
    expect(new Date(current.cooling_off_until).getTime()).toBeGreaterThanOrEqual(before + 72 * 3600_000 - 5000)
    expect(history).toEqual([expect.objectContaining({ masked: '•••• 5432', superseded_at: expect.any(String) })])
    expect(read.body).not.toContain('sealed')
    expect(read.body).not.toContain('fingerprint')

    // D-B5-14: the contact on record gets the mandatory notice rows; the job mails only the request's contact.
    const notices = await ownerRows<{ channel: string; state: string; params: Record<string, unknown> }>(
      `SELECT channel, state, params FROM notification WHERE recipient_participant_id = $1 AND template = 'bank_detail.changed' ORDER BY channel`, [payee])
    expect(notices).toEqual([
      { channel: 'email', state: 'queued', params: expect.objectContaining({ masked: '•••• 3000', previous_masked: '•••• 5432' }) },
      { channel: 'in_app', state: 'delivered', params: expect.objectContaining({ masked: '•••• 3000', previous_masked: '•••• 5432' }) },
    ])
    expect(new Date(notices[0]!.params.cooling_off_until as string).getTime()).toBe(new Date(current.cooling_off_until).getTime())
    await runQueuedJobs(noticeJob as never)
    expect(await mailsTo(CONTACT)).toHaveLength(0)
    expect(await mailsTo(REQUEST_CONTACT)).toHaveLength(1)
    const mail = (await mailsTo(REQUEST_CONTACT))[0]!
    expect(mail).toContain('•••• 3000')
    // BUG-100: the cooling-off end reads as the UI shows it, in the market's zone (Europe/London), not a raw ISO instant
    const shown = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(current.cooling_off_until))
    expect(mail).toContain(`Payouts to the new account start after ${shown} (Europe/London).`)
    expect(mail).not.toContain(current.cooling_off_until)
    expect((await auditActions(w.tenant.id)).filter((a) => a === 'NOTICE.SENT')).toHaveLength(1)
    expect(await auditActions(w.tenant.id)).toEqual(expect.arrayContaining(['BANK_DETAIL.REQUESTED', 'BANK_DETAIL.VERSION_CREATED']))

    // TS-17: a batch prepared inside the window excludes the payee
    await credit(w, payee, '5000')
    const sandbox = await provider(app, w, 'sandbox')
    const batch = await post(app, w.officer, '/v1/payout-batches', { market_id: w.market, provider_config_id: sandbox })
    const exclusion = batch.json().data.exclusions.find((e: { participant: { id: string } }) => e.participant.id === payee)
    // BUG-104: the same instant, serialised like every other API instant (UTC, milliseconds, Z)
    expect(exclusion.reasons).toEqual([{ reason: 'bank_detail_cooling_off', detail: { until: current.cooling_off_until } }])
  })

  test('BUG-135: the request-contact notice reads in the participant\'s language (market {de}, no portal account)', async () => {
    const at = await createMarket(w.tenant.id, 'AT')
    await ownerRows(`UPDATE market SET languages = '{de}', time_zone = 'Europe/Vienna' WHERE id = $1`, [at])
    const atPayee = await participant(w.tenant.id, at)
    const contact = `at-${Date.now()}@example.test`
    const created = await request(w.support, atPayee, { ...details('AT611904300234573201'), contact_email: contact })
    expect(created.statusCode, created.body).toBe(201)
    const opened = await call(app, {
      method: 'POST', url: '/v1/cases', as: w.support, idempotencyKey: true,
      body: { type: 'bank_detail', subject_type: 'participant', subject_id: atPayee, reason_code: 'PAYEE_REQUEST', payload: { request_id: created.json().data.request_id } },
    })
    const caseId = opened.json().data.id as string
    await call(app, { method: 'POST', url: `/v1/cases/${caseId}/evidence`, as: w.support, idempotencyKey: true,
      body: { document_id: await evidenceDocument(w.tenant.id, w.support.id) } })
    expect((await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.support, body: {} })).statusCode).toBe(200)
    const approved = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as: w.compliance, idempotencyKey: true, body: { decision: 'approve', reason: 'verified' } })
    expect(approved.statusCode, approved.body).toBe(200)

    await runQueuedJobs(noticeJob as never)
    const mail = (await mailsTo(contact))[0]!
    expect(mail).toContain('Subject: Ihre Bankdaten für Auszahlungen wurden geändert')
    expect(mail).toContain('Ihre Bankdaten für Auszahlungen wurden auf •••• 3201 festgelegt.') // BUG-141 (DIST): first account, no "von keinem"
    expect(mail).not.toContain('von keinem')
    expect(mail).toContain('(Europe/Vienna)')
  })

  test('BUG-141: a request contact equal to the contact on record (any case) gets the account notice only, not a second mail', async () => {
    const address = `dup-${Date.now()}@example.test`
    const dupPayee = await participant(w.tenant.id, w.market, address)
    const created = await request(w.support, dupPayee, { ...details('GB33BUKB20201555555555'), contact_email: address.toUpperCase() })
    expect(created.statusCode, created.body).toBe(201)
    const opened = await call(app, {
      method: 'POST', url: '/v1/cases', as: w.support, idempotencyKey: true,
      body: { type: 'bank_detail', subject_type: 'participant', subject_id: dupPayee, reason_code: 'PAYEE_REQUEST', payload: { request_id: created.json().data.request_id } },
    })
    const caseId = opened.json().data.id as string
    await call(app, { method: 'POST', url: `/v1/cases/${caseId}/evidence`, as: w.support, idempotencyKey: true,
      body: { document_id: await evidenceDocument(w.tenant.id, w.support.id) } })
    expect((await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.support, body: {} })).statusCode).toBe(200)
    const approved = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as: w.compliance, idempotencyKey: true, body: { decision: 'approve', reason: 'verified' } })
    expect(approved.statusCode, approved.body).toBe(200)

    await runQueuedJobs(noticeJob as never)
    expect(await mailsTo(address)).toHaveLength(0)
    expect(await mailsTo(address.toUpperCase())).toHaveLength(0)
    const queued = await ownerRows(`SELECT 1 FROM notification WHERE recipient_participant_id = $1 AND template = 'bank_detail.changed' AND channel = 'email'`, [dupPayee])
    expect(queued).toHaveLength(1)
    expect(await auditActions(w.tenant.id)).toContain('NOTICE.SKIPPED')
  })

  test('the request counts sharers in the requester\'s markets only; the approver\'s preview counts every market', async () => {
    const ie = await createMarket(w.tenant.id, 'IE')
    await bankVersion(w.tenant.id, await participant(w.tenant.id, ie), { iban: NEW_IBAN })
    const someone = await participant(w.tenant.id, w.market)
    const gbSupport = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Support agent'], marketIds: [w.market], stepUp: true })
    // NEW_IBAN is current for the payee and three more GB participants, and for one IE participant.
    expect((await request(gbSupport, someone)).json().data.shared_with_count).toBe(4)
    expect((await request(w.support, someone)).json().data.shared_with_count).toBe(5)
  })

  test('two cases opened at once for one request: one opens, the other is 409 REQUEST_USED', async () => {
    const requestId = (await request(w.support)).json().data.request_id as string
    // Holding the tenant's audit lock lets both creates pass validation before either commits (the race).
    const holder = await getOwnerPool().connect()
    try {
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('audit.audit_event:' || $1::text, 0))`, [w.tenant.id])
      const both = [openCase(w.support, requestId), openCase(w.support, requestId)]
      await lockWaiters(2)
      await holder.query('COMMIT')

      const statuses = (await Promise.all(both)).map((response) => `${response.statusCode} ${response.json().error?.code ?? ''}`.trim()).sort()

      expect(statuses).toEqual(['201', '409 REQUEST_USED'])
    } finally {
      holder.release()
    }
  })

  test('the requester cannot approve their own change (422 SOD_SELF_APPROVAL)', async () => {
    const both = await customRoleUser(w.tenant.id, ['participant.read', 'case.bank_detail.read', 'case.bank_detail.create', 'case.bank_detail.approve'])
    const created = await request(both)
    const caseId = (await openCase(both, created.json().data.request_id)).json().data.id
    await call(app, { method: 'POST', url: `/v1/cases/${caseId}/evidence`, as: both, idempotencyKey: true, body: { document_id: await evidenceDocument(w.tenant.id, both.id) } })
    await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: both, body: {} })
    const refused = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as: both, idempotencyKey: true, body: { decision: 'approve', reason: 'mine' } })
    expect(refused.json().error.code).toBe('SOD_SELF_APPROVAL')
  })

  test('another tenant gets 404; no permission gets 403; an unset cooling-off refuses the request', async () => {
    expect((await request(other.support)).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/participants/${payee}/bank-details`, as: other.officer })).statusCode).toBe(404)
    const integration = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Integration'], stepUp: true })
    expect((await request(integration)).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: `/v1/participants/${payee}/bank-details`, as: integration })).statusCode).toBe(403)
    const unset = await request(other.support, await participant(other.tenant.id, other.market))
    expect(unset.json().error).toMatchObject({ code: 'SETTING_NOT_CONFIGURED', details: { key: 'payouts.bank_detail_cooling_off_hours' } })
  })
})
