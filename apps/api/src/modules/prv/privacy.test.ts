// FR-PRV-001/002 (PLAN B5 D-B5-16..19, D-B5-23): T-B5-33 public form, T-B5-34 verification and deadlines, T-B5-35 export,
// T-B5-36 correction, T-B5-37 deadline job, T-B5-39 erasure route (TS-28 without the replay: see open issues).
import { gunzipSync } from 'node:zlib'
import type { FastifyInstance } from 'fastify'
import fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, mailsTo,
  ownerRows, resetApiDb, runQueuedJobs, testConfig, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { hashPassword } from '../../lib/passwords.js'
import { audModule } from '../aud/index.js'
import { createCasModule } from '../cas/index.js'
import { iamModule } from '../iam/index.js'
import { parModule } from '../par/index.js'
import { tenModule } from '../ten/index.js'
import { prvCaseTypes, prvModule } from './index.js'
import { deadlinesCron, sendOutcomeJob } from './jobs.js'
import { ERASURE_CLEARED } from './privacy-case.js'
import { member, ownerUnchecked, setSetting } from './test-support.js'

const PASSWORD = 'correct horse battery staple'
const DAY = 86_400_000

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let de: string
let fr: string
let dpo: TestUser
let dpo2: TestUser
let deDpo: TestUser

closePoolsAfterAll()

const modules = () => [iamModule, tenModule, audModule, prvModule, parModule, createCasModule({ types: prvCaseTypes })]

beforeAll(async () => {
  await resetApiDb()
  ;[acme, globex] = [await createTenant(), await createTenant()]
  ;[de, fr] = [await createMarket(acme.id, 'DE'), await createMarket(acme.id, 'FR')]
  ;[dpo, dpo2] = [await createSignedInUser({ tenantId: acme.id, roles: ['DPO'], stepUp: true }), await createSignedInUser({ tenantId: acme.id, roles: ['DPO'], stepUp: true })]
  deDpo = await createSignedInUser({ tenantId: acme.id, roles: ['DPO'], stepUp: true, marketIds: [de] })
  await setSetting(acme.id, dpo.id, dpo2.id, 'privacy.policy', { response_days: { [de]: 30 }, escalate_before_days: 5 })
  app = await buildTestApp({ modules: modules(), env: { SIGN_IN_RATE_LIMIT_PER_MINUTE: '1000' } })
})

afterAll(async () => {
  await app.close()
})

const publicRequest = (body: Record<string, unknown>, on = app) =>
  call(on, { method: 'POST', url: '/v1/public/privacy-requests', body: { tenant: acme.slug, full_name: 'Ann Example', ...body }, idempotencyKey: true })
const staffRequest = (body: Record<string, unknown>, as = dpo) =>
  call(app, { method: 'POST', url: '/v1/privacy-requests', as, body: { received_via: 'Letter', ...body }, idempotencyKey: true })
const detail = (id: string, as = dpo) => call(app, { method: 'GET', url: `/v1/privacy-requests/${id}`, as })
const verify = (id: string, subject: string, method = 'contact_match', as = dpo) =>
  call(app, { method: 'POST', url: `/v1/privacy-requests/${id}/verify`, as, body: { method, subject_participant_id: subject, note: 'Checked' } })
const patchCase = (caseId: string, payload: Record<string, unknown>, as = dpo) =>
  call(app, { method: 'PATCH', url: `/v1/cases/${caseId}`, as, body: { payload } })
const submit = (caseId: string, as = dpo) => call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as, body: {} })
const decide = (caseId: string, decision: 'approve' | 'reject', as = dpo2) =>
  call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as, body: { decision, reason: 'Checked by the DPO' }, idempotencyKey: true })
const requestRow = async (id: string) => (await ownerRows<Record<string, unknown>>('SELECT * FROM privacy_request WHERE id = $1', [id]))[0]!
const caseRow = async (id: string) => (await ownerRows<Record<string, unknown>>('SELECT * FROM case_file WHERE id = $1', [id]))[0]!

/** A verified staff request of the subject, its case payload completed with the retention basis. */
async function verifiedRequest(type: string, subject: { id: string; ref: string; email: string }) {
  const created = (await staffRequest({ type, email: subject.email, participant_ref: subject.ref, details: 'Please' })).json().data
  await verify(created.id, subject.id, type === 'correction' ? 'other' : 'contact_match')
  if (type !== 'correction') await patchCase(created.case_id, { request_id: created.id, participant_id: subject.id, retention_basis: 'Tax records: 10 years' })
  return created as { id: string; case_id: string }
}

