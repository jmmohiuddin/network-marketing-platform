import { createHash, randomUUID } from 'node:crypto'
import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { iamModule } from '../iam/index.js'
import { parCaseTypes, parModule } from './index.js'
import { addSignals, digestSignals, findDuplicates, normaliseSignal, signalDigest } from './signals.js'
import { activeType, apiKey, DISTRIBUTOR, enrolled, enrolment, keyCall, setSettings } from './test-support.js'

// FR-PAR-003: T-B2-08 digests and matching, TS-59 / AC-43.1 hold, T-B2-09 outcomes, AC-PAR3-2, AC-PAR3-3, signals route.
let app: FastifyInstance
let acme: TestTenant
let admin: TestUser
let compliance: TestUser
let support: TestUser
let investigator: TestUser
let globexSupport: TestUser
let original: string
let gb: string

closePoolsAfterAll()

const MATCHING = { signals: ['payment_fingerprint', 'identity_ref'], min_matches: 1, hold_activation: true }

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  gb = await createMarket(acme.id, 'GB')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], stepUp: true })
  compliance = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], stepUp: true })
  support = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'] })
  // Investigates and could decide: separation of duties stops it deciding a case it submitted (D-B2-04).
  investigator = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent', 'Compliance officer'], stepUp: true })
  globexSupport = await createSignedInUser({ tenantId: globex.id, roles: ['Support agent'] })
  app = await buildTestApp({ modules: [iamModule, parModule, createCasModule({ types: parCaseTypes })] })
  await activeType(app, admin, compliance, 'DIST', DISTRIBUTOR)
  await setSettings(acme.id, admin.id, { 'participants.duplicate_matching': MATCHING })
  original = (await enrolled(app, support, enrolment('DIST', { signals: { payment_fingerprint: 'CARD-4242' } }))).participant.id
})

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const post = (as: TestUser, url: string, body: unknown, idempotencyKey = false) =>
  call(app, { method: 'POST', url, as, body, ...(idempotencyKey ? { idempotencyKey: true as const } : {}) })
const patch = (as: TestUser, id: string, body: unknown) => call(app, { method: 'PATCH', url: `/v1/cases/${id}`, as, body })
const decide = (as: TestUser, id: string, decision: 'approve' | 'reject' = 'approve') =>
  post(as, `/v1/cases/${id}/decision`, { decision, reason: 'reviewed' }, true)

/** A new distributor sharing the original's card: its case id, participant and position. */
async function suspect() {
  const data = await enrolled(app, support, enrolment('DIST', { signals: { payment_fingerprint: ' card-4242 ' } }))
  return { caseId: data.duplicate_case_id!, participant: data.participant.id, position: data.position! }
}

async function proposed(outcome: 'merge' | 'allow' | 'terminate') {
  const s = await suspect()
  expect((await patch(investigator, s.caseId, { payload: { matched_participant_id: original, matched_kinds: ['payment_fingerprint'], proposed_outcome: outcome } })).statusCode).toBe(200)
  expect((await post(investigator, `/v1/cases/${s.caseId}/submit`, {})).statusCode).toBe(200)
  return s
}

const positionStatus = async (id: string) => (await ownerRows<{ status: string }>('SELECT status FROM position WHERE id = $1', [id]))[0]!.status

describe('digests (T-B2-08)', () => {
  test('normalised before hashing; separate per tenant and kind; 32 bytes', () => {
    const key = Buffer.alloc(32, 7)
    const digest = signalDigest(key, 't1', 'payment_fingerprint', 'CARD-4242')

    expect(normaliseSignal('  Card  4242 ')).toBe('card 4242')
    expect(digest).toHaveLength(32)
    expect(signalDigest(key, 't1', 'payment_fingerprint', ' card-4242')).toEqual(digest)
    expect(signalDigest(key, 't2', 'payment_fingerprint', 'CARD-4242')).not.toEqual(digest)
    expect(signalDigest(key, 't1', 'identity_ref', 'CARD-4242')).not.toEqual(digest)
  })
})

