import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, testConfig,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { recordAudit } from '../../lib/audit.js'
import { runInTenant, SYSTEM_ACTOR_ID } from '../../lib/db.js'
import { verifyTenantChainJob } from './verify.js'

let app: FastifyInstance
let acme: TestTenant
let officer: TestUser
let otherOfficer: TestUser
let admin: TestUser
let analyst: TestUser
let globexOfficer: TestUser

closePoolsAfterAll()

async function seedEvents(tenantId: string, userId: string): Promise<void> {
  await withTenant({ tenantId, userId }, async (tx) => {
    await recordAudit(tx, { action: 'TEST.ALPHA', objectType: 'widget', objectId: userId, after: { n: 1 } })
    await recordAudit(tx, { action: 'TEST.BETA', objectType: 'widget', before: { n: 1 }, after: { n: 2 }, reason: '=HYPERLINK("x")' })
    await recordAudit(tx, { action: 'TEST.ALPHA', objectType: 'gadget' })
  })
}

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  officer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  otherOfficer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexOfficer = await createSignedInUser({ tenantId: globex.id, roles: ['Compliance officer'] })
  await seedEvents(acme.id, officer.id)
  await seedEvents(globex.id, globexOfficer.id)
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

const exportAudit = (as: TestUser, filters: Record<string, unknown>, target: FastifyInstance = app) =>
  call(target, { method: 'POST', url: '/v1/audit-exports', as, body: { filters }, idempotencyKey: true })

describe('GET /v1/audit-events', () => {
  test('newest first, filtered, decoded, paginated by cursor', async () => {
    const page1 = await call(app, { method: 'GET', url: '/v1/audit-events?action=TEST.ALPHA&limit=1', as: officer })
    const page2 = await call(app, { method: 'GET', url: `/v1/audit-events?action=TEST.ALPHA&limit=1&cursor=${page1.json().meta.next_cursor}`, as: officer })
    const beta = await call(app, { method: 'GET', url: '/v1/audit-events?action=TEST.BETA', as: officer })

    expect(page1.json().data[0]).toMatchObject({ action: 'TEST.ALPHA', object_type: 'gadget', actor_id: officer.id, actor_type: 'user' })
    expect(page2.json().data[0]).toMatchObject({ action: 'TEST.ALPHA', object_type: 'widget', after: { n: 1 } })
    expect(page2.json().meta.next_cursor).toBeNull()
    expect(beta.json().data[0]).toMatchObject({ before: { n: 1 }, after: { n: 2 }, reason: '=HYPERLINK("x")' })
    expect(beta.json().data[0].hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('filters by actor, object and time range', async () => {
    const byActor = await call(app, { method: 'GET', url: `/v1/audit-events?actor_id=${officer.id}&object_id=${officer.id}`, as: admin })
    const future = await call(app, { method: 'GET', url: '/v1/audit-events?from=2999-01-01T00:00:00Z', as: admin })

    expect(byActor.json().data.map((event: { action: string }) => event.action)).toEqual(['TEST.ALPHA'])
    expect(future.json().data).toEqual([])
  })

  test('another tenant sees only its own events; an invalid cursor is 400', async () => {
    const foreign = await call(app, { method: 'GET', url: `/v1/audit-events?actor_id=${officer.id}`, as: globexOfficer })
    const badCursor = await call(app, { method: 'GET', url: '/v1/audit-events?cursor=not-a-cursor', as: officer })

    expect(foreign.json().data).toEqual([])
    expect(badCursor.json().error.code).toBe('INVALID_CURSOR')
  })

  test('needs audit.read', async () => {
    expect((await call(app, { method: 'GET', url: '/v1/audit-events', as: analyst })).statusCode).toBe(403)
  })
})

describe('POST /v1/audit-exports and download (FR-AUD-002)', () => {
  test('within the cap: export_job in the tenant region, audit with filters and row count, watermarked CSV', async () => {
    const created = await exportAudit(officer, { action: 'TEST.BETA' })
    const exportId: string = created.json().data.id
    const csv = await call(app, { method: 'GET', url: `/v1/audit-exports/${exportId}/download`, as: officer })
    const [event] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'EXPORT.CREATED'`,
      [acme.id],
    )
    const lines = csv.body.trim().split('\r\n')

    expect(created.statusCode).toBe(201)
    expect(created.json().data).toMatchObject({ kind: 'audit_events', row_count: '1', destination: 'eu', download: `/v1/audit-exports/${exportId}/download` })
    expect(JSON.parse(event!.after_ref).after).toMatchObject({ kind: 'audit_events', row_count: 1, filters: { action: 'TEST.BETA' } })
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(csv.headers['content-disposition']).toBe(`attachment; filename="audit-export-${exportId}.csv"`)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`) // formula neutralised
    expect(lines[1]).toContain(`export ${exportId} for user ${officer.id}`)
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['EXPORT.CREATED', 'EXPORT.DOWNLOADED']))
  })

  test('above the cap: refused with a path to a scheduled export, and the refusal is audited', async () => {
    const capped = await buildTestApp({ env: { EXPORT_ROW_CAP: '1' } })
    try {
      const response = await exportAudit(officer, { action: 'TEST.ALPHA' }, capped)

      expect(response.statusCode).toBe(422)
      expect(response.json().error).toMatchObject({ code: 'EXPORT_ROW_CAP_EXCEEDED', details: { row_count: 2, row_cap: 1 } })
      expect(await auditActions(acme.id)).toContain('EXPORT.REFUSED')
    } finally {
      await capped.close()
    }
  })

  test('only the requester downloads an export; another tenant gets 404', async () => {
    const exportId: string = (await exportAudit(officer, {})).json().data.id

    const colleague = await call(app, { method: 'GET', url: `/v1/audit-exports/${exportId}/download`, as: otherOfficer })
    const foreign = await call(app, { method: 'GET', url: `/v1/audit-exports/${exportId}/download`, as: globexOfficer })

    expect(colleague.statusCode).toBe(404)
    expect(foreign.statusCode).toBe(404)
  })

  test('needs audit.read and export: a Tenant admin may search but not export', async () => {
    const exportId: string = (await exportAudit(officer, {})).json().data.id

    expect((await exportAudit(admin, {})).statusCode).toBe(403)
    expect((await call(app, { method: 'GET', url: `/v1/audit-exports/${exportId}/download`, as: admin })).statusCode).toBe(403)
  })
})

