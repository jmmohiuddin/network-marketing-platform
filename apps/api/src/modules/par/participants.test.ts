import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { parModule } from './index.js'
import { activeType, agreementDocument, apiKey, CUSTOMER, DISTRIBUTOR, enrolled, enrolment, keyCall, publishAgreement } from './test-support.js'

// FR-PAR-001 (T-B2-02, T-B2-03, TS-48 type history), FR-PAR-006 (T-B2-13), list/detail/positions/acceptances routes.
let app: FastifyInstance
let acme: TestTenant
let gb: string
let my: string
let admin: TestUser
let integrator: TestUser
let compliance: TestUser
let complianceMy: TestUser
let support: TestUser
let supportMy: TestUser
let finance: TestUser
let financeNoStepUp: TestUser
let consultant: TestUser
let globexSupport: TestUser
let jane: string
let sponsorRef: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  my = await createMarket(acme.id, 'MY')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  // Mints participants:write keys: holds the session permissions such a key exercises, for all markets (PLAN B2 2.8).
  integrator = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin', 'Support agent'], stepUp: true })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  complianceMy = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], marketIds: [my], stepUp: true })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  supportMy = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], marketIds: [my] })
  finance = await createSignedInUser({ tenantId: acme.id, roles: ['Finance approver'], stepUp: true })
  financeNoStepUp = await createSignedInUser({ tenantId: acme.id, roles: ['Finance approver'] })
  consultant = await createSignedInUser({ tenantId: acme.id, roles: ['Implementation consultant'] })
  globexSupport = await createSignedInUser({ tenantId: globex.id, roles: ['Support agent'] })
  app = await buildTestApp({ modules: [iamModule, parModule] })
  await activeType(app, admin, compliance, 'DIST', DISTRIBUTOR)
  await activeType(app, admin, compliance, 'CUST', CUSTOMER)
  sponsorRef = (await enrolled(app, support, enrolment('DIST'))).position!.position_ref
  jane = (await enrolled(app, support, enrolment('CUST', {
    display_name: 'Jane Customer', contact: { email: 'jane@example.com', phone: '+44 20 7946 0123', address: '1 High Street, London' },
  }))).participant.id
})

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const post = (as: TestUser, url: string, body: unknown) => call(app, { method: 'POST', url, as, body, idempotencyKey: true })