describe('hold and system case (TS-59, AC-43.1)', () => {
  test('a match opens a system duplicate case and holds the new position pending until approved with allow', async () => {
    const s = await suspect()
    const opened = (await get(investigator, `/v1/cases/${s.caseId}`)).json().data
    const activate = withTenant({ tenantId: acme.id, userId: admin.id }, (tx) =>
      tx.query(`SELECT gen_set_position_status($1, 'active', now(), 'try', NULL)`, [s.position.id])).then(() => null, (error: unknown) => error)
    const early = await post(investigator, `/v1/cases/${s.caseId}/submit`, {})

    expect(s.position.status).toBe('pending')
    expect(opened).toMatchObject({
      type: 'duplicate', state: 'open', opened_by: null, opened_by_kind: 'system', reason_code: 'SIGNAL_MATCH',
      payload: { matched_participant_id: original, matched_kinds: ['payment_fingerprint'] }, events: [{ kind: 'opened', actor_id: null }],
    })
    expect((await get(support, `/v1/participants/${s.participant}`)).json().data.duplicate_hold).toBe(true)
    expect(await activate).toMatchObject({ code: 'PA003' })
    expect(early.json().error.code).toBe('OUTCOME_REQUIRED')

    await patch(investigator, s.caseId, { payload: { ...opened.payload, proposed_outcome: 'allow' } })
    const withdraw = await post(investigator, `/v1/cases/${s.caseId}/withdraw`, { reason: 'x' })
    const submitted = await post(investigator, `/v1/cases/${s.caseId}/submit`, {})
    const self = await decide(investigator, s.caseId)
    const approved = await decide(compliance, s.caseId)

    expect(withdraw.statusCode).toBe(403)
    expect(submitted.json().data.effect_preview).toEqual({ outcome: 'allow', positions: [{ id: s.position.id, position_ref: s.position.position_ref, status: 'pending' }], hold_active: true })
    expect(self.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01' } })
    expect(approved.json().data.state).toBe('approved')
    expect(await positionStatus(s.position.id)).toBe('active')
    expect((await get(support, `/v1/participants/${s.participant}`)).json().data.duplicate_hold).toBe(false)
  })
})

describe('outcomes (T-B2-09, AC-PAR3-2)', () => {
  test('merge moves every position to the matched participant and marks the subject merged', async () => {
    const s = await proposed('merge')
    expect((await decide(compliance, s.caseId)).statusCode).toBe(200)

    expect(await ownerRows('SELECT status, merged_into_id FROM participant WHERE id = $1', [s.participant])).toEqual([{ status: 'merged', merged_into_id: original }])
    expect(await ownerRows('SELECT participant_id FROM position_ownership WHERE position_id = $1 AND valid_to IS NULL', [s.position.id])).toEqual([{ participant_id: original }])
    expect((await post(support, `/v1/participants/${s.participant}/signals`, { identity_ref: 'after-merge' }, true)).json().error.code).toBe('PARTICIPANT_MERGED')
  })

  test('terminate ends every position; reject changes nothing', async () => {
    const terminated = await proposed('terminate')
    const rejected = await proposed('allow')
    await decide(compliance, terminated.caseId)
    await decide(compliance, rejected.caseId, 'reject')

    expect(await positionStatus(terminated.position.id)).toBe('terminated')
    expect(await positionStatus(rejected.position.id)).toBe('pending')
  })

  test('a merge that would give a position two owners is 409 OWNERSHIP_CONFLICT and the case stays submitted', async () => {
    const s = await proposed('merge')
    // A pending transfer from tomorrow: the open ownership row starts after now (E-GEN-14).
    await ownerRows(`UPDATE position_ownership SET valid_to = now() + interval '1 day' WHERE position_id = $1 AND valid_to IS NULL`, [s.position.id])
    await ownerRows(
      `INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
       VALUES ($1, $2, $3, now() + interval '1 day', $4, 'user')`, [acme.id, s.position.id, s.participant, admin.id],
    )

    const refused = await decide(compliance, s.caseId)

    expect(refused.json().error.code).toBe('OWNERSHIP_CONFLICT')
    expect((await get(compliance, `/v1/cases/${s.caseId}`)).json().data.state).toBe('submitted')
  })
})

describe('settings (AC-PAR3-3)', () => {
  test('hold_activation false: the case is informational and the position active; unset: digests stored, no case', async () => {
    const tenant = await createTenant()
    await createMarket(tenant.id, 'GB')
    const tAdmin = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin', 'Support agent'] })
    const tCompliance = await createSignedInUser({ tenantId: tenant.id, roles: ['Compliance officer'], stepUp: true })
    await activeType(app, tAdmin, tCompliance, 'DIST', DISTRIBUTOR)
    const signals = { signals: { identity_ref: 'ID-77' } }
    await enrolled(app, tAdmin, enrolment('DIST', signals))
    const unset = await enrolled(app, tAdmin, enrolment('DIST', signals))
    await setSettings(tenant.id, tAdmin.id, { 'participants.duplicate_matching': { ...MATCHING, hold_activation: false } })
    const informational = await enrolled(app, tAdmin, enrolment('DIST', signals))

    expect(unset.duplicate_case_id).toBeNull()
    expect(await ownerRows('SELECT kind FROM participant_signal WHERE participant_id = $1', [unset.participant.id])).toEqual([{ kind: 'identity_ref' }])
    expect(informational.duplicate_case_id).toEqual(expect.any(String))
    expect(informational.position!.status).toBe('active')
  })
})

describe('POST /v1/participants/:id/signals', () => {
  test('adds digests and opens a case once; a key caller\'s case events have no actor; permission, tenant, validation', async () => {
    const other = (await enrolled(app, support, enrolment('DIST'))).participant.id
    const token = await apiKey(app, admin, ['participants:write'])

    const first = await keyCall(app, token, 'POST', `/v1/participants/${other}/signals`, { identity_ref: 'P-1', payment_fingerprint: 'card-4242' })
    const again = await post(support, `/v1/participants/${other}/signals`, { payment_fingerprint: 'CARD-4242' }, true)
    const caseId = first.json().data.duplicate_case_id as string

    expect(first.json().data).toEqual({ added: 2, duplicate_case_id: expect.any(String) })
    // Already under review: the open case, not "no duplicate".
    expect(again.json().data).toEqual({ added: 0, duplicate_case_id: caseId })
    expect(await ownerRows('SELECT actor_id FROM case_event WHERE case_id = $1', [caseId])).toEqual([{ actor_id: null }])
    expect(await ownerRows(`SELECT actor_type FROM audit.audit_event WHERE object_id = $1 AND action = 'CASE.OPENED'`, [caseId])).toEqual([{ actor_type: 'service_account' }])
    expect((await post(compliance, `/v1/participants/${other}/signals`, { identity_ref: 'x' }, true)).statusCode).toBe(403)
    expect((await post(globexSupport, `/v1/participants/${other}/signals`, { identity_ref: 'x' }, true)).statusCode).toBe(404)
    expect((await post(support, `/v1/participants/${other}/signals`, {}, true)).statusCode).toBe(400)
  })
})

describe('privacy scan (T-B2-10, AC-PAR3-1)', () => {
  test('raw signal values appear in no table and no log line', async () => {
    const raw = { identity_ref: 'PASSPORT-X93XQ71', payment_fingerprint: 'FP-UNIQUE-55AA', address: '9 Hidden Lane Z9', device_id: 'DEV-UNIQUE-7Q' }
    const lines: string[] = []
    const logged = await buildTestApp({ modules: [parModule, createCasModule({ types: parCaseTypes })], env: { LOG_LEVEL: 'trace' } })
    const streamKey = Object.getOwnPropertySymbols(logged.log).find((symbol) => symbol.description === 'pino.stream')!
    const stream = (logged.log as unknown as Record<symbol, { write: (line: string) => unknown }>)[streamKey]!
    stream.write = (line: string) => lines.push(line)
    const body = enrolment('DIST', { signals: raw })
    try {
      const data = await enrolled(logged, support, body)
      await enrolled(logged, support, enrolment('DIST', { signals: raw }))
      expect(data.participant.id).toEqual(expect.any(String))
    } finally {
      await logged.close()
    }
    const stored = await ownerRows<{ text: string }>(
      `SELECT string_agg(t, ' ') AS text FROM (
         SELECT encode(digest, 'escape') AS t FROM participant_signal
         UNION ALL SELECT coalesce(before_ref, '') || coalesce(after_ref, '') FROM audit.audit_event
         UNION ALL SELECT payload::text FROM outbox_event
         UNION ALL SELECT payload::text FROM case_file
         UNION ALL SELECT coalesce(response::text, '') FROM idempotency_key) x`,
    )

    // The Idempotency-Key's request hash is unkeyed: it must not be the hash of the raw body (offline guessing).
    const unkeyed = createHash('sha256').update(JSON.stringify({ body, params: {} })).digest()
    expect(await ownerRows('SELECT 1 FROM idempotency_key WHERE request_hash = $1', [unkeyed])).toEqual([])
    expect(lines.length).toBeGreaterThan(0)
    for (const value of Object.values(raw)) {
      expect(stored[0]!.text).not.toContain(value)
      expect(stored[0]!.text.toLowerCase()).not.toContain(value.toLowerCase())
      expect(lines.join('\n').toLowerCase()).not.toContain(value.toLowerCase())
    }
  })
})

describe('signals and the Idempotency-Key (D-B2-10)', () => {
  test('the request hash covers digests, not raw values; a replay answers again and another value is 422', async () => {
    const id = (await enrolled(app, support, enrolment('DIST'))).participant.id
    const raw = { identity_ref: '123456789' }
    const key = randomUUID()
    const send = (body: unknown) => call(app, { method: 'POST', url: `/v1/participants/${id}/signals`, as: support, body, idempotencyKey: key })

    const first = await send(raw)
    const replay = await send(raw)
    const other = await send({ identity_ref: '123456780' })
    const unkeyed = createHash('sha256').update(JSON.stringify({ body: raw, params: { id } })).digest()

    expect(first.statusCode).toBe(200)
    expect(await ownerRows('SELECT 1 FROM idempotency_key WHERE request_hash = $1', [unkeyed])).toEqual([])
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(other.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  test('concurrent writes of one digest serialise (audit-chain lock): the later one sees the earlier participant', async () => {
    const [a, b] = await Promise.all([enrolled(app, support, enrolment('DIST')), enrolled(app, support, enrolment('DIST'))])
    const digests = digestSignals(app.config.secretKey, acme.id, { identity_ref: 'RACE-ID-1' })
    const ctx = { tenantId: acme.id, userId: support.id }
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let added!: () => void
    const firstAdded = new Promise<void>((resolve) => { added = resolve })

    const first = withTenant(ctx, async (tx) => {
      await addSignals(tx, a.participant.id, digests)
      added()
      await gate
      return findDuplicates(tx, a.participant.id)
    })
    await firstAdded
    const second = withTenant(ctx, async (tx) => {
      await addSignals(tx, b.participant.id, digests)
      return findDuplicates(tx, b.participant.id)
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    release()

    expect((await first).matches).toEqual([])
    expect((await second).matches).toEqual([{ participant_id: a.participant.id, kinds: ['identity_ref'] }])
  })
})

describe('review edge cases (D-B2-10, AC-43.1)', () => {
  test('whoever chose the outcome by PATCH cannot approve it; the audit keeps the payload before and after', async () => {
    const s = await suspect()
    const { payload } = (await get(investigator, `/v1/cases/${s.caseId}`)).json().data
    expect((await patch(investigator, s.caseId, { payload: { ...payload, proposed_outcome: 'allow' } })).statusCode).toBe(200)
    expect((await post(support, `/v1/cases/${s.caseId}/submit`, {})).statusCode).toBe(200)

    const detail = (await get(investigator, `/v1/cases/${s.caseId}`)).json().data
    const self = await decide(investigator, s.caseId)
    const [audit] = await ownerRows<{ before_ref: string; after_ref: string }>(
      `SELECT before_ref, after_ref FROM audit.audit_event WHERE object_id = $1 AND action = 'CASE.UPDATED'`, [s.caseId])

    expect(detail.eligible_approvers.map((u: { user_id: string }) => u.user_id)).not.toContain(investigator.id)
    expect(self.json().error).toMatchObject({ code: 'SOD_SELF_APPROVAL', details: { reason_code: 'SOD-01' } })
    expect(JSON.parse(audit!.before_ref)).toMatchObject({ payload })
    expect(JSON.parse(audit!.after_ref).after).toMatchObject({ payload: { ...payload, proposed_outcome: 'allow' } })
    expect((await decide(compliance, s.caseId)).statusCode).toBe(200)
  })

  test('a subject matching two participants stays held until its last review is approved with allow', async () => {
    const a = (await enrolled(app, support, enrolment('DIST', { signals: { payment_fingerprint: 'FP-TWIN-A' } }))).participant.id
    const b = (await enrolled(app, support, enrolment('DIST', { signals: { identity_ref: 'ID-TWIN-B' } }))).participant.id
    const s = await enrolled(app, support, enrolment('DIST', { signals: { payment_fingerprint: 'fp-twin-a', identity_ref: 'id-twin-b' } }))
    const cases = await ownerRows<{ id: string; matched: string }>(
      `SELECT id, payload ->> 'matched_participant_id' AS matched FROM case_file WHERE subject_id = $1 ORDER BY created_at, id`, [s.participant.id])
    for (const { id } of cases) {
      const { payload } = (await get(investigator, `/v1/cases/${id}`)).json().data
      await patch(investigator, id, { payload: { ...payload, proposed_outcome: 'allow' } })
      await post(investigator, `/v1/cases/${id}/submit`, {})
    }

    const first = await decide(compliance, cases[0]!.id)
    const held = await positionStatus(s.position!.id)
    const last = await decide(compliance, cases[1]!.id)

    expect(cases.map((c) => c.matched).sort()).toEqual([a, b].sort())
    expect(first.statusCode).toBe(200)
    expect(held).toBe('pending')
    expect(last.statusCode).toBe(200)
    expect(await positionStatus(s.position!.id)).toBe('active')
  })

  test('the merge target is in the preparer\'s markets and still active when the merge is approved', async () => {
    await createMarket(acme.id, 'DE')
    const supportGb = await createSignedInUser({ tenantId: acme.id, roles: ['Support agent'], marketIds: [gb] })
    const elsewhere = (await enrolled(app, support, enrolment('DIST', {}, 'DE'))).participant.id
    const target = (await enrolled(app, support, enrolment('DIST', { signals: { identity_ref: 'ID-CHAIN-1' } }))).participant.id
    const subject = await enrolled(app, support, enrolment('DIST', { signals: { identity_ref: 'id-chain-1' } }))
    const caseId = subject.duplicate_case_id!
    const { payload } = (await get(investigator, `/v1/cases/${caseId}`)).json().data

    const outOfScope = await patch(supportGb, caseId, { payload: { ...payload, matched_participant_id: elsewhere, proposed_outcome: 'merge' } })
    await patch(supportGb, caseId, { payload: { ...payload, proposed_outcome: 'merge' } })
    await post(supportGb, `/v1/cases/${caseId}/submit`, {})
    await ownerRows(`UPDATE participant SET status = 'merged', merged_into_id = $2 WHERE id = $1`, [target, original])
    const refused = await decide(compliance, caseId)

    expect(outOfScope.json().error.code).toBe('MATCHED_PARTICIPANT_INVALID')
    expect(refused.json().error.code).toBe('MATCHED_PARTICIPANT_INVALID')
    expect((await get(compliance, `/v1/cases/${caseId}`)).json().data.state).toBe('submitted')
  })
})
