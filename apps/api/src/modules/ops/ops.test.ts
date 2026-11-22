import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, createTenant, invitationToken, mailsTo, ownerRows,
  resetApiDb, runQueuedJobs, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { prvModule } from '../prv/index.js'
import { tenModule } from '../ten/index.js'
import { sendFirstAdminInvitationJob } from './first-admin-invitation.js'
import { opsModule } from './index.js'

const PASSWORD = 'correct horse battery staple'
const METADATA_KEYS = ['created_at', 'dpa_document_id', 'id', 'isolation_tier', 'job_health', 'legal_name', 'region', 'slug', 'state']

let app: FastifyInstance
let creator: TestUser
let approver: TestUser
let approverWithoutStepUp: TestUser
let tenantAdmin: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  creator = await createSignedInUser({ tenantId: null, stepUp: true })
  approver = await createSignedInUser({ tenantId: null, stepUp: true })
  approverWithoutStepUp = await createSignedInUser({ tenantId: null })
  const existing = await createTenant()
  tenantAdmin = await createSignedInUser({ tenantId: existing.id, roles: ['Tenant admin'], stepUp: true })
  app = await buildTestApp({ modules: [iamModule, tenModule, prvModule, opsModule] })
})

afterAll(async () => {
  await app.close()
})

function tenantBody(overrides: Record<string, unknown> = {}) {
  const suffix = randomUUID().slice(0, 8)
  return {
    legal_name: 'Acme Wellness Ltd', slug: `acme-${suffix}`, region: 'eu', isolation_tier: 'pooled', dpa_document_id: randomUUID(),
    markets: [
      { code: 'GB', currency: 'GBP', minor_unit: 2, time_zone: 'Europe/London', languages: ['en'], market_pack: 'none' },
      { code: 'MY', currency: 'MYR', minor_unit: 2, time_zone: 'Asia/Kuala_Lumpur', languages: ['ms', 'en'], market_pack: 'none' },
    ],
    first_admin: { email: `Admin-${suffix}@Acme.test`, display_name: 'Ada Admin' },
    ...overrides,
  }
}

const create = (body: Record<string, unknown>, as: TestUser = creator, idempotencyKey: true | string = true) =>
  call(app, { method: 'POST', url: '/v1/tenants', as, body, idempotencyKey })
const approve = (id: string, as: TestUser = approver, idempotencyKey: true | string = true) =>
  call(app, { method: 'POST', url: `/v1/tenants/${id}/approve`, as, idempotencyKey })
const goLive = (id: string, as: TestUser = creator) => call(app, { method: 'POST', url: `/v1/tenants/${id}/go-live`, as })
const vendorActions = async (objectId: string) =>
  (await ownerRows<{ action: string }>('SELECT action FROM audit.vendor_event WHERE object_id = $1 ORDER BY seq', [objectId]))
    .map((row) => row.action)

async function created(body = tenantBody()): Promise<{ id: string; email: string; slug: string }> {
  const response = await create(body)
  expect(response.statusCode).toBe(201)
  return { id: response.json().data.id, email: body.first_admin.email.toLowerCase(), slug: body.slug }
}