describe('GET /v1/participants and /:id (T-B2-03, AC-PAR1-3)', () => {
  test('list: exact reference or similar name, market and type filters, market scope; another tenant sees nothing', async () => {
    const byName = await get(support, '/v1/participants?q=Jane%20Customr')
    const byType = await get(support, '/v1/participants?type_code=CUST')
    const scoped = await get(supportMy, '/v1/participants')
    const paged = await get(support, '/v1/participants?limit=1')

    expect(byName.json().data).toEqual([expect.objectContaining({
      id: jane, display_name: 'Jane Customer', market: { id: gb, code: 'GB' }, current_type: { code: 'CUST', name: 'CUST' },
      status: 'active', positions: { count: 0, active: 0 },
    })])
    expect(byType.json().data.map((p: { id: string }) => p.id)).toEqual([jane])
    expect(scoped.json().data).toEqual([])
    expect(paged.json().meta.next_cursor).toEqual(expect.any(String))
    expect((await get(globexSupport, '/v1/participants')).json().data).toEqual([])
    expect((await get(consultant, '/v1/participants')).statusCode).toBe(403)
    expect((await get(support, '/v1/participants?limit=0')).statusCode).toBe(400)
  })

  test('detail masks contact; another tenant or market gets 404', async () => {
    const detail = await get(support, `/v1/participants/${jane}`)

    expect(detail.json().data).toMatchObject({
      id: jane, account_type: 'individual', contact_masked: { email: 'j•••@e•••.com', phone: '•••• 0123', address: '•••' },
      types: [{ type: { code: 'CUST' }, valid_to: null }], agreements: [], positions: [], duplicate_hold: false, merged_into: null,
    })
    expect(detail.body).not.toMatch(/jane@|7946|High Street/)
    expect((await get(globexSupport, `/v1/participants/${jane}`)).statusCode).toBe(404)
    expect((await get(supportMy, `/v1/participants/${jane}`)).statusCode).toBe(404)
  })

  test('unmask needs participant.unmask and a fresh second factor; the audit names fields only', async () => {
    const body = { fields: ['email', 'phone'] }
    const denied = await call(app, { method: 'POST', url: `/v1/participants/${jane}/unmask`, as: support, body })
    const stale = await call(app, { method: 'POST', url: `/v1/participants/${jane}/unmask`, as: financeNoStepUp, body })
    const shown = await call(app, { method: 'POST', url: `/v1/participants/${jane}/unmask`, as: finance, body })
    const invalid = await call(app, { method: 'POST', url: `/v1/participants/${jane}/unmask`, as: finance, body: { fields: [] } })

    expect(denied.statusCode).toBe(403)
    expect(stale.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(shown.json().data).toEqual({ contact: { email: 'jane@example.com', phone: '+44 20 7946 0123' } })
    expect(invalid.statusCode).toBe(400)
    const audit = await ownerRows<{ after_ref: string }>(`SELECT after_ref FROM audit.audit_event WHERE action = 'PARTICIPANT.UNMASKED' AND object_id = $1`, [jane])
    expect(audit.map((row) => JSON.parse(row.after_ref).after)).toEqual([{ participant_id: jane, fields: ['email', 'phone'] }])
    expect(audit[0]!.after_ref).not.toMatch(/jane@|7946/)
  })
})

describe('POST /v1/participants/:id/contact-email (BUG-133)', () => {
  test('records an e-mail for a member without one (step-up), then another user invites (never the recorder); one on record is 409', async () => {
    const email = `migrated-${Date.now()}@example.test`
    const memberId = (await enrolled(app, support, enrolment('DIST'))).participant.id
    const record = (as: TestUser, id = memberId, body: Record<string, unknown> = { email, reason: 'Member called in' }) =>
      call(app, { method: 'POST', url: `/v1/participants/${id}/contact-email`, as, idempotencyKey: true, body })
    const stepped = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], stepUp: true })

    expect((await record(support)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await record(finance)).statusCode).toBe(403)
    const outOfScope = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], marketIds: [my], stepUp: true })
    expect((await record(outOfScope)).statusCode).toBe(404)
    expect((await record(stepped, memberId, { email: 'not-an-email', reason: 'x' })).statusCode).toBe(400)
    const recorded = await record(stepped)
    expect(recorded.statusCode, recorded.body).toBe(200)
    expect(recorded.json().data).toEqual({ contact_masked: { email: 'm•••@e•••.test' } })
    expect((await record(stepped, memberId, { email: 'other@example.test', reason: 'again' })).json().error.code).toBe('CONTACT_EMAIL_RECORDED')
    expect((await record(stepped, jane)).json().error.code).toBe('CONTACT_EMAIL_RECORDED')
    const audit = await ownerRows(`SELECT * FROM audit.audit_event WHERE tenant_id = $1 AND action = 'PARTICIPANT.CONTACT_RECORDED'`, [acme.id])
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit)).not.toContain(email)

    // Two people: the recorder never also invites to the address they recorded (else one agent takes over the account).
    const invite = (as: TestUser) => call(app, { method: 'POST', url: `/v1/participants/${memberId}/portal-account`, as, idempotencyKey: true })
    const byRecorder = await invite(stepped)
    expect(byRecorder.statusCode).toBe(422)
    expect(byRecorder.json().error.code).toBe('SOD_SELF_APPROVAL')
    const invited = await invite(support)
    expect(invited.statusCode, invited.body).toBe(201)
  })

  test('the user who enrolled a member with an e-mail never also invites to it; a colleague does', async () => {
    const memberId = (await enrolled(app, support, enrolment('DIST', { contact: { email: `own-${Date.now()}@example.test` } }))).participant.id
    const invite = (as: TestUser) => call(app, { method: 'POST', url: `/v1/participants/${memberId}/portal-account`, as, idempotencyKey: true })
    const colleague = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })

    const byEnroller = await invite(support)
    expect(byEnroller.statusCode).toBe(422)
    expect(byEnroller.json().error.code).toBe('SOD_SELF_APPROVAL')
    const invited = await invite(colleague)
    expect(invited.statusCode, invited.body).toBe(201)
  })
})

