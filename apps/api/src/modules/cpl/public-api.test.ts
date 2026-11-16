import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestTenant,
  type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { cplModule, publicSnapshotSchemas } from './index.js'

let app: FastifyInstance
let acme: TestTenant
let globex: TestTenant
let admin: TestUser
let ieOfficer: TestUser
let payoutOfficer: TestUser
let gbSnapshot: string
let ieSnapshot: string
let globexSnapshot: string

closePoolsAfterAll()

// A ready snapshot written by the owner (the computation itself is covered by snapshots.test.ts), with one figure.
async function snapshot(tenantId: string, marketId: string, createdBy: string): Promise<string> {
  const inputs = { batch_ids: [], mapping_ids: [], mapping_versions: [], reports: ['R1'] }
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO compliance_report_snapshot (tenant_id, market_id, period_from, period_to, method_version, input_refs, state, created_by, inputs_hash)
     VALUES ($1, $2, '2025-01-01', '2025-01-31', 'cpl-method-1.0.0', $3, 'ready', $4, sha256('x')) RETURNING id`,
    [tenantId, marketId, inputs, createdBy],
  )
  await ownerRows(
    `INSERT INTO compliance_figure (tenant_id, snapshot_id, report, period, period_kind, position, key, unit, value_num, numerator, denominator,
       population_count, population, method, method_version)
     VALUES ($1, $2, 'R1', '2025-01-01', 'month', 0, 'customer_share_pct', 'percent', 62.50, 5, 8, 8, 'Orders of the month', 'share', '1')`,
    [tenantId, row!.id],
  )
  return row!.id
}

async function keyFor(as: TestUser): Promise<string> {
  const account = await call(app, { method: 'POST', url: '/v1/service-accounts', as, body: { name: randomUUID(), purpose: 'BI' }, idempotencyKey: true })
  const key = await call(app, {
    method: 'POST', url: `/v1/service-accounts/${account.json().data.id}/keys`, as,
    body: { name: 'BI', scopes: ['compliance:read'], rate_tier: 'standard' }, idempotencyKey: true,
  })
  return key.json().data.token as string
}

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  globex = await createTenant()
  const gb = await createMarket(acme.id, 'GB')
  const ie = await createMarket(acme.id, 'IE')
  const globexGb = await createMarket(globex.id, 'GB')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  ieOfficer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], marketIds: [ie] })
  payoutOfficer = await createSignedInUser({ tenantId: acme.id, roles: ['Payout officer'] })
  const globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  gbSnapshot = await snapshot(acme.id, gb, admin.id)
  ieSnapshot = await snapshot(acme.id, ie, admin.id)
  globexSnapshot = await snapshot(globex.id, globexGb, globexAdmin.id)
  app = await buildTestApp({ modules: [iamModule, cplModule] })
})

afterAll(async () => {
  await app.close()
})

const asKey = (token: string, url: string) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })

describe('AC-22.3 compliance snapshots through an API key', () => {
  test('a key with compliance:read reads every market of its own tenant, nothing of another; each read is audited as its service account', async () => {
    const token = await keyFor(admin)
    const list = await asKey(token, '/v1/compliance/snapshots')
    const detail = await asKey(token, `/v1/compliance/snapshots/${gbSnapshot}`)
    const foreign = await asKey(token, `/v1/compliance/snapshots/${globexSnapshot}`)
    const reads = await ownerRows<{ actor_type: string; actor_id: string; after_ref: string }>(
      `SELECT actor_type, actor_id, after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'API_KEY.READ' ORDER BY seq`, [acme.id],
    )
    const [account] = await ownerRows<{ service_account_id: string; id: string }>(
      'SELECT service_account_id, id FROM api_key WHERE key_prefix = $1', [token.slice(0, 12)],
    )

    expect(list.statusCode).toBe(200)
    expect(list.json().data.map((row: { id: string }) => row.id).sort()).toEqual([gbSnapshot, ieSnapshot].sort())
    expect(detail.json().data).toMatchObject({ id: gbSnapshot, market: { code: 'GB' }, results: [{ report: 'R1', figures: [{ key: 'customer_share_pct', value: '62.50' }] }] })
    expect(detail.json().meta.notice).toContain('not income projections')
    expect(publicSnapshotSchemas.detail.parse(detail.json().data)).toEqual(detail.json().data)
    expect(foreign.statusCode).toBe(404)
    expect(reads).toHaveLength(2)
    expect(reads.every((row) => row.actor_type === 'service_account' && row.actor_id === account!.service_account_id)).toBe(true)
    expect(JSON.parse(reads[0]!.after_ref).after).toEqual({ key_id: account!.id, scope: 'compliance:read', route: 'GET /v1/compliance/snapshots', count: 2 })
    expect(JSON.parse(reads[1]!.after_ref).after).toMatchObject({ route: 'GET /v1/compliance/snapshots/:id', count: 1 })
  })

  test('a key without the scope is refused before anything is read', async () => {
    const token = `nmpk_${randomBytes(32).toString('base64url')}`
    const [account] = await ownerRows<{ id: string }>(
      `INSERT INTO service_account (tenant_id, name, purpose, state, created_by) VALUES ($1, $2, 'Ledger', 'active', $3) RETURNING id`,
      [acme.id, randomUUID(), admin.id],
    )
    await ownerRows(
      `INSERT INTO api_key (tenant_id, service_account_id, name, key_prefix, key_hash, scopes, rate_tier, created_by)
       VALUES ($1, $2, 'Ledger', $3, encode(sha256(convert_to($4, 'UTF8')), 'hex'), '{ledger:export}', 'standard', $5)`,
      [acme.id, account!.id, token.slice(0, 12), token, admin.id],
    )

    const response = await asKey(token, '/v1/compliance/snapshots')
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('SCOPE_MISSING')
    expect(await ownerRows(`SELECT 1 FROM audit.audit_event WHERE actor_id = $1`, [account!.id])).toEqual([])
  })

  test('sessions keep their market scope and permission; drill-down stays session-only', async () => {
    const token = await keyFor(admin)
    const scoped = await call(app, { method: 'GET', url: '/v1/compliance/snapshots', as: ieOfficer, headers: { authorization: `Bearer ${token}` } })

    expect(scoped.json().data.map((row: { id: string }) => row.id)).toEqual([ieSnapshot])
    expect((await call(app, { method: 'GET', url: `/v1/compliance/snapshots/${gbSnapshot}`, as: ieOfficer })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/compliance/snapshots', as: payoutOfficer })).json().error.code).toBe('PERMISSION_DENIED')
    expect((await app.inject({ method: 'GET', url: '/v1/compliance/snapshots' })).statusCode).toBe(401)
    const drill = await asKey(token, `/v1/compliance/snapshots/${gbSnapshot}/figures/${encodeURIComponent('R1.2025-01.customer_share_pct')}/rows`)
    expect(drill.json().error.code).toBe('UNAUTHENTICATED')
  })
})

describe('T-B1-12 GET /v1/market-packs/:pack/rules', () => {
  const pack = `test-pack-${randomUUID().slice(0, 8)}`
  beforeAll(async () => {
    await ownerRows(
      `INSERT INTO guardrail_rule (id, market_pack, title, outcome, predicate, overridable, mandatory, basis, basis_status, source_ref,
         reviewed_by, reviewed_at, effective_from)
       VALUES ('enrolment-only-bonus@2026-01-01', $1, 'Enrolment-only bonus', 'blocked', '{}', false, true, 'Test basis', 'screening',
               'Test fixture', NULL, NULL, '2026-01-01'),
              ('cooling-off@2026-01-01', $1, 'Cooling-off notice', 'warned', '{}', true, false, 'Test basis', 'screening', 'Test fixture',
               NULL, NULL, '2026-01-01')`,
      [pack],
    )
    await ownerRows(
      `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rounding, mandatory, effective_from, basis, basis_status, source_ref,
         reviewed_by, reviewed_at)
       VALUES ('withholding@2026-01-01', $1, 'Withholding', 'withholding', '{}', 'none', true, '2026-01-01', 'Test basis',
               'counsel_confirmed', 'Test fixture', 'Counsel', '2026-02-01')`,
      [pack],
    )
  })

  test('lists the rules in force with basis, status, source and review; counts mandatory rules at screening', async () => {
    const response = await call(app, { method: 'GET', url: `/v1/market-packs/${pack}/rules?on=2026-06-01`, as: admin })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([
      {
        kind: 'guardrail', id: 'cooling-off@2026-01-01', title: 'Cooling-off notice', mandatory: false, basis: 'Test basis',
        basis_status: 'screening', source_ref: 'Test fixture', reviewed_by: null, reviewed_at: null, effective_from: '2026-01-01', effective_to: null,
      },
      expect.objectContaining({ kind: 'guardrail', id: 'enrolment-only-bonus@2026-01-01', mandatory: true, basis_status: 'screening' }),
      expect.objectContaining({ kind: 'tax', id: 'withholding@2026-01-01', basis_status: 'counsel_confirmed', reviewed_by: 'Counsel', reviewed_at: '2026-02-01' }),
    ])
    expect(response.json().meta).toEqual({ on: '2026-06-01', screening_mandatory: 1 })
  })

  test('before the rules take effect the pack is empty; an unknown pack is empty; bad input is refused', async () => {
    const before = await call(app, { method: 'GET', url: `/v1/market-packs/${pack}/rules?on=2025-12-31`, as: admin })
    const unknown = await call(app, { method: 'GET', url: '/v1/market-packs/no-such-pack/rules', as: admin })

    expect(before.json()).toEqual({ data: [], meta: { on: '2025-12-31', screening_mandatory: 0 } })
    expect(unknown.json().data).toEqual([])
    expect((await call(app, { method: 'GET', url: `/v1/market-packs/${'p'.repeat(65)}/rules`, as: admin })).statusCode).toBe(400)
    expect((await call(app, { method: 'GET', url: `/v1/market-packs/${pack}/rules?on=0000-01-01`, as: admin })).json().error.code).toBe('VALIDATION_FAILED')
    expect((await call(app, { method: 'GET', url: `/v1/market-packs/${pack}/rules?on=2026-13-01`, as: admin })).statusCode).toBe(400)
  })

  test('needs market.manage, market.signoff or compliance.read; pack rules are platform data, the same for every tenant', async () => {
    const globexOfficer = await createSignedInUser({ tenantId: globex.id, roles: ['Compliance officer'] })
    const url = `/v1/market-packs/${pack}/rules?on=2026-06-01`

    expect((await call(app, { method: 'GET', url, as: ieOfficer })).json().data).toHaveLength(3)
    expect((await call(app, { method: 'GET', url, as: globexOfficer })).json().data).toHaveLength(3)
    expect((await call(app, { method: 'GET', url, as: payoutOfficer })).json().error.code).toBe('PERMISSION_DENIED')
    expect((await call(app, { method: 'GET', url })).statusCode).toBe(401)
    expect((await asKey(await keyFor(admin), url)).statusCode).toBe(401)
  })
})