describe('POST /v1/tenants (FR-TEN-001 provisioning)', () => {
  test('creates the tenant in provisioning with routing, markets and an invited first admin, in both logs', async () => {
    const body = tenantBody()

    const response = await create(body)
    const tenant = response.json().data
    const [admin] = await ownerRows<{ id: string; email: string; state: string; grants: number }>(
      `SELECT u.id, u.email, u.state, count(ra.id)::int AS grants FROM user_account u
       LEFT JOIN role_assignment ra ON ra.user_id = u.id WHERE u.tenant_id = $1 GROUP BY u.id`,
      [tenant.id],
    )

    expect(response.statusCode).toBe(201)
    expect(tenant).toMatchObject({
      slug: body.slug, region: 'eu', isolation_tier: 'pooled', state: 'provisioning', dpa_document_id: body.dpa_document_id,
      job_health: { queued: 0, running: 0, failed: 0 },
    })
    expect(tenant.markets.map((market: { code: string; state: string }) => [market.code, market.state])).toEqual([['GB', 'draft'], ['MY', 'draft']])
    // The Tenant admin grant waits for the second person (the provisioning approval).
    expect(admin).toMatchObject({ email: body.first_admin.email.toLowerCase(), state: 'invited', grants: 0 })
    expect((await ownerRows('SELECT db_route, created_by FROM tenant WHERE id = $1', [tenant.id]))[0]).toEqual({ db_route: 'pooled', created_by: creator.id })
    expect(await vendorActions(tenant.id)).toEqual(['TENANT.CREATED'])
    expect(await auditActions(tenant.id)).toEqual(['TENANT.CREATED', 'USER.INVITED'])
    expect(await mailsTo(admin!.email)).toEqual([])
  })

  test('replays the same request under the same key; another request under it is refused; the key is required', async () => {
    const body = tenantBody()
    const key = randomUUID()

    const first = await create(body, creator, key)
    const again = await create(body, creator, key)
    const different = await create({ ...body, legal_name: 'Other Ltd' }, creator, key)
    const withoutKey = await call(app, { method: 'POST', url: '/v1/tenants', as: creator, body: tenantBody() })

    expect(again.statusCode).toBe(201)
    expect(again.headers['idempotent-replayed']).toBe('true')
    expect(again.json().data.id).toBe(first.json().data.id)
    expect(different.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(withoutKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(await auditActions(first.json().data.id)).toEqual(['TENANT.CREATED', 'USER.INVITED'])
  })

  test('validates region, tier, slug and markets', async () => {
    const taken = await created()

    const region = await create(tenantBody({ region: 'mars-1' }))
    const tier = await create(tenantBody({ isolation_tier: 'dedicated' }))
    const slug = await create(tenantBody({ slug: taken.slug }))
    const duplicateMarket = await create(tenantBody({ markets: [tenantBody().markets[0], tenantBody().markets[0]] }))
    const badZone = await create(tenantBody({ markets: [{ ...tenantBody().markets[0], time_zone: 'Mars/Olympus' }] }))

    expect(region.json().error.code).toBe('REGION_UNAVAILABLE')
    expect(tier.json().error.code).toBe('TIER_NOT_AVAILABLE')
    expect(slug.json().error.code).toBe('SLUG_TAKEN')
    expect([duplicateMarket.statusCode, badZone.statusCode]).toEqual([400, 400])
  })
})

describe('POST /v1/tenants/:id/approve (second-person approval)', () => {
  test('needs a second vendor user with a fresh factor; then the first admin is granted, invited and can sign in', async () => {
    const tenant = await created()
    const key = randomUUID()

    const byCreator = await approve(tenant.id, creator)
    const withoutStepUp = await approve(tenant.id, approverWithoutStepUp)
    const approved = await approve(tenant.id, approver, key)
    const replayed = await approve(tenant.id, approver, key)
    const grants = await ownerRows(
      `SELECT r.name AS role, ra.created_by FROM role_assignment ra JOIN role r ON r.id = ra.role_id WHERE ra.tenant_id = $1`,
      [tenant.id],
    )
    const granted = await ownerRows(
      `SELECT actor_type, actor_id FROM audit.audit_event WHERE tenant_id = $1 AND action = 'ROLE.GRANTED'`, [tenant.id])
    const queued = (await call(app, { method: 'GET', url: `/v1/tenants/${tenant.id}`, as: creator })).json().data.job_health
    const sent = await runQueuedJobs(sendFirstAdminInvitationJob)
    const [mail] = await mailsTo(tenant.email)
    const accepted = await call(app, { method: 'POST', url: '/v1/auth/invitations/accept', body: { token: invitationToken(mail!), password: PASSWORD } })
    const signIn = await call(app, { method: 'POST', url: '/v1/auth/sessions', body: { tenant: tenant.slug, email: tenant.email, password: PASSWORD } })

    expect(mail).toContain(`/invitation?tenant=${tenant.slug}#token=${invitationToken(mail!)}`)
    expect(byCreator.json().error.code).toBe('SOD_SELF_APPROVAL')
    expect(withoutStepUp.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(approved.json().data.state).toBe('implementation')
    expect(replayed.statusCode).toBe(200)
    expect(replayed.headers['idempotent-replayed']).toBe('true')
    expect(replayed.json().data.state).toBe('implementation')
    expect(grants).toEqual([{ role: 'Tenant admin', created_by: approver.id }])
    expect(granted).toEqual([{ actor_type: 'vendor_user', actor_id: approver.id }])
    expect(queued).toEqual({ queued: 1, running: 0, failed: 0 })
    expect(sent).toBe(1)
    expect(accepted.statusCode).toBe(204)
    expect(signIn.json().data.next_step).toBe('mfa_enrolment')
    // BUG-031: the creator's refused self-approval is in the vendor log too.
    expect(await vendorActions(tenant.id)).toEqual(['TENANT.CREATED', 'SECOND_PERSON.REFUSED', 'TENANT.PROVISIONING_APPROVED'])
    expect(await auditActions(tenant.id)).toEqual(expect.arrayContaining(['TENANT.PROVISIONING_APPROVED', 'USER.INVITATION_SENT', 'USER.ACTIVATED']))
    expect((await approve(tenant.id)).json().error.code).toBe('TENANT_STATE_INVALID')
  })

  test('BUG-014: a second admin named at provisioning is granted Tenant admin at approval too, so grants have an approver', async () => {
    const suffix = randomUUID().slice(0, 8)
    const body = tenantBody({ second_admin: { email: `second-${suffix}@acme.test`, display_name: null } })
    const clash = tenantBody()
    const sameEmail = await create({ ...clash, second_admin: { email: clash.first_admin.email.toUpperCase() } })
    const tenant = await created(body)

    await approve(tenant.id)
    const admins = await ownerRows<{ email: string }>(
      `SELECT u.email FROM role_assignment ra JOIN user_account u ON u.id = ra.user_id WHERE ra.tenant_id = $1`,
      [tenant.id],
    )

    expect(sameEmail.statusCode).toBe(400)
    expect(admins.map((row) => row.email).sort()).toEqual([tenant.email, `second-${suffix}@acme.test`].sort())
    expect((await auditActions(tenant.id)).filter((action) => action === 'USER.INVITED')).toHaveLength(2)
  })

  test('takes an Idempotency-Key (TR-API-13); the key of one approval cannot approve another tenant', async () => {
    const [first, second] = [await created(), await created()]
    const key = randomUUID()

    const withoutKey = await call(app, { method: 'POST', url: `/v1/tenants/${first.id}/approve`, as: approver })
    const approved = await approve(first.id, approver, key)
    const reused = await approve(second.id, approver, key)

    expect(withoutKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(approved.statusCode).toBe(200)
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    expect(await ownerRows('SELECT state FROM tenant WHERE id = $1', [second.id])).toEqual([{ state: 'provisioning' }])
  })
})

describe('POST /v1/tenants/:id/go-live', () => {
  test('is blocked until a breach contact is recorded (AC-53.1), then goes live, in both logs', async () => {
    const tenant = await createTenant({ state: 'implementation' })
    const admin = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'], stepUp: true })

    const blocked = await goLive(tenant.id)
    const stateAfterBlock = await ownerRows('SELECT state FROM tenant WHERE id = $1', [tenant.id])
    const contacts = [{ name: 'Dana Privacy', role: 'DPO', email: 'dpo@acme.test', phone: '+44 20 7946 0000' }]
    await call(app, {
      method: 'PUT', url: '/v1/settings/privacy.breach_contacts', as: admin, headers: { 'if-match': '"0"' },
      body: { value: contacts, reason: 'Breach runbook' },
    })
    const live = await goLive(tenant.id)

    expect(blocked.json().error.code).toBe('BREACH_CONTACT_REQUIRED')
    expect(stateAfterBlock).toEqual([{ state: 'implementation' }])
    expect(live.json().data.state).toBe('live')
    expect(await vendorActions(tenant.id)).toEqual(['TENANT.WENT_LIVE'])
    expect((await auditActions(tenant.id)).at(-1)).toBe('TENANT.WENT_LIVE')
    expect((await goLive(tenant.id)).json().error.code).toBe('TENANT_STATE_INVALID')
  })
})

describe('GET /v1/tenants (vendor console, AC-57.1)', () => {
  test('lists operational metadata only, filtered by state, paged by slug', async () => {
    const tenant = await created()

    const page1 = await call(app, { method: 'GET', url: '/v1/tenants?limit=1', as: creator })
    const page2 = await call(app, { method: 'GET', url: `/v1/tenants?limit=1&cursor=${page1.json().meta.next_cursor}`, as: creator })
    const provisioning = await call(app, { method: 'GET', url: '/v1/tenants?state=provisioning&limit=200', as: creator })
    const detail = await call(app, { method: 'GET', url: `/v1/tenants/${tenant.id}`, as: creator })

    expect(Object.keys(page1.json().data[0]).sort()).toEqual(METADATA_KEYS)
    expect(page2.json().data[0].slug > page1.json().data[0].slug).toBe(true)
    expect(provisioning.json().data.map((row: { id: string }) => row.id)).toContain(tenant.id)
    expect(provisioning.json().data.every((row: { state: string }) => row.state === 'provisioning')).toBe(true)
    expect(Object.keys(detail.json().data).sort()).toEqual([...METADATA_KEYS, 'markets', 'offboarding'].sort())
  })

  test('tenant users and unverified vendor users reach no console route; an unknown tenant is 404', async () => {
    const unverified = await createSignedInUser({ tenantId: null, mfa: 'unverified' })
    const tenant = await created()
    const asTenant = [
      await call(app, { method: 'GET', url: '/v1/tenants', as: tenantAdmin }),
      await call(app, { method: 'GET', url: `/v1/tenants/${tenant.id}`, as: tenantAdmin }),
      await create(tenantBody(), tenantAdmin),
      await approve(tenant.id, tenantAdmin),
      await goLive(tenant.id, tenantAdmin),
    ]

    expect(asTenant.map((response) => response.json().error.code)).toEqual(Array(5).fill('REALM_FORBIDDEN'))
    expect((await call(app, { method: 'GET', url: '/v1/tenants', as: unverified })).json().error.code).toBe('MFA_VERIFICATION_REQUIRED')
    expect((await call(app, { method: 'GET', url: `/v1/tenants/${randomUUID()}`, as: creator })).statusCode).toBe(404)
    expect((await approve(randomUUID())).statusCode).toBe(404)
  })
})
