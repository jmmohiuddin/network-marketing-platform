import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestUser,
} from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { genealogyChangeType, changePayload, correctionPayload } from './genealogy-cases.js'
import { genCaseTypes, genModule } from './index.js'
import { transferType } from './transfer-case.js'
import {
  activeType, asUser, committedPeriod, daysAgo, enrol, evidenceDocument, participant, position, saveSettings,
} from './test-support.js'

// Case types genealogy_change, genealogy_correction, transfer (FR-GEN-004, AC-GEN1-2): TS-45 (cycle), TS-61, TS-03
// (flag part), E-GEN-04, T-B2-15, T-B2-18, AC-GEN4-1, AC-GEN4-2.
let app: FastifyInstance
let acmeId: string
let gb: string
let support: TestUser
let compliance: TestUser
let supportAndCompliance: TestUser
let analyst: TestUser
let typeId: string
const ids: Record<string, string> = {}
const owners: Record<string, string> = {}

closePoolsAfterAll()

const today = (): string => new Date().toISOString().slice(0, 10)
const tomorrow = (): string => daysAgo(-1).slice(0, 10)

async function holder(ref: string): Promise<string> {
  owners[ref] = await participant(support, gb, typeId, ref)
  ids[ref] = await position(support, owners[ref]!, gb, `P-${ref}`)
  return ids[ref]!
}

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  acmeId = acme.id
  gb = await createMarket(acme.id, 'GB')
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  supportAndCompliance = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent', 'Compliance officer'], stepUp: true })
  analyst = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  typeId = await activeType(support, compliance, 'DIST', { holdsPositions: true, endCustomer: false })
  for (const ref of ['R', 'A', 'B', 'C', 'D', 'E']) await holder(ref)
  for (const [child, parent] of [['A', 'R'], ['B', 'A'], ['C', 'R'], ['D', 'R'], ['E', 'D']] as const) await enrol(support, 'sponsor', ids[child]!, ids[parent]!)
  app = await buildTestApp({ modules: [createCasModule({ types: genCaseTypes }), genModule] })
})

afterAll(async () => {
  await app.close()
})

const post = (as: TestUser, url: string, body: unknown, idempotencyKey?: true) =>
  call(app, { method: 'POST', url, as, body, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) })

async function openCase(type: string, subject: string, payload: unknown, reason: string, as: TestUser = support): Promise<string> {
  const response = await post(as, '/v1/cases', { type, subject_type: 'position', subject_id: subject, reason_code: reason, payload }, true)
  expect(response.statusCode).toBe(201)
  const id = response.json().data.id as string
  expect((await post(as, `/v1/cases/${id}/evidence`, { document_id: await evidenceDocument(as) }, true)).statusCode).toBe(201)
  return id
}

const submit = (id: string, as: TestUser = support) => post(as, `/v1/cases/${id}/submit`, {})
const decide = (id: string, as: TestUser = compliance) => post(as, `/v1/cases/${id}/decision`, { decision: 'approve', reason: 'Checked' }, true)
const change = (parent: string, effective = today()) => ({ kind: 'sponsor', proposed_parent_position_id: parent, effective_from: effective })
const parentAt = async (child: string, asOf: string) =>
  (await call(app, { method: 'GET', url: `/v1/genealogy/tree?root=${child}&as_of=${asOf}`, as: analyst })).json().data.breadcrumbs.at(-1)?.position_ref
const caseState = async (id: string) => (await ownerRows<{ state: string }>('SELECT state FROM case_file WHERE id = $1', [id]))[0]!.state
const rowsOf = (child: string) => ownerRows('SELECT * FROM relationship WHERE child_position_id = $1 ORDER BY recorded_at, valid_from', [child])