describe('public form (T-B5-33, AC-PRV1-1)', () => {
  test('202 with a reference only; sealed requester; system case without market seen only by all-market DPOs', async () => {
    const response = await publicRequest({ type: 'access', email: 'ann@example.test' })
    const [row] = await ownerRows<{ id: string; case_id: string; requester_sealed: string; channel: string }>(
      'SELECT id, case_id, requester_sealed, channel FROM privacy_request ORDER BY received_at DESC LIMIT 1')
    const c = await caseRow(row!.case_id)

    expect(response.statusCode).toBe(202)
    expect(response.json().data).toEqual({ reference: row!.id.slice(0, 8).toUpperCase() })
    expect(row!.requester_sealed).not.toContain('ann@')
    expect(c).toMatchObject({ type: 'privacy', state: 'open', subject_type: 'privacy_request', subject_id: row!.id, market_id: null, opened_by: null })
    const deList = (await call(app, { method: 'GET', url: '/v1/privacy-requests', as: deDpo })).json().data.map((r: { id: string }) => r.id)
    const allList = (await call(app, { method: 'GET', url: '/v1/privacy-requests', as: dpo })).json().data.map((r: { id: string }) => r.id)
    expect(deList).not.toContain(row!.id)
    expect(allList).toContain(row!.id)
    expect((await detail(row!.id, deDpo)).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/cases/${row!.case_id}`, as: deDpo })).statusCode).toBe(404)
    expect((await detail(row!.id)).json().data.requester).toMatchObject({ full_name: 'Ann Example', email: 'ann@example.test' })
    expect(await auditActions(acme.id)).toContain('PRIVACY_REQUEST.REQUESTER_READ')
  })

  test('unknown tenant 404 TENANT_NOT_FOUND; correction without details 400; rate limited per tenant and email', async () => {
    const limited = await buildTestApp({ modules: modules(), env: { SIGN_IN_RATE_LIMIT_PER_MINUTE: '2' } })
    const unknown = await call(app, {
      method: 'POST', url: '/v1/public/privacy-requests', idempotencyKey: true,
      body: { tenant: 'no-such-tenant', type: 'access', full_name: 'A', email: 'a@example.test' },
    })
    const noDetails = await publicRequest({ type: 'correction', email: 'b@example.test' })
    const answers = []
    for (let i = 0; i < 3; i++) answers.push((await publicRequest({ type: 'access', email: 'c@example.test' }, limited)).statusCode)
    await limited.close()

    expect(unknown.json().error.code).toBe('TENANT_NOT_FOUND')
    expect(noDetails.statusCode).toBe(400)
    expect(answers).toEqual([202, 202, 429])
  })
})

describe('verification, submit and decision (T-B5-34, AC-PRV1-2/3)', () => {
  test('contact_match refuses another email; a match verifies with due_at = received + 30 days for DE', async () => {
    const subject = await member(acme.id, de)
    const created = (await staffRequest({ type: 'access', email: 'someone.else@example.test', participant_ref: subject.ref })).json().data
    const matching = (await staffRequest({ type: 'access', email: subject.email, participant_ref: subject.ref })).json().data

    const mismatch = await verify(created.id, subject.id)
    const verified = await verify(matching.id, subject.id)
    const again = await verify(matching.id, subject.id)
    const row = await requestRow(matching.id)

    expect(mismatch.json().error.code).toBe('VERIFICATION_MISMATCH')
    expect(verified.statusCode).toBe(200)
    expect(row.verification_method).toBe('contact_match')
    expect((row.due_at as Date).getTime() - (row.received_at as Date).getTime()).toBe(30 * DAY)
    expect(again.json().error.code).toBe('ALREADY_VERIFIED')
  })

  test('a subject of a market without a response time gets no deadline; document needs evidence', async () => {
    const subject = await member(acme.id, fr)
    const created = (await staffRequest({ type: 'access', email: subject.email, participant_ref: subject.ref })).json().data

    const document = await verify(created.id, subject.id, 'document')
    const other = await verify(created.id, subject.id, 'other')
    const listed = async (overdue: string) =>
      (await call(app, { method: 'GET', url: `/v1/privacy-requests?overdue=${overdue}`, as: dpo })).json().data.map((r: { id: string }) => r.id)

    expect(document.json().error.code).toBe('EVIDENCE_REQUIRED')
    expect(other.json().data).toMatchObject({ verified: true, deadline_configured: false, due_at: null })
    expect(await listed('false')).toContain(created.id)
    expect(await listed('true')).not.toContain(created.id)
  })

  test('D-B5-23: a request opened for a DE member cannot be verified to an FR member', async () => {
    const deMember = await member(acme.id, de)
    const frMember = await member(acme.id, fr)
    const created = (await staffRequest({ type: 'access', email: frMember.email, participant_ref: deMember.ref })).json().data

    const moved = await verify(created.id, frMember.id, 'other')

    expect(moved.statusCode).toBe(422)
    expect(moved.json().error.code).toBe('SUBJECT_MARKET_MISMATCH')
    expect(await requestRow(created.id)).toMatchObject({ verified_at: null, subject_participant_id: null })
  })

  test('submit needs verification and the retention basis; the submitter cannot approve; a second DPO can', async () => {
    const subject = await member(acme.id, de)
    const created = (await staffRequest({ type: 'erasure', email: subject.email, participant_ref: subject.ref })).json().data

    const unverified = await submit(created.case_id)
    const emailOnly = await verify(created.id, subject.id)
    await verify(created.id, subject.id, 'other')
    const noBasis = await submit(created.case_id)
    await patchCase(created.case_id, { request_id: created.id, participant_id: subject.id, retention_basis: 'Ledger: 10 years' })
    const fixed = await patchCase(created.case_id, { request_id: created.id, participant_id: dpo.id, retention_basis: 'x' })
    const submitted = await submit(created.case_id)
    const self = await decide(created.case_id, 'approve', dpo)
    const rejected = await decide(created.case_id, 'reject')

    expect(unverified.json().error.code).toBe('VERIFICATION_REQUIRED')
    expect(emailOnly.json().error.code).toBe('VERIFICATION_METHOD_NOT_ALLOWED') // the email match proves no mailbox control
    expect(noBasis.json().error.code).toBe('VALIDATION_FAILED')
    expect(fixed.json().error.code).toBe('PAYLOAD_FIXED')
    expect(submitted.json().data.effect_preview).toMatchObject({ type: 'erasure', cleared: ERASURE_CLEARED, blockers: [] })
    expect(self.json().error.code).toBe('SOD_SELF_APPROVAL')
    expect(rejected.statusCode).toBe(200)
    expect(await requestRow(created.id)).toMatchObject({ outcome: 'refused' })
  })

  test('a DPO related to the subject cannot decide its request', async () => {
    const subject = await member(acme.id, de)
    const related = await createSignedInUser({ tenantId: acme.id, roles: ['DPO'], stepUp: true })
    await ownerRows(`INSERT INTO user_related_participant (tenant_id, user_id, participant_id, relation, declared_by) VALUES ($1, $2, $3, 'relative', $2)`,
      [acme.id, related.id, subject.id])
    const created = await verifiedRequest('access', subject)
    await submit(created.case_id)

    const decided = await decide(created.case_id, 'approve', related)

    expect(decided.json().error.code).toBe('SOD_SELF_APPROVAL')
    expect(await requestRow(created.id)).toMatchObject({ outcome: null })
  })

  test('scope, permission and tenant: a DE DPO cannot record a request without market; Support 403; another tenant 404', async () => {
    const subject = await member(acme.id, de)
    const created = (await staffRequest({ type: 'access', email: subject.email, participant_ref: subject.ref })).json().data
    const support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
    const outsider = await createSignedInUser({ tenantId: globex.id, roles: ['DPO'], stepUp: true })

    const noMarket = await staffRequest({ type: 'access', full_name: 'Unknown person' }, deDpo)
    const inMarket = await detail(created.id, deDpo)

    expect(noMarket.json().error.code).toBe('SCOPE_NOT_HELD')
    expect(inMarket.statusCode).toBe(200)
    expect((await detail(created.id, support)).statusCode).toBe(403)
    expect((await detail(created.id, outsider)).statusCode).toBe(404)
    expect((await verify(created.id, subject.id, 'other', outsider)).statusCode).toBe(404)
  })
})

describe('access export (T-B5-35, AC-PRV1-4/5, AC-PRV1-8)', () => {
  test('approved access writes a hashed export; the DPO and the subject download it; another member gets 404', async () => {
    const subject = await member(acme.id, de)
    const stranger = await member(acme.id, de)
    const portal = await createPortalUser({ tenantId: acme.id, participantId: subject.id })
    const otherPortal = await createPortalUser({ tenantId: acme.id, participantId: stranger.id })
    const created = await verifiedRequest('access', subject)
    await submit(created.case_id)

    const approved = await decide(created.case_id, 'approve')
    const [stored] = await ownerRows<{ content: Buffer; content_sha256: Buffer }>('SELECT content, content_sha256 FROM privacy_export WHERE request_id = $1', [created.id])
    const byDpo = await call(app, { method: 'GET', url: `/v1/privacy-requests/${created.id}/export`, as: dpo })
    const bySubject = await call(app, { method: 'GET', url: `/v1/me/privacy-requests/${created.id}/export`, as: portal })
    const byStranger = await call(app, { method: 'GET', url: `/v1/me/privacy-requests/${created.id}/export`, as: otherPortal })
    const ownList = await call(app, { method: 'GET', url: '/v1/me/privacy-requests', as: portal })

    expect(approved.statusCode).toBe(200)
    expect(stored!.content_sha256).toHaveLength(32)
    expect(byDpo.headers['content-disposition']).toMatch(/^attachment/)
    expect(byDpo.body).toBe(gunzipSync(stored!.content).toString())
    expect(byDpo.body).toContain(subject.ref)
    expect(byDpo.body).not.toContain(stranger.ref)
    expect(bySubject.statusCode).toBe(200)
    expect(byStranger.statusCode).toBe(404)
    expect(ownList.json().data).toEqual([expect.objectContaining({ id: created.id, type: 'access', state: 'fulfilled' })])
    expect((await auditActions(acme.id)).filter((a) => a === 'PRIVACY_EXPORT.DOWNLOADED')).toHaveLength(2)
  })

  test('the outcome of a staff request is mailed by prv.send-outcome after the decision', async () => {
    const subject = await member(acme.id, de)
    const created = await verifiedRequest('access', subject)
    await submit(created.case_id)
    await decide(created.case_id, 'reject')

    const ran = await runQueuedJobs(sendOutcomeJob)
    const mails = await mailsTo(subject.email)

    expect(ran).toBeGreaterThanOrEqual(1)
    expect(mails.at(-1)).toContain(`request with reference ${created.id.slice(0, 8).toUpperCase()} could not be completed`)
  })

  test('portal requests: verified by the session, one open per type, erasure needs re-authentication', async () => {
    const subject = await member(acme.id, de)
    const portal = await createPortalUser({ tenantId: acme.id, participantId: subject.id })
    const ask = (body: Record<string, unknown>) =>
      call(app, { method: 'POST', url: '/v1/me/privacy-requests', as: portal, body, idempotencyKey: true })

    const access = await ask({ type: 'portability' })
    const twice = await ask({ type: 'portability' })
    const erasure = await ask({ type: 'erasure' })
    const row = await requestRow(access.json().data.id)

    expect(access.statusCode).toBe(201)
    expect(access.json().data).toMatchObject({ state: 'in_progress', due_at: expect.any(String) })
    expect(row).toMatchObject({ channel: 'portal', verification_method: 'portal_session', subject_participant_id: subject.id, requester_user_id: portal.id })
    expect(twice.json().error.code).toBe('REQUEST_OPEN')
    expect(erasure.json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await call(app, { method: 'GET', url: '/v1/privacy-requests', as: portal })).statusCode).toBe(403)
  })
})

describe('correction (T-B5-36, AC-PRV1-7)', () => {
  test('sealed corrections, field names only in the case, applied on approval and cleared', async () => {
    const subject = await member(acme.id, de)
    const created = await verifiedRequest('correction', subject)
    const put = (body: unknown) => call(app, { method: 'PUT', url: `/v1/privacy-requests/${created.id}/corrections`, as: dpo, body })

    const saved = await put({ display_name: 'Corrected Name', contact: { email: 'new.address@example.test' } })
    const submitted = await submit(created.case_id)
    const read = await detail(created.id)
    await decide(created.case_id, 'approve')
    const [participant] = await ownerRows<{ display_name: string; contact: { email: string } }>('SELECT display_name, contact FROM participant WHERE id = $1', [subject.id])
    const c = await caseRow(created.case_id)

    expect(saved.json().data).toEqual({ fields: ['contact.email', 'display_name'] })
    expect(JSON.stringify([c.payload, c.effect_preview])).not.toMatch(/Corrected Name|new\.address/)
    expect(submitted.json().data.effect_preview.corrections).toContainEqual({ field: 'contact.email', current: 'm•••@e•••.test', corrected: 'n•••@e•••.test' })
    expect(read.json().data.corrections).toEqual({ display_name: 'Corrected Name', contact: { email: 'new.address@example.test' } })
    expect(participant).toMatchObject({ display_name: 'Corrected Name', contact: { email: 'new.address@example.test' } })
    expect(await requestRow(created.id)).toMatchObject({ corrections_sealed: null, outcome: 'fulfilled' })
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['PRIVACY_REQUEST.CORRECTIONS_READ', 'PARTICIPANT.CORRECTED']))
  })

  test('a subject erased before the approval: 409 SUBJECT_ERASED, the case stays submitted', async () => {
    const subject = await member(acme.id, de)
    const created = await verifiedRequest('correction', subject)
    await call(app, { method: 'PUT', url: `/v1/privacy-requests/${created.id}/corrections`, as: dpo, body: { display_name: 'New Name' } })
    await submit(created.case_id)
    await ownerUnchecked('UPDATE participant SET pseudonymised_at = now(), display_name = NULL, contact = NULL WHERE id = $1', [subject.id])

    const approved = await decide(created.case_id, 'approve')

    expect(approved.statusCode).toBe(409)
    expect(approved.json().error.code).toBe('SUBJECT_ERASED')
    expect(await caseRow(created.case_id)).toMatchObject({ state: 'submitted' })
  })
})

describe('deadline job (T-B5-37, AC-PRV1-6)', () => {
  test('due within escalate_before_days: escalated once, one mail per privacy.manage holder', async () => {
    const subject = await member(acme.id, de)
    const created = await verifiedRequest('access', subject)
    await ownerUnchecked(`UPDATE privacy_request SET due_at = now() + interval '4 days' WHERE id = $1`, [created.id])
    const ctx = { jobId: 'test', config: testConfig(), log: fastify({ logger: false }).log }

    await deadlinesCron.run(ctx)
    await deadlinesCron.run(ctx)
    const reference = created.id.slice(0, 8).toUpperCase()
    const mailed = async (user: TestUser) => (await mailsTo(user.email)).filter((m) => m.includes(reference)).length

    expect((await requestRow(created.id)).escalated_at).not.toBeNull()
    expect([await mailed(dpo), await mailed(dpo2), await mailed(deDpo)]).toEqual([1, 1, 1])
  })
})

describe('erasure (T-B5-39, TS-28, AC-30.1, AC-PRV2-1/2)', () => {
  test('an active hold defers it (409 ERASURE_DEFERRED, case stays submitted); released, the subject is pseudonymised', async () => {
    const subject = await member(acme.id, de)
    const portal = await createPortalUser({ tenantId: acme.id, participantId: subject.id, email: subject.email, passwordHash: await hashPassword(PASSWORD), stepUp: true })
    const [hold] = await ownerRows<{ id: string }>(
      'INSERT INTO payout_hold (tenant_id, participant_id, market_id, reason, placed_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [acme.id, subject.id, de, 'Fixture hold', dpo.id])
    const asked = await call(app, {
      method: 'POST', url: '/v1/me/privacy-requests', as: portal, body: { type: 'erasure', details: 'Please erase my account' }, idempotencyKey: true,
    })
    const { id } = asked.json().data
    const caseId = (await requestRow(id)).case_id as string
    await patchCase(caseId, { request_id: id, participant_id: subject.id, retention_basis: 'Ledger and tax records: 10 years' })
    await submit(caseId)

    const deferred = await decide(caseId, 'approve')
    const afterDeferral = await requestRow(id)
    await ownerUnchecked(`UPDATE payout_hold SET released_by = $2, released_at = now(), release_reason = 'Fixture' WHERE id = $1`, [hold!.id, dpo.id])
    const erased = await decide(caseId, 'approve')
    const record = await call(app, { method: 'GET', url: `/v1/participants/${subject.id}`, as: dpo })
    const session = await call(app, { method: 'GET', url: '/v1/me', as: portal })
    const signIn = await call(app, { method: 'POST', url: '/v1/auth/portal-sessions', body: { tenant: acme.slug, email: subject.email, password: PASSWORD } })
    const [audit] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE action = 'PARTICIPANT.PSEUDONYMISED' AND object_id = $1`, [subject.id])

    expect(deferred.statusCode).toBe(409)
    expect(deferred.json().error).toMatchObject({ code: 'ERASURE_DEFERRED', details: { reasons: [{ reason: 'payout_hold', hold_id: hold!.id }] } })
    expect(erased.statusCode).toBe(200)
    expect(record.json().data).toMatchObject({ display_name: `Erased participant ${subject.ref}`, contact_masked: null, pseudonymised_at: expect.any(String) })
    expect(session.statusCode).toBe(401)
    expect(signIn.statusCode).toBe(401)
    expect(afterDeferral.requester_sealed).not.toBeNull()
    expect(await requestRow(id)).toMatchObject({ outcome: 'fulfilled', retention_basis: 'Ledger and tax records: 10 years', requester_sealed: null })
    expect(JSON.parse(audit!.after_ref).after.cleared).toEqual(ERASURE_CLEARED)
    // D-B5-16: a portal requester is told by the notice only; no mail is written inside the decision transaction.
    expect((await mailsTo(subject.email)).join()).not.toContain('erased')
  })
})
