import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestUser,
} from '../../../test/helpers/index.js'
import { genModule } from './index.js'
import { activeType, asUser, committedPeriod, daysAgo, enrol, participant, position, saveSettings } from './test-support.js'

// GET /v1/positions/:id and POST /v1/positions/:id/status (FR-PAR-005, FR-GEN-001, FR-GEN-009): T-B2-11 transition
// matrix, T-B2-12 committed-period guard, TS-64 (reinstatement), TS-02 (structure part), E-GEN-10, AC-PAR5-1..3.
let app: FastifyInstance
let acmeId: string
let gb: string
let my: string
let support: TestUser
let supportMy: TestUser
let compliance: TestUser
let complianceNoStepUp: TestUser
let payoutGb: TestUser
let payoutMy: TestUser
let planAdmin: TestUser
let globexSupport: TestUser
let admin: TestUser
let typeId: string
let root: string

closePoolsAfterAll()

async function holder(ref: string, market = gb, status: 'active' | 'pending' = 'active'): Promise<{ owner: string; position: string }> {
  const owner = await participant(admin, market, typeId, ref)
  const id = status === 'active'
    ? await position(admin, owner, market, `P-${ref}`)
    : await asUser(admin, async (tx) => (await tx.query<{ id: string }>(
      `SELECT gen_create_position($1, $2, NULL, $3, 'pending', $4) AS id`, [owner, market, `P-${ref}`, daysAgo(60)])).rows[0]!.id)
  return { owner, position: id }
}

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  acmeId = acme.id
  const globex = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  my = await createMarket(acme.id, 'MY')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  supportMy = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], marketIds: [my] })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  complianceNoStepUp = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  payoutGb = await createSignedInUser({ tenantId: acme.id, roles: ['Payout officer'], marketIds: [gb] })
  payoutMy = await createSignedInUser({ tenantId: acme.id, roles: ['Payout officer'], marketIds: [my] })
  planAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Plan administrator'] })
  globexSupport = await createSignedInUser({ tenantId: globex.id, roles: ['Support agent'] })
  typeId = await activeType(admin, compliance, 'DIST', { holdsPositions: true, endCustomer: false })
  root = (await holder('R')).position
  app = await buildTestApp({ modules: [genModule] })
})

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, id: string) => call(app, { method: 'GET', url: `/v1/positions/${id}`, as })
const setStatus = (as: TestUser, id: string, status: string, options: { effective_from?: string; key?: string } = {}) =>
  call(app, {
    method: 'POST', url: `/v1/positions/${id}/status`, as, idempotencyKey: options.key ?? true,
    body: { status, effective_from: options.effective_from ?? new Date().toISOString(), reason: 'Requested by the owner' },
  })
const relationshipRows = () => ownerRows('SELECT * FROM relationship WHERE tenant_id = $1 ORDER BY id', [acmeId])