describe('POST /v1/participants/:id/type (T-B2-02, TS-48 history part, AC-PAR1-2)', () => {
  test('closes the open type at T and opens the new one at T; the timeline never overlaps', async () => {
    const customer = (await enrolled(app, support, enrolment('CUST'))).participant.id
    const at = new Date(Date.now() + 86_400_000).toISOString()
    const changed = await post(support, `/v1/participants/${customer}/type`, { type_code: 'DIST', valid_from: at, reason: 'upgraded' })
    const rows = await ownerRows<{ valid_from: Date; valid_to: Date | null }>(
      'SELECT valid_from, valid_to FROM participant_type_assignment WHERE participant_id = $1 ORDER BY valid_from', [customer],
    )
    const overlap = ownerRows(
      `INSERT INTO participant_type_assignment (tenant_id, participant_id, type_id, valid_from, created_by, created_by_type)
       SELECT tenant_id, participant_id, type_id, valid_from, created_by, created_by_type FROM participant_type_assignment
       WHERE participant_id = $1 LIMIT 1`, [customer],
    ).then(() => null, (error: unknown) => error)

    expect(changed.statusCode).toBe(200)
    expect(changed.json().data.types.map((t: { type: { code: string } }) => t.type.code)).toEqual(['CUST', 'DIST'])
    expect(rows[0]!.valid_to!.toISOString()).toBe(at)
    expect(rows[1]).toMatchObject({ valid_to: null })
    expect(rows[1]!.valid_from.toISOString()).toBe(at)
    expect(await overlap).toMatchObject({ code: '23P01' })
  })

  test('refusals: unchanged, past, inactive type, positions held by a type that cannot hold them; scope and tenant', async () => {
    const distributor = (await enrolled(app, support, enrolment('DIST'))).participant.id
    const results = [
      await post(support, `/v1/participants/${distributor}/type`, { type_code: 'DIST', reason: 'x' }),
      await post(support, `/v1/participants/${jane}/type`, { type_code: 'DIST', valid_from: '2020-01-01T00:00:00Z', reason: 'x' }),
      await post(support, `/v1/participants/${jane}/type`, { type_code: 'NOPE', reason: 'x' }),
      await post(support, `/v1/participants/${distributor}/type`, { type_code: 'CUST', reason: 'x' }),
    ]

    expect(results.map((r) => r.json().error.code)).toEqual(['TYPE_UNCHANGED', 'VALID_FROM_INVALID', 'TYPE_NOT_ACTIVE', 'TYPE_CONFLICTS_WITH_POSITIONS'])
    expect((await post(supportMy, `/v1/participants/${jane}/type`, { type_code: 'DIST', reason: 'x' })).statusCode).toBe(404)
    expect((await post(globexSupport, `/v1/participants/${jane}/type`, { type_code: 'DIST', reason: 'x' })).statusCode).toBe(404)
    expect((await post(finance, `/v1/participants/${jane}/type`, { type_code: 'DIST', reason: 'x' })).statusCode).toBe(403)
    expect((await post(support, `/v1/participants/${jane}/type`, { type_code: 'DIST' })).statusCode).toBe(400)
  })
})

describe('POST /v1/participants/:id/positions (T-B2-04 multi-position)', () => {
  test('a second position under a sponsor, by session and by key; a type that cannot hold positions is refused', async () => {
    const owner = (await enrolled(app, support, enrolment('DIST'))).participant.id
    const token = await apiKey(app, integrator, ['participants:write'])

    const bySession = await post(support, `/v1/participants/${owner}/positions`, { sponsor: { position_ref: sponsorRef } })
    const byKey = await keyCall(app, token, 'POST', `/v1/participants/${owner}/positions`, { position_ref: 'SECOND-KEY' })
    const customer = await post(support, `/v1/participants/${jane}/positions`, {})

    expect(bySession.statusCode).toBe(201)
    expect(bySession.json().data).toMatchObject({ position: { status: 'active' }, placement: null })
    expect(byKey.json().data.position).toMatchObject({ position_ref: 'SECOND-KEY', status: 'active' })
    expect(customer.json().error.code).toBe('TYPE_CANNOT_HOLD_POSITIONS')
    expect((await get(support, `/v1/participants/${owner}`)).json().data.positions).toHaveLength(3)
    expect((await post(globexSupport, `/v1/participants/${owner}/positions`, {})).statusCode).toBe(404)
    expect((await post(consultant, `/v1/participants/${owner}/positions`, {})).statusCode).toBe(403)
    expect((await post(support, `/v1/participants/${owner}/positions`, { brand_id: 'x' })).statusCode).toBe(400)
  })
})

