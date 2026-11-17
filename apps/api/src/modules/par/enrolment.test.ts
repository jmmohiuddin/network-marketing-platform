import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { parModule } from './index.js'
import {
  activeType, apiKey, committedPeriod, CUSTOMER, DISTRIBUTOR, enrolled, enrolment, enrolRequest, publishAgreement, setSettings,
} from './test-support.js'

// FR-PAR-002: T-B2-04 happy paths, T-B2-05 refusals, T-B2-06 concurrent slot, T-B2-07 key callers, AC-42.1, AC-42.2.
let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let gb: string
let my: string
let admin: TestUser
let compliance: TestUser
let support: TestUser
let supportMy: TestUser
let analyst: TestUser
let globexAdmin: TestUser
let integrator: TestUser
let globexIntegrator: TestUser
let root: string

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  globex = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  my = await createMarket(acme.id, 'MY')
  await createMarket(globex.id, 'GB')
  await ownerRows(`INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
                   VALUES ($1, 'FR', 'EUR', 2, 'Europe/Paris', '{fr}', 'none', 'draft')`, [acme.id])
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  supportMy = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], marketIds: [my] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'], stepUp: true })
  // Mints participants:write keys: holds the session permissions such a key exercises, for all markets (PLAN B2 2.8).
  integrator = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin', 'Support agent'], stepUp: true })
  globexIntegrator = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin', 'Support agent'], stepUp: true })
  const globexCompliance = await createSignedInUser({ tenantId: globex.id, roles: ['Compliance officer'], stepUp: true })
  app = await buildTestApp({ modules: [iamModule, parModule] })
  await activeType(app, admin, compliance, 'DIST', DISTRIBUTOR)
  await activeType(app, admin, compliance, 'CUST', CUSTOMER)
  await activeType(app, admin, compliance, 'HOLDER', { ...DISTRIBUTOR, can_sponsor: false })
  await activeType(app, admin, compliance, 'LEAD', { ...CUSTOMER, counts_as_end_customer: false })
  await activeType(app, globexAdmin, globexCompliance, 'DIST', DISTRIBUTOR)
  await setSettings(acme.id, admin.id, { 'genealogy.placement_width': 2 })
  root = (await enrolled(app, support, enrolment('DIST', { position_ref: 'ROOT' }))).position!.id
})

afterAll(async () => {
  await app.close()
})