describe('GET /v1/positions/:id', () => {
  test('shows the position, its owners, status history and current parents', async () => {
    const { owner, position: child } = await holder('C')
    await enrol(admin, 'sponsor', child, root)
    await enrol(admin, 'placement', child, root, daysAgo(60), '2')
    const response = await get(support, child)
    expect(response.statusCode).toBe(200)
    const data = response.json().data
    expect(data).toMatchObject({
      id: child, position_ref: 'P-C', market: { id: gb, code: 'GB' }, brand_id: null, status: 'active',
      owner: { participant_id: owner, external_ref: 'C', display_name: 'Name C' },
      ownership: [{ participant: { id: owner, external_ref: 'C' }, valid_to: null, case_id: null }],
      status_history: [{ from_status: null, to_status: 'active', reason: 'Enrolment', case_id: null }],
      parents: { sponsor: { position_id: root, position_ref: 'P-R' }, placement: { position_id: root, position_ref: 'P-R', leg: '2' } },
    })
    expect(data.parents.sponsor).not.toHaveProperty('leg')
  })

  test('genealogy.read (all markets) or participant.read over its market; anything else 403 or 404', async () => {
    const { position: other } = await holder('M1', my)
    expect((await get(payoutGb, root)).statusCode).toBe(200)
    expect((await get(payoutMy, root)).statusCode).toBe(404)
    expect((await get(payoutMy, other)).statusCode).toBe(200)
    expect((await get(supportMy, root)).statusCode).toBe(404) // market-scoped genealogy.read counts as participant.read only
    expect((await get(planAdmin, root)).statusCode).toBe(403)
    expect((await get(globexSupport, root)).statusCode).toBe(404)
    expect((await get(support, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404)
    expect((await get(support, 'P-R')).statusCode).toBe(400)
  })
})

describe('POST /v1/positions/:id/status (FR-PAR-005)', () => {
  test('T-B2-11 transitions, TS-64 reinstatement on the same position, TS-02 relationships untouched', async () => {
    const { position: mid } = await holder('MID')
    const { position: below } = await holder('BELOW')
    await enrol(admin, 'sponsor', mid, root)
    await enrol(admin, 'sponsor', below, mid)
    const before = await relationshipRows()
    const step = async (as: TestUser, status: string, expected: number, code?: string) => {
      const response = await setStatus(as, mid, status)
      expect([response.statusCode, response.json().error?.code]).toEqual([expected, code])
      return response
    }
    await step(support, 'active', 409, 'STATUS_TRANSITION_INVALID')
    await step(support, 'suspended', 200)
    await step(support, 'suspended', 409, 'STATUS_TRANSITION_INVALID')
    await step(support, 'active', 200)
    const terminated = await step(compliance, 'terminated', 200)
    expect(terminated.json().data).toMatchObject({ position: { id: mid, status: 'terminated' }, reassigned_customers: 0 })
    await step(compliance, 'suspended', 409, 'STATUS_TRANSITION_INVALID')
    await step(support, 'active', 403, 'PERMISSION_DENIED') // reinstating reverses a termination: Compliance officer only
    await step(complianceNoStepUp, 'active', 403, 'STEP_UP_REQUIRED')
    const reinstated = await step(compliance, 'active', 200)
    const history = reinstated.json().data.position.status_history
    expect(history.map((row: { to_status: string }) => row.to_status)).toEqual(['active', 'suspended', 'active', 'terminated', 'active'])
    expect(reinstated.json().data.position.id).toBe(mid)
    expect(await relationshipRows()).toEqual(before)
    expect(await auditActions(acmeId)).toEqual(expect.arrayContaining(['POSITION.STATUS_CHANGED']))
  })

  test('a pending position activates or terminates; a duplicate review holds its activation', async () => {
    const pending = await holder('PEND', gb, 'pending')
    expect((await setStatus(support, pending.position, 'suspended')).json().error.code).toBe('STATUS_TRANSITION_INVALID')
    await ownerRows(
      `INSERT INTO case_file (tenant_id, type, subject_type, subject_id, reason_code, state, payload, market_id, opened_by, opened_by_kind)
       VALUES ($1, 'duplicate', 'participant', $2, 'SIGNAL_MATCH', 'open', '{}', $3, NULL, 'system')`,
      [acmeId, pending.owner, gb],
    )
    const held = await setStatus(support, pending.position, 'active')
    expect([held.statusCode, held.json().error.code]).toEqual([409, 'DUPLICATE_HOLD'])
    const other = await holder('PEND2', gb, 'pending')
    expect((await setStatus(support, other.position, 'active')).statusCode).toBe(200)
  })

  test('E-GEN-10: terminating one of three positions leaves the others as they were', async () => {
    const owner = await participant(admin, gb, typeId, 'THREE')
    const positions = [await position(admin, owner, gb), await position(admin, owner, gb), await position(admin, owner, gb)]
    expect((await setStatus(compliance, positions[1]!, 'terminated')).statusCode).toBe(200)
    const states = await Promise.all(positions.map(async (id) => (await get(support, id)).json().data))
    expect(states.map((row) => row.status)).toEqual(['active', 'terminated', 'active'])
    expect(states.map((row) => row.owner.participant_id)).toEqual([owner, owner, owner])
  })

  test('AC-PAR5-3: termination needs participant.terminate with step-up; other changes participant.manage', async () => {
    const { position: target } = await holder('PERM')
    expect((await setStatus(support, target, 'terminated')).json().error.code).toBe('PERMISSION_DENIED')
    expect((await setStatus(complianceNoStepUp, target, 'terminated')).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await setStatus(compliance, target, 'suspended')).json().error.code).toBe('PERMISSION_DENIED')
    expect((await setStatus(supportMy, target, 'suspended')).statusCode).toBe(404)
    expect((await setStatus(globexSupport, target, 'suspended')).statusCode).toBe(404)
    expect((await get(support, target)).json().data.status).toBe('active')
  })

  test('validation: future dates, unknown statuses and a missing Idempotency-Key are refused; a replay changes nothing', async () => {
    const { position: target } = await holder('VAL')
    const future = await setStatus(support, target, 'suspended', { effective_from: daysAgo(-1) })
    expect([future.statusCode, future.json().error.code]).toEqual([422, 'VALIDATION_FAILED'])
    expect((await setStatus(support, target, 'pending')).statusCode).toBe(400)
    const noKey = await call(app, {
      method: 'POST', url: `/v1/positions/${target}/status`, as: support,
      body: { status: 'suspended', effective_from: new Date().toISOString(), reason: 'x' },
    })
    expect(noKey.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    const body = { effective_from: new Date().toISOString(), key: 'status-replay' }
    expect((await setStatus(support, target, 'suspended', body)).statusCode).toBe(200)
    const replay = await setStatus(support, target, 'suspended', body)
    expect([replay.statusCode, replay.headers['idempotent-replayed']]).toEqual([200, 'true'])
    expect((await get(support, target)).json().data.status_history).toHaveLength(2)
  })

  test('T-B2-12, AC-PAR5-1: not effective before the end of the latest committed period of the market', async () => {
    const { position: target } = await holder('PER', my)
    await committedPeriod(acmeId, my, daysAgo(40), daysAgo(10))
    const early = await setStatus(support, target, 'suspended', { effective_from: daysAgo(20) })
    expect([early.statusCode, early.json().error.code]).toEqual([422, 'EFFECTIVE_IN_COMMITTED_PERIOD'])
    expect((await setStatus(support, target, 'suspended', { effective_from: daysAgo(5) })).statusCode).toBe(200)
  })

  test('FR-CRM-002: termination reassigns the customers by the rule, and is refused while no rule is set', async () => {
    const customerType = await activeType(admin, compliance, 'RETAIL', { holdsPositions: false, endCustomer: true })
    const { position: servicer } = await holder('SERV')
    const customer = await participant(admin, gb, customerType, 'CUST')
    await asUser(admin, (tx) => tx.query(`SELECT crm_set_servicer($1, $2, 'enrolment', $3, NULL, NULL)`, [customer, servicer, daysAgo(30)]))
    const refused = await setStatus(compliance, servicer, 'terminated')
    expect([refused.statusCode, refused.json().error.code]).toEqual([422, 'REASSIGNMENT_RULE_NOT_CONFIGURED'])
    await saveSettings(admin, { 'customers.reassignment_rule': { rule: 'company', notice_days: 0 } })
    const done = await setStatus(compliance, servicer, 'terminated')
    expect([done.statusCode, done.json().data.reassigned_customers]).toEqual([200, 1])
    const servicing = await ownerRows('SELECT servicing_position_id FROM customer_servicing WHERE customer_id = $1 AND valid_to IS NULL', [customer])
    expect(servicing).toEqual([{ servicing_position_id: null }])
    expect((await auditActions(acmeId)).slice(-2)).toEqual(['POSITION.STATUS_CHANGED', 'SERVICING.REASSIGNED'])
  })
})
