import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { genModule } from './index.js'
import { activeType, asUser, enrol, participant, position, rebuildNow, saveSettings } from './test-support.js'

// API-13 (FR-GEN-006, D-B2-08): T-B2-19 field matrix, TS-20 (outside the downline = 404 as unknown; aggregates beyond
// the named depth), TS-64 (rule re-parenting rows; a stale model falls back to the system of record and never widens).
let app: FastifyInstance
let acmeId: string
let support: TestUser
let admin: TestUser
let dpo: TestUser
let analystMy: TestUser
let globexSupport: TestUser
const ids: Record<string, string> = {}

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  acmeId = acme.id
  const globex = await createTenant()
  const gb = await createMarket(acme.id, 'GB')
  const my = await createMarket(acme.id, 'MY')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  dpo = await createSignedInUser({ tenantId: acme.id, roles: ['DPO'] })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  analystMy = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'], marketIds: [my] })
  globexSupport = await createSignedInUser({ tenantId: globex.id, roles: ['Support agent'] })
  const typeId = await activeType(admin, dpo, 'DIST', { holdsPositions: true, endCustomer: false })
  const contact = { email: 'lena@example.com', phone: '+44 7700 900123' }
  for (const ref of ['ROOT', 'V', 'O', 'L1', 'L2', 'L3', 'L4']) {
    const owner = await participant(admin, gb, typeId, ref, ref === 'L1' || ref === 'V' ? { contact } : {})
    ids[ref] = await position(admin, owner, gb, `P-${ref}`)
  }
  for (const [child, parent] of [['V', 'ROOT'], ['O', 'ROOT'], ['L1', 'V'], ['L2', 'L1'], ['L3', 'L2'], ['L4', 'L3']] as const) {
    await enrol(admin, 'sponsor', ids[child]!, ids[parent]!)
  }
  await rebuildNow()
  app = await buildTestApp({ modules: [genModule] })
})

afterAll(async () => {
  await app.close()
})

const downline = (target: string, viewer: string, as: TestUser = support, on: FastifyInstance = app) =>
  call(on, { method: 'GET', url: `/v1/positions/${ids[target] ?? target}/downline?viewer=${ids[viewer] ?? viewer}`, as })
const lastAudit = async () => (await ownerRows<{ after_ref: string }>(
  `SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'GENEALOGY.DOWNLINE_VIEWED' ORDER BY seq DESC LIMIT 1`,
  [acmeId],
))[0]!

