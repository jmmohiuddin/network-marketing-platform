import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  activePlanVersion, auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { genealogyChangeType, changePayload, correctionPayload } from './genealogy-cases.js'
import { genCaseTypes, genModule } from './index.js'
import { transferType } from './transfer-case.js'
import {
  activeType, asUser, committedPeriod, daysAgo, enrol, evidenceDocument, participant, position, readyPayee, saveSettings,
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
    // D-B6-05: the width comes from the market's plan version only; the version in force at decision narrows it to 2.
    const version = await activePlanVersion(acmeId, gb, { submitterId: support.id, approverId: compliance.id, creditingEvent: 'paid', placementWidth: 3 })
    const id = await openCase('genealogy_change', child,
      { kind: 'placement', proposed_parent_position_id: ids.A, effective_from: today(), leg: '3' }, 'COMPANY_DECISION')
    expect((await submit(id)).statusCode).toBe(200)
    await ownerRows(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE plan_version SET placement_width = 2 WHERE id = '${version}'; COMMIT`)
    const refused = await decide(id)
    expect([refused.statusCode, refused.json().error.code, await caseState(id)]).toEqual([422, 'LEG_OUT_OF_RANGE', 'submitted'])
    expect(await rowsOf(child)).toHaveLength(1)
  })
})

describe('plan parameters (D-B3-06, D-B3-07): width and change window from the plan version', () => {
  test('T-B3-34 / TS-45 window part: a sponsor change after the window is refused with the rule; inside it, or a correction, passes', async () => {
    const my = await createMarket(acmeId, 'MY')
    const version = await activePlanVersion(acmeId, my, {
      submitterId: support.id, approverId: compliance.id, creditingEvent: 'paid', placementWidth: 2,
      rules: [{ rule_key: 'window', kind: 'genealogy.change_window', params: { tree: 'sponsor', withinDaysOfEnrolment: 30 } }],
    })
    const holderIn = async (ref: string, at: string) => position(support, await participant(support, my, typeId, ref, { at }), my, `P-${ref}`, at)
    const parent = await holderIn('MP', daysAgo(90))
    const old = await holderIn('MO', daysAgo(60))
    const fresh = await holderIn('MF', daysAgo(1))
    const create = (subject: string, payload: unknown, type = 'genealogy_change') => post(support, '/v1/cases', {
      type, subject_type: 'position', subject_id: subject, reason_code: type === 'genealogy_change' ? 'COMPANY_DECISION' : 'DATA_ENTRY_ERROR', payload,
    }, true)

    const late = await create(old, change(parent))
    const inside = await create(fresh, change(parent))
    const correction = await create(old, { kind: 'sponsor', proposed_parent_position_id: parent, valid_from: daysAgo(1) }, 'genealogy_correction')
    const placementChange = await create(old, { kind: 'placement', proposed_parent_position_id: parent, effective_from: today() })

    expect(late.json().error).toMatchObject({ code: 'OUTSIDE_CHANGE_WINDOW', details: { rule_id: `${version}:window`, window_days: 30 } })
    expect(late.statusCode).toBe(422)
    expect([inside.statusCode, correction.statusCode, placementChange.statusCode]).toEqual([201, 201, 201])
  })

  test('T-B3-32 / D-B6-05: the plan version\'s placement width applies; the retired setting is never a fallback', async () => {
    const my = (await ownerRows<{ id: string }>(`SELECT id FROM market WHERE tenant_id = $1 AND code = 'MY'`, [acmeId]))[0]!.id
    const child = await position(support, await participant(support, my, typeId, 'MW'), my, 'P-MW')
    await saveSettings(support, { 'genealogy.placement_width': 5 })
    const leg = (subject: string, value: string) => asUser(support, (tx) => genealogyChangeType.validateCreate(tx, { type: 'position', id: subject },
      changePayload.parse({ kind: 'placement', proposed_parent_position_id: ids.R, effective_from: today(), leg: value }), null))

    await expect(leg(child, '3')).rejects.toMatchObject({ statusCode: 422, code: 'LEG_OUT_OF_RANGE', details: { width: 2 } })
    await expect(leg(child, '2')).resolves.toBeUndefined()
    const pt = await createMarket(acmeId, 'PT')
    const planless = await position(support, await participant(support, pt, typeId, 'PTW'), pt, 'P-PTW')
    await expect(leg(planless, '5')).rejects.toMatchObject({ statusCode: 422, code: 'PLACEMENT_NOT_CONFIGURED' }) // no plan: no width
    // A covering version that sets no width (unilevel) does not fall back to the setting.
    const nl = await createMarket(acmeId, 'NL')
    await activePlanVersion(acmeId, nl, { submitterId: support.id, approverId: compliance.id, creditingEvent: 'paid' })
    const unilevel = await position(support, await participant(support, nl, typeId, 'NLW'), nl, 'P-NLW')
    await expect(leg(unilevel, '1')).rejects.toMatchObject({ statusCode: 422, code: 'PLACEMENT_NOT_CONFIGURED' })
  })

  test('BR-GEN-05 at decision: a change window in force when the move applies refuses it; the case stays submitted', async () => {
    const sg = await createMarket(acmeId, 'SG')
    const old = await position(support, await participant(support, sg, typeId, 'SGO', { at: daysAgo(60) }), sg, 'P-SGO', daysAgo(60))
    const id = await openCase('genealogy_change', old, change(ids.R!), 'COMPANY_DECISION')
    expect((await submit(id)).statusCode).toBe(200)
    const version = await activePlanVersion(acmeId, sg, {
      submitterId: support.id, approverId: compliance.id, creditingEvent: 'paid',
      rules: [{ rule_key: 'window', kind: 'genealogy.change_window', params: { tree: 'sponsor', withinDaysOfEnrolment: 30 } }],
    })

    const refused = await decide(id)

    expect(refused.json().error).toMatchObject({ code: 'OUTSIDE_CHANGE_WINDOW', details: { rule_id: `${version}:window`, window_days: 30 } })
    expect([refused.statusCode, await caseState(id)]).toEqual([422, 'submitted'])
    expect(await rowsOf(old)).toEqual([])
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
      impact_note: 'Payout impact is not estimated on the correction: once it is approved, request a restatement of each affected committed period to preview the difference per payee.',
    })
    expect(preview.affected_committed_periods).toEqual([expect.objectContaining({ period_id: periodId, state: 'committed' })])
    expect((await decide(id)).statusCode).toBe(200)
    expect(await auditActions(acmeId)).toContain('GENEALOGY.CORRECTED')
    expect(await parentAt(ids.B!, daysAgo(20))).toBe('P-D')
    expect(await parentAt(ids.B!, daysAgo(35))).toBe('P-A') // the part before the corrected date is kept
  })
})

// D-V1A-06: every new transfer names its legal basis; Compliance officers (case.transfer.approve) decide.
const SUCCESSION_BASIS = { document_kind: 'death_certificate', reference: 'DC-2026-001' }
const SALE_BASIS = { document_kind: 'sale_agreement', reference: 'SA-17' }
const transferTo = (to: string, legal_basis: unknown = SUCCESSION_BASIS) => ({ to_participant_id: to, effective_from: today(), legal_basis })
const readyOwner = async (ref: string, market = gb) => {
  const id = await participant(support, market, typeId, ref)
  await readyPayee(acmeId, id, support.id)
  return id
}

describe('transfer (T-B2-15, AC-GEN1-2)', () => {
  test('T-V1A-43: the position changes owner at the date; the tree is unchanged', async () => {
    const newOwner = await readyOwner('HEIR')
    const before = await ownerRows('SELECT * FROM relationship WHERE tenant_id = $1 ORDER BY id', [acmeId])
    const id = await openCase('transfer', ids.C!, transferTo(newOwner), 'SUCCESSION')
    expect((await submit(id)).json().data.effect_preview).toEqual({
      from_owner: { participant_id: owners.C, external_ref: 'C' }, to_owner: { participant_id: newOwner, external_ref: 'HEIR' },
      to_type_can_hold_positions: true, new_owner_ready: { tax_profile: true, bank_detail: true },
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
      transferType.validateCreate(tx, { type: 'position', id: ids.D! }, { ...transferTo(to), legal_basis: SUCCESSION_BASIS }, null))
    await expect(check(customer)).rejects.toMatchObject({ statusCode: 422, code: 'TYPE_CANNOT_HOLD_POSITIONS' })
    await expect(check(owners.D!)).rejects.toMatchObject({ statusCode: 409, code: 'OWNERSHIP_CONFLICT' })
    await expect(check('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ statusCode: 422, code: 'PARTICIPANT_NOT_FOUND' })
  })

  test('D-B3-07: the new owner\'s positions limit in the market refuses a transfer at create and at decision', async () => {
    const nz = await createMarket(acmeId, 'NZ')
    const version = await activePlanVersion(acmeId, nz, {
      submitterId: support.id, approverId: compliance.id, creditingEvent: 'paid',
      rules: [{ rule_key: 'limit', kind: 'genealogy.positions_limit', params: { max: 1 } }],
    })
    const heir = await readyOwner('NZ-HEIR', nz)
    const [first, second] = await Promise.all(['NZ1', 'NZ2'].map(async (ref) => position(support, await participant(support, nz, typeId, ref), nz, `P-${ref}`)))
    const pending = await openCase('transfer', first!, transferTo(heir), 'SUCCESSION')
    expect((await submit(pending)).statusCode).toBe(200)
    await position(support, heir, nz)

    const atCreate = await post(support, '/v1/cases', {
      type: 'transfer', subject_type: 'position', subject_id: second, reason_code: 'SALE', payload: transferTo(heir, SALE_BASIS),
    }, true)
    const atDecision = await decide(pending)

    expect(atCreate.json().error).toMatchObject({ code: 'POSITION_LIMIT_REACHED', details: { rule_id: `${version}:limit`, max: 1 } })
    expect([atDecision.statusCode, atDecision.json().error.code, await caseState(pending)]).toEqual([422, 'POSITION_LIMIT_REACHED', 'submitted'])
  })

  test('a market-scoped filer cannot name a new owner outside their markets (unknown, as a missing participant)', async () => {
    const de = await createMarket(acmeId, 'DE')
    const foreign = await participant(support, de, typeId, 'DE-HEIR')
    const local = await participant(support, gb, typeId, 'GB-HEIR')
    const supportGb = await createSignedInUser({ tenantId: acmeId, roles: ['Support agent'], marketIds: [gb] })
    const file = (to: string) => post(supportGb, '/v1/cases', {
      type: 'transfer', subject_type: 'position', subject_id: ids.D, reason_code: 'SALE', payload: transferTo(to, SALE_BASIS),
    }, true)
    const refused = await file(foreign)
    expect([refused.statusCode, refused.json().error.code]).toEqual([422, 'PARTICIPANT_NOT_FOUND'])
    expect((await file(local)).statusCode).toBe(201)
  })
})

describe('transfer hardening (D-V1A-06, FR-PAR-004)', () => {
  test('T-V1A-41: no legal basis, a document kind the reason does not allow, or no evidence is refused', async () => {
    const heir = await readyOwner('BASIS-HEIR')
    const file = (payload: unknown, reason = 'SUCCESSION') =>
      post(support, '/v1/cases', { type: 'transfer', subject_type: 'position', subject_id: ids.E, reason_code: reason, payload }, true)

    const missing = await file({ to_participant_id: heir, effective_from: today() })
    expect([missing.statusCode, missing.json().error.code, missing.json().error.details]).toEqual([422, 'VALIDATION_FAILED', { field: 'legal_basis' }])
    expect((await file(transferTo(heir, { document_kind: 'birth_certificate', reference: 'x' }))).statusCode).toBe(422)

    const wrongKind = await file(transferTo(heir, SALE_BASIS)) // a sale agreement does not ground a succession
    expect(wrongKind.statusCode).toBe(201)
    const withoutEvidence = await submit(wrongKind.json().data.id)
    expect([withoutEvidence.statusCode, withoutEvidence.json().error.code]).toEqual([422, 'EVIDENCE_REQUIRED'])
    await post(support, `/v1/cases/${wrongKind.json().data.id}/evidence`, { document_id: await evidenceDocument(support) }, true)
    const refused = await submit(wrongKind.json().data.id)
    expect([refused.statusCode, refused.json().error.details]).toEqual([422, { field: 'legal_basis.document_kind' }])
    expect(await caseState(wrongKind.json().data.id)).toBe('open')
  })

  test('T-V1A-42: only case.transfer.approve decides; staff related to either owner are excluded; an unready or ineligible owner is refused', async () => {
    const [x, y] = await Promise.all(['X', 'Y'].map((ref) => holder(ref)))
    const unready = await participant(support, gb, typeId, 'UNREADY')
    const id = await openCase('transfer', x!, transferTo(unready), 'SUCCESSION')
    expect((await submit(id)).json().data.effect_preview.new_owner_ready).toEqual({ tax_profile: false, bank_detail: false })

    const bySupport = await decide(id, support)
    expect([bySupport.statusCode, bySupport.json().error.code]).toEqual([403, 'PERMISSION_DENIED'])
    const notReady = await decide(id)
    expect([notReady.statusCode, notReady.json().error.code, notReady.json().error.details]).toEqual([422, 'NEW_OWNER_NOT_READY', { missing: ['tax_profile', 'bank_detail'] }])
    expect(await caseState(id)).toBe('submitted')

    const heir = await readyOwner('RELATED-HEIR')
    const related = await createSignedInUser({ tenantId: acmeId, roles: ['Compliance officer'], stepUp: true })
    await ownerRows(
      `INSERT INTO user_related_participant (tenant_id, user_id, participant_id, relation, declared_by) VALUES ($1, $2, $3, 'relative', $2)`,
      [acmeId, related.id, heir],
    )
    const second = await openCase('transfer', y!, transferTo(heir), 'SUCCESSION')
    expect((await submit(second)).statusCode).toBe(200)
    const byRelated = await decide(second, related)
    expect([byRelated.statusCode, byRelated.json().error.code]).toEqual([422, 'SOD_SELF_APPROVAL'])

    await ownerRows(`UPDATE participant SET status = 'merged', merged_into_id = $2 WHERE id = $1`, [heir, owners.R])
    const ineligible = await decide(second)
    expect([ineligible.statusCode, ineligible.json().error.code, await caseState(second)]).toEqual([422, 'NEW_OWNER_NOT_ELIGIBLE', 'submitted'])
  })
})