const counts = async () => (await ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM participant WHERE tenant_id = $1', [acme.id]))[0]!.n

describe('POST /v1/participants happy paths (T-B2-04, AC-PAR2-3)', () => {
  test('a distributor under a sponsor and placed on a leg; a replay of the key returns the stored response', async () => {
    const body = enrolment('DIST', { display_name: 'Jane Doe', contact: { email: 'jane@example.com' }, sponsor: { position_ref: 'ROOT' }, placement: { position_ref: 'ROOT', leg: '2' } })
    const first = await enrolRequest(app, body, { as: support, idempotencyKey: 'enrol-replay' })
    const replay = await enrolRequest(app, body, { as: support, idempotencyKey: 'enrol-replay' })
    const data = first.json().data

    expect(first.statusCode).toBe(201)
    expect(data).toMatchObject({
      participant: { external_ref: body.external_ref, status: 'active' }, position: { status: 'active', position_ref: expect.stringMatching(/^P-/) },
      placement: { parent_position_id: root, leg: '2', auto: false }, servicing: null, duplicate_case_id: null,
    })
    expect(replay.json()).toEqual(first.json())
    expect(replay.headers['idempotent-replayed']).toBe('true')
    const relationships = await ownerRows('SELECT kind, parent_position_id, leg, event_type FROM relationship WHERE child_position_id = $1 ORDER BY kind', [data.position.id])
    expect(relationships).toEqual([
      { kind: 'placement', parent_position_id: root, leg: '2', event_type: 'enrolment' },
      { kind: 'sponsor', parent_position_id: root, leg: null, event_type: 'enrolment' },
    ])
    const audit = await ownerRows<{ action: string; after_ref: string }>(
      'SELECT action, after_ref FROM audit.audit_event WHERE tenant_id = $1 AND object_id IN ($2, $3) ORDER BY seq', [acme.id, data.participant.id, data.position.id],
    )
    expect(audit.map((row) => row.action)).toEqual(['GENEALOGY.PLACED', 'POSITION.CREATED', 'PARTICIPANT.ENROLLED'])
    expect(audit.map((row) => row.after_ref).join(' ')).not.toMatch(/Jane|jane@/)
  })

  test('a customer with a sponsor gets no position and the sponsor as servicer (source enrolment)', async () => {
    const data = await enrolled(app, support, enrolment('CUST', { sponsor: { position_ref: 'ROOT' } }))

    expect(data).toMatchObject({ position: null, placement: null, servicing: { position_id: root } })
    expect(await ownerRows('SELECT servicing_position_id, source, valid_to FROM customer_servicing WHERE customer_id = $1', [data.participant.id]))
      .toEqual([{ servicing_position_id: root, source: 'enrolment', valid_to: null }])
  })

  test('auto placement fills the next free leg breadth-first; a placement-only tree root has no sponsor', async () => {
    const auto = await enrolled(app, support, enrolment('DIST', { placement: { auto: true, position_ref: 'ROOT' } }))
    expect(auto.placement).toEqual({ parent_position_id: root, leg: '1', auto: true })
    expect(await ownerRows(`SELECT 1 FROM relationship WHERE child_position_id = $1 AND kind = 'sponsor'`, [auto.position!.id])).toEqual([])
  })
})

describe('refusals store nothing (T-B2-05, AC-PAR1-4, AC-PAR2-1)', () => {
  test('market, type, sponsor, dates, references and placement', async () => {
    const before = await counts()
    const pending = await enrolled(app, support, enrolment('DIST', { position_ref: 'SUSP' }))
    await ownerRows(`UPDATE position SET status = 'suspended' WHERE id = $1`, [pending.position!.id])
    await enrolled(app, support, enrolment('HOLDER', { position_ref: 'NOSPON' }))
    const existing = enrolment('DIST')
    await enrolled(app, support, existing)
    const after = await counts()
    const refusals = [
      enrolment('DIST', {}, 'ZZ'), enrolment('DIST', {}, 'FR'), enrolment('NOPE'),
      enrolment('DIST', { sponsor: { position_ref: 'UNKNOWN' } }), enrolment('DIST', { sponsor: { position_ref: 'SUSP' } }),
      enrolment('DIST', { sponsor: { position_ref: 'NOSPON' } }), enrolment('DIST', { enrolled_at: new Date(Date.now() + 3_600_000).toISOString() }),
      { ...existing }, enrolment('DIST', { position_ref: 'ROOT' }), enrolment('CUST', { position_ref: 'X1' }),
      enrolment('LEAD', { sponsor: { position_ref: 'NOSPON' } }),
    ]
    const codes = []
    for (const body of refusals) codes.push((await enrolRequest(app, body, { as: support })).json().error.code)

    expect(codes).toEqual([
      'MARKET_UNKNOWN', 'MARKET_NOT_LIVE', 'TYPE_NOT_ACTIVE', 'SPONSOR_NOT_FOUND', 'SPONSOR_INACTIVE', 'SPONSOR_NOT_ELIGIBLE',
      'ENROLLED_AT_INVALID', 'PARTICIPANT_EXISTS', 'POSITION_REF_TAKEN', 'TYPE_CANNOT_HOLD_POSITIONS', 'SPONSOR_NOT_APPLICABLE',
    ])
    expect(after - before).toBe(3)
    // A caller scoped to MY learns neither the status nor the type of a GB sponsor position (both GB here).
    const scoped = []
    for (const ref of ['SUSP', 'NOSPON']) scoped.push((await enrolRequest(app, enrolment('DIST', { sponsor: { position_ref: ref } }, 'MY'), { as: supportMy })).json().error)
    expect(scoped).toEqual([expect.objectContaining({ code: 'SPONSOR_NOT_ELIGIBLE' }), expect.objectContaining({ code: 'SPONSOR_NOT_ELIGIBLE' })])
    expect(scoped.map((error) => error.details)).toEqual([null, null])
    expect(await counts()).toBe(after)
  })

  test('enrolled_at before the end of the latest committed period is refused', async () => {
    const tenant = await createTenant()
    const nl = await createMarket(tenant.id, 'NL')
    const tAdmin = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin', 'Support agent'] })
    const tCompliance = await createSignedInUser({ tenantId: tenant.id, roles: ['Compliance officer'], stepUp: true })
    await activeType(app, tAdmin, tCompliance, 'DIST', DISTRIBUTOR)
    await committedPeriod(tenant.id, nl, new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'))

    const early = await enrolRequest(app, enrolment('DIST', { enrolled_at: '2026-01-15T00:00:00Z' }, 'NL'), { as: tAdmin })
    const later = await enrolRequest(app, enrolment('DIST', { enrolled_at: '2026-02-01T00:00:00Z' }, 'NL'), { as: tAdmin })

    expect(early.json().error.code).toBe('ENROLLED_AT_IN_COMMITTED_PERIOD')
    expect(later.statusCode).toBe(201)
  })

  test('a leg without genealogy.placement_width is 422 PLACEMENT_NOT_CONFIGURED; a leg above the width 422', async () => {
    const tenant = await createTenant()
    await createMarket(tenant.id, 'GB')
    const tAdmin = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin', 'Support agent'] })
    const tCompliance = await createSignedInUser({ tenantId: tenant.id, roles: ['Compliance officer'], stepUp: true })
    await activeType(app, tAdmin, tCompliance, 'DIST', DISTRIBUTOR)
    await enrolled(app, tAdmin, enrolment('DIST', { position_ref: 'T-ROOT' }))

    const leg = await enrolRequest(app, enrolment('DIST', { placement: { position_ref: 'T-ROOT', leg: '1' } }), { as: tAdmin })
    const plain = await enrolRequest(app, enrolment('DIST', { placement: { position_ref: 'T-ROOT' } }), { as: tAdmin })
    const wide = await enrolRequest(app, enrolment('DIST', { placement: { position_ref: 'ROOT', leg: '3' } }), { as: support })

    expect(leg.json().error.code).toBe('PLACEMENT_NOT_CONFIGURED')
    expect(plain.statusCode).toBe(201)
    expect(wide.json().error.code).toBe('LEG_OUT_OF_RANGE')
  })
})

describe('agreements at enrolment (AC-42.2, TS-59 part)', () => {
  test('a required current version needs its acceptance: missing 422 and nothing stored; another version 422; with it 201', async () => {
    const older = await publishAgreement(app, compliance, my, 'MY-0', false)
    const version = await publishAgreement(app, compliance, my, 'MY-1')
    const before = await counts()

    const missing = await enrolRequest(app, enrolment('DIST', {}, 'MY'), { as: support })
    const wrong = await enrolRequest(app, enrolment('DIST', { agreement: { version_id: older, accepted_at: new Date().toISOString() } }, 'MY'), { as: support })
    const accepted = await enrolled(app, support, enrolment('DIST', { agreement: { version_id: version, accepted_at: new Date().toISOString(), evidence: { channel: 'web', reference: 'form-1' } } }, 'MY'))

    expect(missing.json().error).toMatchObject({ code: 'AGREEMENT_ACCEPTANCE_REQUIRED', details: { agreement_version_id: version } })
    expect(wrong.json().error.code).toBe('AGREEMENT_VERSION_NOT_CURRENT')
    expect(await counts()).toBe(before + 1)
    expect(await ownerRows('SELECT agreement_version_id, evidence FROM agreement_acceptance WHERE participant_id = $1', [accepted.participant.id]))
      .toEqual([{ agreement_version_id: version, evidence: { channel: 'web', reference: 'form-1' } }])
  })
})

describe('concurrent placement (T-B2-06, AC-42.1, TS-45 slot part)', () => {
  test('two enrolments asking for the same leg: one gets it, the other is placed by the auto rule; both audit the tie-break', async () => {
    const parent = await enrolled(app, support, enrolment('DIST', { position_ref: 'RACE' }))
    const [a, b] = await Promise.all([1, 2].map(() =>
      enrolRequest(app, enrolment('DIST', { placement: { position_ref: 'RACE', leg: '1' } }), { as: support })))
    const placements = [a!.json().data.placement, b!.json().data.placement]

    expect([a!.statusCode, b!.statusCode]).toEqual([201, 201])
    expect(placements.map((p) => `${p.leg}:${p.auto}`).sort()).toEqual(['1:false', '2:true'])
    expect(placements.every((p) => p.parent_position_id === parent.position!.id)).toBe(true)
    const placed = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'GENEALOGY.PLACED' AND after_ref LIKE $2`,
      [acme.id, `%${parent.position!.id}%`],
    )
    expect(placed.map((row) => JSON.parse(row.after_ref).after.rule).sort()).toEqual(['bfs_smallest_leg', null].sort())
  })
})

describe('API keys and permissions (T-B2-07, AC-PAR2-2, OI-2)', () => {
  test('a key with participants:write enrols as its service account: actor pair and audit, no user reference', async () => {
    const token = await apiKey(app, integrator, ['participants:write'])
    const response = await enrolRequest(app, enrolment('DIST', { sponsor: { position_ref: 'ROOT' } }), { token })
    const id = response.json().data.participant.id as string

    expect(response.statusCode).toBe(201)
    const [row] = await ownerRows<{ created_by: string; created_by_type: string }>('SELECT created_by, created_by_type FROM participant WHERE id = $1', [id])
    const [account] = await ownerRows<{ id: string }>('SELECT service_account_id AS id FROM api_key WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1', [acme.id])
    expect(row).toEqual({ created_by: account!.id, created_by_type: 'service_account' })
    expect(await ownerRows(`SELECT DISTINCT actor_type FROM audit.audit_event WHERE object_id = $1`, [id])).toEqual([{ actor_type: 'service_account' }])
  })

  test('a key without the scope is 403 SCOPE_MISSING; sessions need participant.manage over the market; validation 400', async () => {
    const token = await apiKey(app, admin, ['compliance:read'])
    const before = await counts()

    const scopeMissing = await enrolRequest(app, enrolment('DIST'), { token })
    const noPermission = await enrolRequest(app, enrolment('DIST'), { as: analyst })
    const otherMarket = await enrolRequest(app, enrolment('DIST'), { as: supportMy })
    const invalid = await enrolRequest(app, { ...enrolment('DIST'), external_ref: 'has space' }, { as: support })

    expect(scopeMissing.json().error.code).toBe('SCOPE_MISSING')
    expect(noPermission.statusCode).toBe(403)
    expect(otherMarket.json().error.code).toBe('MARKET_UNKNOWN')
    expect(invalid.statusCode).toBe(400)
    expect(await counts()).toBe(before)
  })

  test('another tenant\'s positions are unknown: its key enrols in its own tenant only', async () => {
    const token = await apiKey(app, globexIntegrator, ['participants:write'])
    const sponsor = await enrolRequest(app, enrolment('DIST', { sponsor: { position_ref: 'ROOT' } }), { token })
    const own = await enrolRequest(app, enrolment('DIST'), { token })

    expect(sponsor.json().error.code).toBe('SPONSOR_NOT_FOUND')
    expect(own.statusCode).toBe(201)
    expect(await ownerRows('SELECT tenant_id FROM participant WHERE id = $1', [own.json().data.participant.id])).toEqual([{ tenant_id: globex.id }])
    const fromAcme = await call(app, { method: 'GET', url: `/v1/participants/${own.json().data.participant.id}`, as: support })
    expect(fromAcme.statusCode).toBe(404)
  })
})