describe('GET /v1/positions/:id/downline (API-13)', () => {
  test('T-B2-19: the safe default policy shows self, personally sponsored without contact, counts beyond', async () => {
    const response = await downline('V', 'V')
    expect(response.statusCode).toBe(200)
    const { data, meta } = response.json()
    expect(data.node).toEqual({
      position_id: ids.V, depth: 0, display_name: 'Name V', position_ref: 'P-V', status: 'active', enrolled_on: expect.any(String),
      external_ref: 'V', market_code: 'GB', contact_masked: { email: 'l•••@e•••.com', phone: '•••• 0123' },
    })
    expect(data.children).toEqual([
      { position_id: ids.L1, depth: 1, display_name: 'Name L1', position_ref: 'P-L1', status: 'active', enrolled_on: data.node.enrolled_on },
    ])
    expect(data.aggregates).toEqual([{ depth: 2, count: 1 }, { depth: 3, count: 1 }, { depth: 4, count: 1 }])
    expect(data.policy).toEqual({ version_id: null, named_depth: 1, contact_for_personally_sponsored: false, default: true })
    expect(meta.read_model.source).toBe('read_model')
    expect(JSON.parse((await lastAudit()).after_ref).after).toEqual({ viewer: ids.V, target: ids.V, policy_version: null, rows: 2 })
  })

  test('T-B2-19, TS-20: an approved policy names depth 2 with contact; depth 3 is counts only', async () => {
    const policy = { named_depth: 2, contact_for_personally_sponsored: true }
    const versionId = await saveSettings(admin, { 'genealogy.visibility_policy': policy }, { key: 'genealogy.visibility_policy', approver: dpo })
    const first = (await downline('L1', 'V')).json().data
    expect(first.node).toMatchObject({ depth: 1, contact_masked: { email: 'l•••@e•••.com', phone: '•••• 0123' }, enrolled_on: expect.any(String) })
    expect(first.children).toEqual([{ position_id: ids.L2, depth: 2, display_name: 'Name L2', position_ref: 'P-L2', status: 'active' }])
    expect(first.aggregates).toEqual([{ depth: 3, count: 1 }, { depth: 4, count: 1 }])
    expect(first.policy).toEqual({ version_id: versionId, ...policy, default: false })
    expect(JSON.parse((await lastAudit()).after_ref).after).toMatchObject({ policy_version: versionId, rows: 2 })
    const beyond = (await downline('L3', 'V')).json().data
    expect(beyond).toMatchObject({ node: null, children: [], aggregates: [{ depth: 3, count: 1 }, { depth: 4, count: 1 }] })
    expect(JSON.parse((await lastAudit()).after_ref).after.rows).toBe(0)
  })

  test('TS-20: outside the viewer\'s downline is 404 exactly as an unknown id', async () => {
    const unknown = (await downline('00000000-0000-4000-8000-000000000000', 'V')).json().error
    for (const target of ['O', 'ROOT']) {
      const response = await downline(target, 'V')
      expect(response.statusCode).toBe(404)
      const { request_id: _a, ...error } = response.json().error
      const { request_id: _b, ...expected } = unknown
      expect(error).toEqual(expected)
    }
  })

  test('TS-64: rule re-parenting is a dated rule row; the stale model falls back and never widens access', async () => {
    await asUser(admin, (tx) => tx.query(
      `SELECT gen_apply_relationship('sponsor', $1, $2, NULL, now(), 'rule', NULL, 'plan-rule-7')`, [ids.L2, ids.O],
    ))
    expect(await ownerRows(`SELECT event_type, rule_id, parent_position_id FROM relationship WHERE child_position_id = $1 ORDER BY valid_from`,
      [ids.L2])).toEqual([
      { event_type: 'enrolment', rule_id: null, parent_position_id: ids.L1 },
      { event_type: 'rule', rule_id: 'plan-rule-7', parent_position_id: ids.O },
    ])
    const moved = await downline('L2', 'V')
    expect(moved.statusCode).toBe(404) // the stale model still has L2 under V
    const now = await downline('L2', 'O')
    expect([now.statusCode, now.json().meta.read_model.source, now.json().data.node.depth]).toEqual([200, 'system_of_record', 1])
  })

  test('the stale walk stops at GENEALOGY_FALLBACK_MAX_DEPTH and denies', async () => {
    const shallow = await buildTestApp({ modules: [genModule], env: { GENEALOGY_FALLBACK_MAX_DEPTH: '1' } })
    try {
      expect((await downline('L1', 'ROOT', support, shallow)).statusCode).toBe(404)
      expect((await downline('V', 'ROOT', support, shallow)).statusCode).toBe(200)
      expect((await downline('L1', 'ROOT')).statusCode).toBe(200)
    } finally {
      await shallow.close()
    }
  })

  test('needs genealogy.read for all markets and a viewer; another tenant\'s positions are unknown', async () => {
    expect((await downline('V', 'V', admin)).statusCode).toBe(403)
    expect((await downline('V', 'V', analystMy)).json().error.code).toBe('SCOPE_NOT_HELD')
    expect((await downline('V', 'V', globexSupport)).statusCode).toBe(404)
    const noViewer = await call(app, { method: 'GET', url: `/v1/positions/${ids.V}/downline`, as: support })
    expect(noViewer.statusCode).toBe(400)
  })
})