describe('agreement versions and acceptances (T-B2-13, AC-PAR6-1, AC-PAR6-2)', () => {
  test('publish needs the publisher\'s own agreement document; labels are unique per market; scope and permission', async () => {
    const evidence = await ownerRows<{ id: string }>(
      `INSERT INTO document (tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, created_by)
       VALUES ($1, 'evidence', 'documents/x', sha256('e'), 'application/pdf', 1, $2, 1, $2) RETURNING id`, [acme.id, compliance.id],
    )
    const publish = (as: TestUser, body: Record<string, unknown>) => post(as, '/v1/agreement-versions', { market_id: gb, label: 'GB-1', acceptance_required: true, ...body })

    const wrongClass = await publish(compliance, { document_id: evidence[0]!.id })
    const notMine = await publish(compliance, { document_id: await agreementDocument(acme.id, admin.id) })
    const published = await publish(compliance, { document_id: await agreementDocument(acme.id, compliance.id) })
    const sameLabel = await publish(compliance, { document_id: await agreementDocument(acme.id, compliance.id) })
    const outOfScope = await publish(complianceMy, { document_id: await agreementDocument(acme.id, complianceMy.id), label: 'GB-2' })

    expect(wrongClass.json().error.code).toBe('DOCUMENT_NOT_FOUND')
    expect(notMine.json().error.code).toBe('DOCUMENT_NOT_FOUND')
    expect(published.statusCode).toBe(201)
    expect(published.json().data).toMatchObject({ market: { id: gb, code: 'GB' }, label: 'GB-1', current: true, published_by: { id: compliance.id } })
    expect(sameLabel.json().error.code).toBe('VERSION_LABEL_TAKEN')
    expect(outOfScope.json().error.code).toBe('MARKET_UNKNOWN')
    expect((await publish(support, { document_id: await agreementDocument(acme.id, support.id) })).statusCode).toBe(403)
    expect((await publish(compliance, { document_id: 'x' })).statusCode).toBe(400)
  })

  test('acceptances of the current version only, once; the list counts accepted and not yet accepted participants', async () => {
    const old = await publishAgreement(app, compliance, gb, 'GB-OLD')
    const current = await publishAgreement(app, compliance, gb, 'GB-CUR')
    const accept = (versionId: string) => post(support, `/v1/participants/${jane}/agreement-acceptances`, { agreement_version_id: versionId, accepted_at: new Date().toISOString() })

    const notCurrent = await accept(old)
    const accepted = await accept(current)
    const twice = await accept(current)
    const future = await post(support, `/v1/participants/${jane}/agreement-acceptances`, { agreement_version_id: current, accepted_at: '2999-01-01T00:00:00Z' })
    const beforePublication = await post(support, `/v1/participants/${jane}/agreement-acceptances`, { agreement_version_id: current, accepted_at: '2001-01-01T00:00:00Z' })
    const list = await get(support, `/v1/agreement-versions?market_id=${gb}`)
    const participants = (await ownerRows<{ n: number }>(`SELECT count(*)::int AS n FROM participant WHERE market_id = $1 AND status = 'active'`, [gb]))[0]!.n

    expect(notCurrent.json().error.code).toBe('AGREEMENT_VERSION_NOT_CURRENT')
    expect(accepted.statusCode).toBe(201)
    expect(accepted.json().data).toMatchObject({ agreement_version_id: current })
    expect(twice.json().error.code).toBe('ALREADY_ACCEPTED')
    expect(future.json().error.code).toBe('ACCEPTED_AT_INVALID')
    expect(beforePublication.json().error.code).toBe('ACCEPTED_AT_INVALID')
    const row = list.json().data.find((v: { id: string }) => v.id === current)
    expect(row).toMatchObject({ current: true, acceptances: { accepted: 1, not_accepted: participants - 1 } })
    expect(list.json().data.find((v: { id: string }) => v.id === old)).toMatchObject({ current: false, acceptances: { accepted: 0 } })
    expect((await get(support, `/v1/participants/${jane}`)).json().data.agreements).toEqual([expect.objectContaining({ version: { id: current, label: 'GB-CUR' } })])
    expect((await get(supportMy, '/v1/agreement-versions')).json().data).toEqual([])
    expect((await get(globexSupport, '/v1/agreement-versions')).json().data).toEqual([])
    expect((await get(consultant, '/v1/agreement-versions')).statusCode).toBe(403)
  })
})