describe('genealogy_change (T-B2-18, AC-GEN4-1)', () => {
  test('submit previews the structural check; the decision applies it, marks the model stale and emits genealogy.changed', async () => {
    const id = await openCase('genealogy_change', ids.C!, change(ids.A!), 'PARTICIPANT_REQUEST', supportAndCompliance)
    const submitted = await submit(id, supportAndCompliance)
    expect(submitted.json().data.effect_preview).toEqual({
      current_parent: { position_id: ids.R, position_ref: 'P-R', leg: null },
      proposed_parent: { position_id: ids.A, position_ref: 'P-A' },
      structural_check: { ok: true }, affected_committed_periods: [],
    })
    expect((await decide(id, supportAndCompliance)).json().error.code).toBe('SOD_SELF_APPROVAL')
    expect((await decide(id, support)).statusCode).toBe(403)
    expect((await decide(id)).statusCode).toBe(200)
    const rows = await rowsOf(ids.C!)
    expect(rows.map((row) => [row.parent_position_id, row.event_type, row.case_id, row.valid_to === null])).toEqual([
      [ids.R, 'enrolment', null, false], [ids.A, 'change', id, true],
    ])
    expect(rows[0]!.valid_to).toEqual(rows[1]!.valid_from)
    const [stale] = await ownerRows<{ stale: boolean }>(`SELECT stale_since IS NOT NULL AS stale FROM path_model WHERE tenant_id = $1 AND kind = 'sponsor'`, [acmeId])
    expect(stale!.stale).toBe(true)
    const [event] = await ownerRows<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox_event WHERE tenant_id = $1 AND topic = 'genealogy.changed' AND key = $2 ORDER BY created_at DESC LIMIT 1`,
      [acmeId, ids.C])
    expect(event!.payload).toMatchObject({ kind: 'sponsor', child_position_id: ids.C, event_type: 'change' })
    expect(await auditActions(acmeId)).toContain('GENEALOGY.CHANGED')
    expect(await parentAt(ids.C!, new Date().toISOString())).toBe('P-A')
  })

  test('TS-45 / AC-02.2: a cycle is refused at create (dry-run), at submit, and at decision (the case stays submitted)', async () => {
    const hookRefusal = asUser(support, (tx) =>
      genealogyChangeType.validateCreate(tx, { type: 'position', id: ids.A! }, changePayload.parse(change(ids.B!)), null))
    await expect(hookRefusal).rejects.toMatchObject({ statusCode: 409, code: 'GEN_CYCLE' })
    const atCreate = await post(support, '/v1/cases', {
      type: 'genealogy_change', subject_type: 'position', subject_id: ids.A, reason_code: 'COMPANY_DECISION', payload: change(ids.B!),
    }, true)
    expect([atCreate.statusCode, atCreate.json().error.code]).toEqual([409, 'GEN_CYCLE'])
    expect(await rowsOf(ids.A!)).toHaveLength(1) // no row written, no scratch case kept
    expect(await ownerRows(`SELECT 1 FROM case_file WHERE subject_id = $1`, [ids.A])).toEqual([])

    const atSubmit = await openCase('genealogy_change', ids.D!, change(ids.B!), 'COMPANY_DECISION')
    await enrol(support, 'sponsor', await holder('F'), ids.R!)
    await asUser(support, (tx) => tx.query(`SELECT gen_apply_relationship('sponsor', $1, $2, NULL, now(), 'rule', NULL, 'test-rule')`, [ids.B, ids.E]))
    const refused = await submit(atSubmit)
    expect([refused.statusCode, refused.json().error.code, await caseState(atSubmit)]).toEqual([409, 'GEN_CYCLE', 'open'])

    const atDecision = await openCase('genealogy_change', ids.F!, change(ids.C!), 'COMPANY_DECISION')
    expect((await submit(atDecision)).statusCode).toBe(200)
    await asUser(support, (tx) => tx.query(`SELECT gen_apply_relationship('sponsor', $1, $2, NULL, now(), 'rule', NULL, 'test-rule')`, [ids.C, ids.F]))
    const late = await decide(atDecision)
    expect([late.statusCode, late.json().error.code, await caseState(atDecision)]).toEqual([409, 'GEN_CYCLE', 'submitted'])
  })

  test('TS-61, E-GEN-04: a future change applies at its date; cancelling it is a correction that supersedes the pending row', async () => {
    const child = await holder('G')
    await enrol(support, 'sponsor', child, ids.R!)
    const original = (await rowsOf(child))[0]!
    const id = await openCase('genealogy_change', child, change(ids.A!, tomorrow()), 'PARTICIPANT_REQUEST')
    expect((await submit(id)).statusCode).toBe(200)
    expect((await decide(id)).statusCode).toBe(200)
    const [closed, pending] = await rowsOf(child)
    expect(closed).toEqual({ ...original, valid_to: pending!.valid_from })
    expect(await parentAt(child, new Date().toISOString())).toBe('P-R')
    expect(await parentAt(child, daysAgo(-2))).toBe('P-A')

    const tooLate = await post(support, '/v1/cases', {
      type: 'genealogy_correction', subject_type: 'position', subject_id: child, reason_code: 'DATA_ENTRY_ERROR',
      payload: { kind: 'sponsor', proposed_parent_position_id: ids.R, valid_from: daysAgo(-3) },
    }, true)
    expect([tooLate.statusCode, tooLate.json().error.code]).toEqual([422, 'VALID_FROM_IN_FUTURE'])
    const cancel = await openCase('genealogy_correction', child,
      { kind: 'sponsor', proposed_parent_position_id: ids.R, valid_from: tomorrow() }, 'DATA_ENTRY_ERROR')
    expect((await submit(cancel)).json().data.effect_preview).toMatchObject({
      current_parent: { position_id: ids.A }, structural_check: { ok: true }, affects_committed_periods: false,
    })
    expect((await decide(cancel)).statusCode).toBe(200)
    expect(await parentAt(child, daysAgo(-2))).toBe('P-R')
    const after = await rowsOf(child)
    expect(after).toHaveLength(3) // nothing deleted
    expect(after.map((row) => [row.event_type, row.superseded_at === null])).toEqual([['enrolment', true], ['change', false], ['correction', true]])
  })

  test('a correction from the start GET /v1/positions/:id reports for a change-made row (microseconds) is accepted', async () => {
    const child = await holder('MICRO')
    await enrol(support, 'sponsor', child, ids.R!)
    const changed = await openCase('genealogy_change', child, change(ids.A!), 'PARTICIPANT_REQUEST')
    expect((await submit(changed)).statusCode).toBe(200)
    expect((await decide(changed)).statusCode).toBe(200)
    const current = (await call(app, { method: 'GET', url: `/v1/positions/${child}`, as: support })).json().data.parents.sponsor
    const [row] = await ownerRows<{ at: string }>(
      `SELECT to_char(valid_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM relationship WHERE case_id = $1`, [changed])
    expect(current).toMatchObject({ position_id: ids.A, valid_from: row!.at })
    await openCase('genealogy_correction', child,
      { kind: 'sponsor', proposed_parent_position_id: ids.C, valid_from: current.valid_from }, 'DATA_ENTRY_ERROR')
  })

  test('payload rules: today or later, legs only for placement and only with a placement width', async () => {
    expect(changePayload.safeParse(change(ids.A!, daysAgo(2).slice(0, 10))).success).toBe(false)
    expect(changePayload.safeParse({ ...change(ids.A!), leg: '1' }).success).toBe(false)
    expect(correctionPayload.safeParse({ kind: 'placement', proposed_parent_position_id: ids.A, valid_from: daysAgo(1), leg: '3' }).success).toBe(true)
    const placed = asUser(support, (tx) => genealogyChangeType.validateCreate(tx, { type: 'position', id: ids.C! },
      changePayload.parse({ kind: 'placement', proposed_parent_position_id: ids.A, effective_from: today(), leg: '1' }), null))
    await expect(placed).rejects.toMatchObject({ statusCode: 422, code: 'PLACEMENT_NOT_CONFIGURED' })
    const refused = await post(analyst, '/v1/cases', {
      type: 'genealogy_change', subject_type: 'position', subject_id: ids.C, reason_code: 'PARTICIPANT_REQUEST', payload: change(ids.A!),
    }, true)
    expect(refused.statusCode).toBe(403)
  })
})

describe('genealogy_change decision re-checks (AC-GEN4-2)', () => {
  test('D-B2-20: a leg beyond the placement width in force at decision is refused and the case stays submitted', async () => {
    const child = await holder('LEG')
    await enrol(support, 'placement', child, ids.R!, daysAgo(60), '1')
    await saveSettings(support, { 'genealogy.placement_width': 3 })
    const id = await openCase('genealogy_change', child,
      { kind: 'placement', proposed_parent_position_id: ids.A, effective_from: today(), leg: '3' }, 'COMPANY_DECISION')
    expect((await submit(id)).statusCode).toBe(200)
    await saveSettings(support, { 'genealogy.placement_width': 2 })
    const refused = await decide(id)
    expect([refused.statusCode, refused.json().error.code, await caseState(id)]).toEqual([422, 'LEG_OUT_OF_RANGE', 'submitted'])
    expect(await rowsOf(child)).toHaveLength(1)
  })
})

describe('genealogy_correction (TS-03 flag part)', () => {
  test('lists the committed periods the corrected date reaches, with no payout figure before runs exist', async () => {
    const periodId = await committedPeriod(acmeId, gb, daysAgo(40), daysAgo(10))
    const id = await openCase('genealogy_correction', ids.B!,
      { kind: 'sponsor', proposed_parent_position_id: ids.D, valid_from: daysAgo(30) }, 'DISPUTE_RESOLUTION')
    const preview = (await submit(id)).json().data.effect_preview
    expect(preview).toMatchObject({
      structural_check: { ok: true }, affects_committed_periods: true, estimated_payout_impact: null,
      impact_note: 'Payout impact is calculated once runs exist (B3).',
    })
    expect(preview.affected_committed_periods).toEqual([expect.objectContaining({ period_id: periodId, state: 'committed' })])
    expect((await decide(id)).statusCode).toBe(200)
    expect(await auditActions(acmeId)).toContain('GENEALOGY.CORRECTED')
    expect(await parentAt(ids.B!, daysAgo(20))).toBe('P-D')
    expect(await parentAt(ids.B!, daysAgo(35))).toBe('P-A') // the part before the corrected date is kept
  })
})

describe('transfer (T-B2-15, AC-GEN1-2)', () => {
  test('the position changes owner at the date; the tree is unchanged', async () => {
    const newOwner = await participant(support, gb, typeId, 'HEIR')
    const before = await ownerRows('SELECT * FROM relationship WHERE tenant_id = $1 ORDER BY id', [acmeId])
    const id = await openCase('transfer', ids.C!, { to_participant_id: newOwner, effective_from: today() }, 'SUCCESSION')
    expect((await submit(id)).json().data.effect_preview).toEqual({
      from_owner: { participant_id: owners.C, external_ref: 'C' }, to_owner: { participant_id: newOwner, external_ref: 'HEIR' },
      to_type_can_hold_positions: true,
    })
    expect((await decide(id)).statusCode).toBe(200)
    const detail = (await call(app, { method: 'GET', url: `/v1/positions/${ids.C}`, as: support })).json().data
    expect(detail.owner.participant_id).toBe(newOwner)
    expect(detail.ownership.map((row: { participant: { id: string }; case_id: string | null }) => [row.participant.id, row.case_id]))
      .toEqual([[owners.C, null], [newOwner, id]])
    expect(await ownerRows('SELECT * FROM relationship WHERE tenant_id = $1 ORDER BY id', [acmeId])).toEqual(before)
    expect(await auditActions(acmeId)).toContain('POSITION.OWNERSHIP_TRANSFERRED')
  })

  test('the dry-run refuses an owner that cannot hold positions, the current owner, and an unknown participant', async () => {
    const customerType = await activeType(support, compliance, 'RETAIL', { holdsPositions: false, endCustomer: true })
    const customer = await participant(support, gb, customerType, 'CUSTOMER')
    const check = (to: string) => asUser(support, (tx) =>
      transferType.validateCreate(tx, { type: 'position', id: ids.D! }, { to_participant_id: to, effective_from: today() }, null))
    await expect(check(customer)).rejects.toMatchObject({ statusCode: 422, code: 'TYPE_CANNOT_HOLD_POSITIONS' })
    await expect(check(owners.D!)).rejects.toMatchObject({ statusCode: 409, code: 'OWNERSHIP_CONFLICT' })
    await expect(check('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ statusCode: 422, code: 'PARTICIPANT_NOT_FOUND' })
  })

  test('a market-scoped filer cannot name a new owner outside their markets (unknown, as a missing participant)', async () => {
    const de = await createMarket(acmeId, 'DE')
    const foreign = await participant(support, de, typeId, 'DE-HEIR')
    const local = await participant(support, gb, typeId, 'GB-HEIR')
    const supportGb = await createSignedInUser({ tenantId: acmeId, roles: ['Support agent'], marketIds: [gb] })
    const file = (to: string) => post(supportGb, '/v1/cases', {
      type: 'transfer', subject_type: 'position', subject_id: ids.D, reason_code: 'SALE',
      payload: { to_participant_id: to, effective_from: today() },
    }, true)
    const refused = await file(foreign)
    expect([refused.statusCode, refused.json().error.code]).toEqual([422, 'PARTICIPANT_NOT_FOUND'])
    expect((await file(local)).statusCode).toBe(201)
  })
})