describe('chain verification (AC-54.2, TS-56)', () => {
  test('reports intact, then the first altered event after tampering', async () => {
    const tenant = await createTenant()
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Compliance officer'] })
    await seedEvents(tenant.id, user.id)

    const intact = await call(app, { method: 'GET', url: '/v1/audit-chain/verification', as: user })
    await ownerRows(`ALTER TABLE audit.audit_event DISABLE TRIGGER audit_event_no_mutation`)
    await ownerRows(`UPDATE audit.audit_event SET action = 'TEST.FORGED' WHERE tenant_id = $1 AND seq = 2`, [tenant.id])
    await ownerRows(`ALTER TABLE audit.audit_event ENABLE TRIGGER audit_event_no_mutation`)
    const broken = await call(app, { method: 'GET', url: '/v1/audit-chain/verification', as: user })
    const otherTenant = await call(app, { method: 'GET', url: '/v1/audit-chain/verification', as: globexOfficer })

    expect(intact.json().data).toMatchObject({ intact: true, first_broken_seq: null, events: '3' })
    expect(broken.json().data).toMatchObject({ intact: false, first_broken_seq: '2' })
    expect(otherTenant.json().data).toMatchObject({ intact: true, events: '3' }) // verifies its own chain only

    // The daily job raises the alert for the broken tenant.
    const log = { error: () => undefined } as never
    await runInTenant({ tenantId: tenant.id, userId: SYSTEM_ACTOR_ID }, { actorType: 'system', requestId: 'job', supportSessionId: null },
      (tx) => verifyTenantChainJob.run(tx, {}, { jobId: 'job', log, config: testConfig() }))
    const alerts = await ownerRows('SELECT payload FROM outbox_event WHERE tenant_id = $1 AND topic = $2', [tenant.id, 'audit.chain.broken'])

    expect(alerts).toEqual([{ payload: { first_broken_seq: '2' } }])
  })

  test('needs audit.read', async () => {
    expect((await call(app, { method: 'GET', url: '/v1/audit-chain/verification', as: analyst })).statusCode).toBe(403)
  })
})

describe('the audit log covers every market: reading and exporting need audit.read for all markets', () => {
  test('a Compliance officer limited to one market cannot search, verify or export', async () => {
    const am = await createMarket(acme.id, 'AM')
    const scopedOfficer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], marketIds: [am] })

    const responses = [
      await call(app, { method: 'GET', url: '/v1/audit-events', as: scopedOfficer }),
      await call(app, { method: 'GET', url: '/v1/audit-chain/verification', as: scopedOfficer }),
      await exportAudit(scopedOfficer, {}),
    ]

    for (const response of responses) {
      expect(response.statusCode).toBe(403)
      expect(response.json().error).toMatchObject({ code: 'SCOPE_NOT_HELD', details: { permission: 'audit.read' } })
    }
    const me = (await call(app, { method: 'GET', url: '/v1/me', as: scopedOfficer })).json().data
    expect(me.navigation.map((entry: { key: string }) => entry.key)).not.toContain('audit')
  })
})
