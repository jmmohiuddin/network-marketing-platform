import { randomUUID } from 'node:crypto'
import fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createPortalUser, createSignedInUser, createTenant, mailsTo, ownerRows, resetApiDb,
  testConfig, type TestUser,
} from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { grievanceEscalationJob } from './grievance-escalation.js'
import { cplCaseTypes, cplModule } from './index.js'
import { GRIEVANCE_CSV_HEADER, grievanceCsvRow, type GrievanceRow } from './registers.js'

// PLAN B-MKT FR-CPL-013: T-BM-21 grievance case type, T-BM-22 escalation cron (TS-68 grievance part), T-BM-23 grievance
// register and export, T-BM-24 delisted register routes and export. Pack rows are TEST FIXTURES (the product ships none).

const SYSTEM = '00000000-0000-0000-0000-000000000000'
const PACK = 'cpl-test-registers' // grievance ack 48 h, resolution 30 days, lead 24 h; delisted external_ref + terminated_on, 30 days
const NOLEAD = 'cpl-test-nolead' // grievance ack 48 h, resolution 1 month, no lead; delisted every field, no window
const HOUR = 3_600_000
const DAY = 24 * HOUR
const log = fastify({ logger: false }).log
closePoolsAfterAll()

let app: FastifyInstance
let tenantA: string
let tenantB: string
let m1: string // PACK
let m2: string // NOLEAD
let m3: string // no pack rules
let mb: string // tenant B, PACK
let agent: TestUser // Support agent: records and acknowledges
let officer: TestUser // Compliance officer, all markets
let officer2: TestUser // a second Compliance officer
let scoped: TestUser // Compliance officer of m2 only
let analyst: TestUser // no grievance or register permission
let officerB: TestUser

async function insertPacks(): Promise<void> {
  await ownerRows(
    `INSERT INTO pack_rule (id, market_pack, kind, title, params, mandatory, basis, basis_status, source_ref, effective_from)
     SELECT r.id, r.pack, r.kind, 'TEST FIXTURE', r.params::jsonb, true, 'test fixture basis', 'screening', 'test', '2020-01-01'
     FROM (VALUES
       ('cpl-test-grievance@2020-01-01', $1, 'grievance_register', '{"ack_hours": 48, "resolution": {"days": 30}, "escalation_lead_hours": 24}'),
       ('cpl-test-delisted@2020-01-01', $1, 'delisted_register', '{"fields": ["terminated_on", "external_ref"], "window_days": 30}'),
       ('cpl-test-grievance-nolead@2020-01-01', $2, 'grievance_register', '{"ack_hours": 48, "resolution": {"months": 1}}'),
       ('cpl-test-delisted-all@2020-01-01', $2, 'delisted_register', '{"fields": ["external_ref", "display_name", "terminated_on"]}')
     ) AS r (id, pack, kind, params)
     ON CONFLICT (id) DO NOTHING`,
    [PACK, NOLEAD])
}

async function market(tenantId: string, code: string, pack: string, state = 'live'): Promise<string> {
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
     VALUES ($1, $2, 'EUR', 2, 'Europe/Berlin', '{de}', $3, $4) RETURNING id`, [tenantId, code, pack, state])
  return row!.id
}

interface Fixture { readonly id: string; readonly ref: string }

/** A participant of the market with owned positions in the given statuses since the given instants (owner fixture). */
async function participant(tenantId: string, marketId: string, positions: readonly { status: string; since: Date }[], erased = false): Promise<Fixture> {
  const ref = `p-${randomUUID().slice(0, 8)}`
  const [row] = await ownerRows<{ id: string }>(
    `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, enrolled_at, created_by, created_by_type, pseudonymised_at)
     VALUES ($1, $2, 'individual', $3, CASE WHEN $4 THEN NULL ELSE 'Name ' || $2 END, now() - interval '400 days', $5, 'system',
             CASE WHEN $4 THEN now() END) RETURNING id`,
    [tenantId, ref, marketId, erased, SYSTEM])
  for (const [index, position] of positions.entries()) {
    const [p] = await ownerRows<{ id: string }>(
      `INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
       VALUES ($1, $2, $3, $4, $5, $6, 'system') RETURNING id`, [tenantId, `${ref}-${index}`, marketId, position.status, position.since, SYSTEM])
    await ownerRows(
      `INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
       VALUES ($1, $2, $3, now() - interval '400 days', $4, 'system')`, [tenantId, p!.id, row!.id, SYSTEM])
  }
  return { id: row!.id, ref }
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const berlinDate = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(at)

const open = (as: TestUser, subject: { type: string; id: string }, payload: Record<string, unknown>, reason = 'payout') =>
  call(app, { method: 'POST', url: '/v1/cases', as, idempotencyKey: true, body: { type: 'grievance', subject_type: subject.type, subject_id: subject.id, reason_code: reason, payload } })
const opened = async (as: TestUser, subject: { type: string; id: string }, receivedAt: string, extra: Record<string, unknown> = {}): Promise<string> => {
  const response = await open(as, subject, { received_at: receivedAt, channel: 'email', ...extra })
  expect(response.statusCode, response.body).toBe(201)
  return response.json().data.id as string
}
const submit = (as: TestUser, id: string) => call(app, { method: 'POST', url: `/v1/cases/${id}/submit`, as, body: {} })
const decide = (as: TestUser, id: string, decision: 'approve' | 'reject') =>
  call(app, { method: 'POST', url: `/v1/cases/${id}/decision`, as, idempotencyKey: true, body: { decision, reason: 'Reviewed with the complainant.' } })
const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const registerRow = async (id: string) => (await get(officer, `/v1/registers/grievances?case_id=${id}`)).json().data[0]
const lastAudit = async (tenantId: string, action: string) => (await ownerRows<{ after: unknown }>(
  `SELECT after_ref::jsonb -> 'after' AS after FROM audit.audit_event WHERE tenant_id = $1 AND action = $2 ORDER BY seq DESC LIMIT 1`,
  [tenantId, action]))[0]?.after

beforeAll(async () => {
  await resetApiDb()
  await insertPacks()
  tenantA = (await createTenant()).id
  tenantB = (await createTenant()).id
  m1 = await market(tenantA, 'DE', PACK)
  m2 = await market(tenantA, 'AT', NOLEAD)
  m3 = await market(tenantA, 'CH', 'none')
  mb = await market(tenantB, 'DE', PACK)
  agent = await createSignedInUser({ tenantId: tenantA, roles: ['Support agent'] })
  officer = await createSignedInUser({ tenantId: tenantA, roles: ['Compliance officer'], stepUp: true })
  officer2 = await createSignedInUser({ tenantId: tenantA, roles: ['Compliance officer'], stepUp: true })
  scoped = await createSignedInUser({ tenantId: tenantA, roles: ['Compliance officer'], marketIds: [m2], stepUp: true })
  analyst = await createSignedInUser({ tenantId: tenantA, roles: ['Commission analyst'] })
  officerB = await createSignedInUser({ tenantId: tenantB, roles: ['Compliance officer'], stepUp: true })
  app = await buildTestApp({ modules: [cplModule, createCasModule({ types: cplCaseTypes })] })
})

afterAll(async () => {
  await app.close()
})

describe('T-BM-21 grievance case type (AC-CPL13-1, AC-CPL13-2)', () => {
  test('received 3 days ago: open and ack overdue; acknowledged late; resolved upheld or not upheld; preparers cannot decide', async () => {
    const complainant = await participant(tenantA, m1, [{ status: 'active', since: new Date(Date.now() - 100 * DAY) }])
    const received = ago(3 * DAY)
    const id = await opened(agent, { type: 'participant', id: complainant.id }, received, { external_ref: 'TICKET-1' })
    const row = await registerRow(id)
    expect(row).toMatchObject({
      case_id: id, market_id: m1, subject: { type: 'participant', id: complainant.id, external_ref: complainant.ref }, category: 'payout',
      channel: 'email', external_ref: 'TICKET-1', received_at: received, ack_due_at: new Date(Date.parse(received) + 48 * HOUR).toISOString(),
      acknowledged_at: null, state: 'open', outcome: null, ack_overdue: true, resolution_overdue: false, escalated: [],
      rule_id: 'cpl-test-grievance@2020-01-01',
    })

    const submitted = await submit(agent, id)
    expect(submitted.statusCode, submitted.body).toBe(200)
    const acknowledged = await registerRow(id)
    expect(submitted.json().data.effect_preview).toEqual({
      ack_due_at: acknowledged.ack_due_at, resolution_due_at: acknowledged.resolution_due_at, rule_id: 'cpl-test-grievance@2020-01-01',
    })
    expect(new Date(submitted.json().data.due_at).toISOString()).toBe(acknowledged.resolution_due_at)
    // 30 calendar days in the market zone
    const resolutionDate = new Date(Date.parse(`${berlinDate(new Date(received))}T00:00:00Z`) + 30 * DAY).toISOString().slice(0, 10)
    expect(berlinDate(new Date(acknowledged.resolution_due_at))).toBe(resolutionDate)
    expect(acknowledged).toMatchObject({ state: 'submitted', ack_overdue: false })
    expect(acknowledged.acknowledged_at > acknowledged.ack_due_at).toBe(true)

    expect((await decide(agent, id, 'approve')).statusCode).toBe(403)
    const approved = await decide(officer, id, 'approve')
    expect(approved.statusCode, approved.body).toBe(200)
    expect(await registerRow(id)).toMatchObject({ state: 'approved', outcome: 'upheld', resolved_at: expect.any(String) })

    const own = await opened(officer, { type: 'market', id: m1 }, ago(HOUR))
    expect((await submit(officer, own)).statusCode).toBe(200)
    const self = await decide(officer, own, 'reject')
    expect(self.statusCode).toBe(422)
    expect(self.json().error.code).toBe('SOD_SELF_APPROVAL')
    expect((await decide(officer2, own, 'reject')).statusCode).toBe(200)
    expect(await registerRow(own)).toMatchObject({ outcome: 'not_upheld', subject: { type: 'market', id: m1, external_ref: null } })
  })

  test('an officer declared related to the complainant does not decide the grievance; another officer does', async () => {
    const complainant = await participant(tenantA, m1, [{ status: 'active', since: new Date(Date.now() - 100 * DAY) }])
    await ownerRows(`INSERT INTO user_related_participant (tenant_id, user_id, participant_id, relation, declared_by) VALUES ($1, $2, $3, 'self', $4)`,
      [tenantA, officer.id, complainant.id, officer2.id])
    const id = await opened(agent, { type: 'participant', id: complainant.id }, ago(HOUR))
    expect((await submit(agent, id)).statusCode).toBe(200)

    const related = await decide(officer, id, 'approve')

    expect(related.statusCode).toBe(422)
    expect(related.json().error.code).toBe('SOD_SELF_APPROVAL')
    expect(related.json().error.details.eligible_approvers.map((u: { user_id: string }) => u.user_id)).not.toContain(officer.id)
    expect((await decide(officer2, id, 'reject')).statusCode).toBe(200)
  })

  test('BUG-130: a participant of a draft market (in implementation) with a register in its pack gets a grievance', async () => {
    const draft = await market(tenantA, 'FR', PACK, 'draft')
    const complainant = await participant(tenantA, draft, [{ status: 'active', since: new Date(Date.now() - 100 * DAY) }])
    const id = await opened(agent, { type: 'participant', id: complainant.id }, ago(3 * DAY), { external_ref: 'T-1001' })
    expect(await registerRow(id)).toMatchObject({ state: 'open', ack_overdue: true })
  })

  test('refusals: no register in the pack, received_at out of range, bad codes, unknown or foreign subject, no permission', async () => {
    const payload = { received_at: ago(HOUR), channel: 'letter' }
    const refusal = async (as: TestUser, subject: { type: string; id: string }, body: Record<string, unknown>, reason = 'payout') => {
      const response = await open(as, subject, body, reason)
      return [response.statusCode, response.json().error?.code, response.json().error?.details] as const
    }
    expect(await refusal(agent, { type: 'market', id: m3 }, payload)).toEqual([422, 'REGISTER_NOT_ENABLED', null])
    expect(await refusal(agent, { type: 'market', id: m1 }, { ...payload, received_at: new Date(Date.now() + HOUR).toISOString() }))
      .toEqual([422, 'VALIDATION_FAILED', { field: 'received_at' }])
    expect(await refusal(agent, { type: 'market', id: m1 }, { ...payload, received_at: ago(367 * DAY) }))
      .toEqual([422, 'VALIDATION_FAILED', { field: 'received_at' }])
    expect((await refusal(agent, { type: 'market', id: m1 }, { ...payload, channel: 'fax' }))[0]).toBe(422)
    expect((await refusal(agent, { type: 'market', id: m1 }, { ...payload, external_ref: 'Tickét' }))[0]).toBe(422)
    expect((await refusal(agent, { type: 'market', id: m1 }, { ...payload, name: 'A complainant' }))[0]).toBe(422)
    expect((await refusal(agent, { type: 'market', id: m1 }, payload, 'rudeness'))[1]).toBe('REASON_CODE_INVALID')
    expect((await refusal(agent, { type: 'market', id: randomUUID() }, payload))[1]).toBe('SUBJECT_NOT_FOUND')
    expect((await refusal(agent, { type: 'market', id: mb }, payload))[1]).toBe('SUBJECT_NOT_FOUND')
    expect((await refusal(scoped, { type: 'market', id: m1 }, payload))[1]).toBe('SUBJECT_NOT_FOUND')
    expect((await refusal(analyst, { type: 'market', id: m1 }, payload))[0]).toBe(403)
  })

  test('evidence: refused on a market subject (complainant not on record), accepted on a participant subject', async () => {
    const evidence = async (id: string) => {
      const [document] = await ownerRows<{ id: string }>(
        `INSERT INTO document (tenant_id, class, storage_key, sha256, mime, size_bytes, uploaded_by, version, file_name)
         VALUES ($1, 'evidence', 'documents/fixture', sha256(gen_random_uuid()::text::bytea), 'application/pdf', 1, $2, 1, 'letter.pdf')
         RETURNING id`, [tenantA, agent.id])
      const response = await call(app, {
        method: 'POST', url: `/v1/cases/${id}/evidence`, as: agent, idempotencyKey: true, body: { document_id: document!.id },
      })
      return [response.statusCode, response.json().error?.code] as const
    }
    const aboutMarket = await opened(agent, { type: 'market', id: m1 }, ago(HOUR))
    expect(await evidence(aboutMarket)).toEqual([422, 'EVIDENCE_NOT_ALLOWED'])
    expect(await ownerRows('SELECT 1 FROM case_evidence WHERE case_id = $1', [aboutMarket])).toEqual([])
    const complainant = await participant(tenantA, m1, [{ status: 'active', since: new Date() }])
    expect(await evidence(await opened(agent, { type: 'participant', id: complainant.id }, ago(HOUR)))).toEqual([201, undefined])
  })

  test('PATCH: received_at is fixed, the other payload fields still change', async () => {
    const id = await opened(agent, { type: 'market', id: m1 }, ago(2 * HOUR))
    const before = (await registerRow(id)).received_at as string
    const patch = (payload: Record<string, unknown>) => call(app, { method: 'PATCH', url: `/v1/cases/${id}`, as: agent, body: { payload } })
    const moved = await patch({ received_at: ago(HOUR), channel: 'email' })
    expect([moved.statusCode, moved.json().error.code, moved.json().error.details]).toEqual([422, 'VALIDATION_FAILED', { field: 'received_at' }])
    const changed = await patch({ received_at: before, channel: 'phone', external_ref: 'REF 2' })
    expect(changed.statusCode, changed.body).toBe(200)
    expect(await registerRow(id)).toMatchObject({ received_at: before, channel: 'phone', external_ref: 'REF 2' })
  })
})

describe('T-BM-23 grievance register and export (AC-CPL13-4)', () => {
  test('filters, market scope, paging; out of scope or foreign markets are 404; tenant B sees none of A', async () => {
    const late = await opened(agent, { type: 'market', id: m2 }, ago(5 * DAY))
    const fresh = await opened(agent, { type: 'market', id: m2 }, ago(10 * 60_000))
    const ids = async (as: TestUser, query: string) => {
      const response = await get(as, `/v1/registers/grievances?${query}`)
      expect(response.statusCode, response.body).toBe(200)
      return response.json().data.map((row: { case_id: string }) => row.case_id) as string[]
    }
    expect(await ids(officer, `market_id=${m2}`)).toEqual([fresh, late])
    expect(await ids(officer, `market_id=${m2}&overdue=ack`)).toEqual([late])
    expect(await ids(officer, `market_id=${m2}&overdue=resolution`)).toEqual([])
    expect(await ids(officer, `market_id=${m2}&state=submitted`)).toEqual([])
    expect(await ids(officer, `case_id=${late}`)).toEqual([late])
    const all = await ids(scoped, '')
    expect(all).toEqual([fresh, late])

    const first = await get(scoped, '/v1/registers/grievances?limit=1')
    expect(first.json().data.map((row: { case_id: string }) => row.case_id)).toEqual([fresh])
    const second = await get(scoped, `/v1/registers/grievances?limit=1&cursor=${first.json().meta.next_cursor}`)
    expect(second.json()).toMatchObject({ data: [{ case_id: late }], meta: { next_cursor: null } })

    expect((await get(scoped, `/v1/registers/grievances?market_id=${m1}`)).statusCode).toBe(404)
    expect((await get(officer, `/v1/registers/grievances?market_id=${mb}`)).statusCode).toBe(404)
    expect((await get(officerB, '/v1/registers/grievances')).json().data).toEqual([])
    expect((await get(officerB, `/v1/registers/grievances?case_id=${late}`)).json().data).toEqual([])
  })

  test('403 without case.grievance.read, portal sessions refused, invalid filters 400', async () => {
    expect((await get(analyst, '/v1/registers/grievances')).statusCode).toBe(403)
    expect((await get(analyst, '/v1/registers/grievances/export')).statusCode).toBe(403)
    const member = await participant(tenantA, m1, [{ status: 'active', since: new Date() }])
    const portal = await createPortalUser({ tenantId: tenantA, participantId: member.id })
    expect((await get(portal, '/v1/registers/grievances')).statusCode).toBe(403)
    expect((await get(portal, '/v1/registers/grievances/export')).statusCode).toBe(403)
    expect((await get(officer, '/v1/registers/grievances?overdue=soon')).statusCode).toBe(400)
    expect((await get(officer, '/v1/registers/grievances?limit=51')).statusCode).toBe(400)
    expect((await get(officer, '/v1/registers/grievances?cursor=bogus')).statusCode).toBe(400)
  })

  test('the CSV holds the list\'s rows without names, is audited with the filters, and refuses above the cap', async () => {
    const listed = (await get(scoped, `/v1/registers/grievances?market_id=${m2}`)).json().data as { case_id: string }[]
    const response = await get(scoped, `/v1/registers/grievances/export?market_id=${m2}`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-store')
    const lines = response.body.trimEnd().split('\r\n')
    expect(lines[0]!.split(',')).toEqual([
      'case_id', 'market_id', 'subject_type', 'subject_id', 'subject_external_ref', 'category', 'channel', 'external_ref', 'received_at',
      'ack_due_at', 'acknowledged_at', 'resolution_due_at', 'resolved_at', 'outcome', 'state', 'ack_overdue', 'resolution_overdue',
      'escalated', 'rule_id',
    ])
    expect(lines.slice(1).map((line) => line.split(',')[0])).toEqual(listed.map((row) => row.case_id))
    expect(response.body).not.toContain('Name ')
    expect(await lastAudit(tenantA, 'EXPORT.CREATED')).toEqual({ kind: 'grievance_register', filters: { market_id: m2 }, row_count: listed.length })

    const capped = await buildTestApp({ modules: [cplModule, createCasModule({ types: cplCaseTypes })], env: { EXPORT_ROW_CAP: '1' } })
    const refused = await call(capped, { method: 'GET', url: '/v1/registers/grievances/export', as: officer })
    await capped.close()
    expect([refused.statusCode, refused.json().error.code]).toEqual([422, 'EXPORT_ROW_CAP_EXCEEDED'])
    expect(await auditActions(tenantA)).toContain('EXPORT.REFUSED')
  })
})

describe('BUG-139: the CSV prints the register\'s state words and escalated as true/false', () => {
  const row = (state: string, escalated: string[]): GrievanceRow => ({
    case_id: 'c', market_id: 'm', subject: { type: 'market', id: 'm', external_ref: null }, category: 'x', channel: 'email', external_ref: null,
    received_at: 'r', ack_due_at: 'a', acknowledged_at: null, resolution_due_at: 'd', resolved_at: null, outcome: null, state,
    ack_overdue: false, resolution_overdue: false, escalated, rule_id: 'rule',
  })
  const column = (name: (typeof GRIEVANCE_CSV_HEADER)[number]) => GRIEVANCE_CSV_HEADER.indexOf(name)

  test.each([
    ['open', 'open'], ['submitted', 'submitted'], ['approved', 'resolved_upheld'], ['rejected', 'resolved_not_upheld'], ['withdrawn', 'withdrawn'],
  ])('state %s is written %s', (state, word) => {
    expect(grievanceCsvRow(row(state, []))[column('state')]).toBe(word)
  })

  test('escalated is true once a deadline escalated, false otherwise (never empty)', () => {
    expect(grievanceCsvRow(row('open', []))[column('escalated')]).toBe(false)
    expect(grievanceCsvRow(row('open', ['acknowledgement']))[column('escalated')]).toBe(true)
  })
})

describe('T-BM-24 delisted register (AC-CPL13-5)', () => {
  test('only all-terminated participants within the window, only the rule\'s fields, terminated_on in the market zone', async () => {
    const at = new Date(Date.now() - 5 * DAY)
    at.setUTCHours(23, 30, 0, 0) // after midnight in Berlin
    const delisted = await participant(tenantA, m1, [{ status: 'terminated', since: at }, { status: 'terminated', since: new Date(Date.now() - 20 * DAY) }])
    await participant(tenantA, m1, [{ status: 'terminated', since: at }, { status: 'active', since: at }])
    await participant(tenantA, m1, [{ status: 'terminated', since: new Date(Date.now() - 40 * DAY) }])
    await participant(tenantA, m1, [{ status: 'active', since: at }])
    const response = await get(officer, `/v1/registers/delisted?market_id=${m1}`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toEqual({
      rule: { id: 'cpl-test-delisted@2020-01-01', fields: ['external_ref', 'terminated_on'], window_days: 30, basis_status: 'screening' },
      rows: [{ participant_id: delisted.id, external_ref: delisted.ref, terminated_on: berlinDate(at) }],
    })
    expect(berlinDate(at)).not.toBe(at.toISOString().slice(0, 10))

    const csv = await get(officer, `/v1/registers/delisted/export?market_id=${m1}`)
    expect(csv.statusCode, csv.body).toBe(200)
    expect(csv.body).toBe(`external_ref,terminated_on\r\n${delisted.ref},${berlinDate(at)}\r\n`)
    expect(await lastAudit(tenantA, 'EXPORT.CREATED')).toEqual({ kind: 'delisted_register', filters: { market_id: m1 }, row_count: 1 })
  })

  test('every field and no window on the other pack; an erased participant has no name; paging', async () => {
    const old = await participant(tenantA, m2, [{ status: 'terminated', since: new Date(Date.now() - 300 * DAY) }])
    const erased = await participant(tenantA, m2, [{ status: 'terminated', since: new Date(Date.now() - 2 * DAY) }], true)
    const page = await get(scoped, `/v1/registers/delisted?market_id=${m2}&limit=1`)
    expect(page.json().data.rows).toEqual([{ participant_id: erased.id, external_ref: erased.ref, display_name: null, terminated_on: expect.any(String) }])
    const rest = await get(scoped, `/v1/registers/delisted?market_id=${m2}&limit=1&cursor=${page.json().meta.next_cursor}`)
    expect(rest.json()).toMatchObject({ data: { rows: [{ participant_id: old.id, display_name: `Name ${old.ref}` }] }, meta: { next_cursor: null } })
  })

  test('the cursor carries only the participant id; the export counts before reading and refuses above the cap', async () => {
    // m1's rule leaves display_name out: the cursor must not carry external_ref or terminated_on either (D-BM-09).
    const since = new Date(Date.now() - 3 * DAY)
    const first = await participant(tenantA, m1, [{ status: 'terminated', since }])
    const second = await participant(tenantA, m1, [{ status: 'terminated', since }])
    const page = await get(officer, `/v1/registers/delisted?market_id=${m1}&limit=1`)
    const cursor = page.json().meta.next_cursor as string
    const [shown] = page.json().data.rows as { participant_id: string }[]
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toBe(shown!.participant_id)
    const next = await get(officer, `/v1/registers/delisted?market_id=${m1}&limit=1&cursor=${cursor}`)
    expect(next.statusCode, next.body).toBe(200)
    const pair = [shown!.participant_id, next.json().data.rows[0].participant_id].sort()
    expect(pair).toEqual([first.id, second.id].sort())
    expect((await get(officer, `/v1/registers/delisted?market_id=${m1}&cursor=${Buffer.from('["2020-01-01","x"]').toString('base64url')}`)).statusCode).toBe(400)

    const capped = await buildTestApp({ modules: [cplModule, createCasModule({ types: cplCaseTypes })], env: { EXPORT_ROW_CAP: '1' } })
    const refused = await call(capped, { method: 'GET', url: `/v1/registers/delisted/export?market_id=${m1}`, as: officer })
    await capped.close()
    expect([refused.statusCode, refused.json().error.code, refused.json().error.details.row_cap]).toEqual([422, 'EXPORT_ROW_CAP_EXCEEDED', 1])
    expect(refused.json().error.details.row_count).toBeGreaterThan(1)
  })

  test('not enabled 422, out of scope or foreign 404, 403 without register.read, portal refused, market_id required', async () => {
    const code = async (as: TestUser, url: string) => {
      const response = await get(as, url)
      return [response.statusCode, response.json().error?.code] as const
    }
    expect(await code(officer, `/v1/registers/delisted?market_id=${m3}`)).toEqual([422, 'REGISTER_NOT_ENABLED'])
    expect(await code(officer, `/v1/registers/delisted/export?market_id=${m3}`)).toEqual([422, 'REGISTER_NOT_ENABLED'])
    expect(await code(scoped, `/v1/registers/delisted?market_id=${m1}`)).toEqual([404, 'NOT_FOUND'])
    expect(await code(scoped, `/v1/registers/delisted/export?market_id=${m1}`)).toEqual([404, 'NOT_FOUND'])
    expect(await code(officer, `/v1/registers/delisted?market_id=${mb}`)).toEqual([404, 'NOT_FOUND'])
    expect(await code(officerB, `/v1/registers/delisted?market_id=${m1}`)).toEqual([404, 'NOT_FOUND'])
    expect((await get(agent, `/v1/registers/delisted?market_id=${m1}`)).statusCode).toBe(403)
    expect((await get(agent, `/v1/registers/delisted/export?market_id=${m1}`)).statusCode).toBe(403)
    const member = await participant(tenantA, m1, [{ status: 'active', since: new Date() }])
    const portal = await createPortalUser({ tenantId: tenantA, participantId: member.id })
    expect((await get(portal, `/v1/registers/delisted?market_id=${m1}`)).statusCode).toBe(403)
    expect((await get(officer, '/v1/registers/delisted')).statusCode).toBe(400)
    expect((await get(officerB, `/v1/registers/delisted?market_id=${mb}`)).json().data.rows).toEqual([])
  })
})

describe('T-BM-22 escalation cron cpl.grievances.escalate (AC-CPL13-3, TS-68 grievance part)', () => {
  test('once per deadline from due - lead (absent: at due), ack while open, resolution while submitted, approvers mailed', async () => {
    // A tenant of its own, so the mail and audit counts see only these grievances.
    const tenant = (await createTenant()).id
    const lead = await market(tenant, 'DE', PACK)
    const atDue = await market(tenant, 'AT', NOLEAD)
    const recorder = await createSignedInUser({ tenantId: tenant, roles: ['Support agent'] })
    const approver = await createSignedInUser({ tenantId: tenant, roles: ['Compliance officer'], marketIds: [atDue] })
    const all = await createSignedInUser({ tenantId: tenant, roles: ['Compliance officer'] })
    const ackNearLead = await opened(recorder, { type: 'market', id: lead }, ago(25 * HOUR)) // ack due in 23 h, lead 24 h
    const ackLater = await opened(recorder, { type: 'market', id: lead }, ago(HOUR)) // due - lead in 23 h
    const ackBeforeDue = await opened(recorder, { type: 'market', id: atDue }, ago(47 * HOUR)) // no lead: due in 1 h
    const ackPastDue = await opened(recorder, { type: 'market', id: atDue }, ago(49 * HOUR))
    const resolution = await opened(recorder, { type: 'market', id: lead }, ago(29 * DAY + HOUR)) // resolution due in 23 h
    expect((await submit(recorder, resolution)).statusCode).toBe(200)

    const run = () => grievanceEscalationJob.run({ jobId: randomUUID(), log, config: testConfig() })
    const escalations = async () => ownerRows<{ case_id: string; deadline: string; actor_id: string | null; notified: string; due_at: string }>(
      `SELECT case_id, data ->> 'deadline' AS deadline, actor_id, data ->> 'notified' AS notified, data ->> 'due_at' AS due_at
       FROM case_event WHERE tenant_id = $1 AND kind = 'escalated' ORDER BY case_id, deadline`, [tenant])
    await run()
    await run()
    const byCase = new Map((await escalations()).map((row) => [row.case_id, row]))
    expect([...byCase.keys()].sort()).toEqual([ackNearLead, ackPastDue, resolution].sort())
    expect(byCase.has(ackBeforeDue) || byCase.has(ackLater)).toBe(false)
    expect(byCase.get(ackNearLead)).toMatchObject({ deadline: 'ack', actor_id: null, notified: '1' })
    expect(byCase.get(ackPastDue)).toMatchObject({ deadline: 'ack', notified: '2' })
    const submitted = (await call(app, { method: 'GET', url: `/v1/cases/${resolution}`, as: all })).json().data
    expect(byCase.get(resolution)).toMatchObject({ deadline: 'resolution', due_at: new Date(submitted.due_at).toISOString() })
    expect((await auditActions(tenant)).filter((action) => action === 'CASE.ESCALATED')).toHaveLength(3)
    expect(await mailsTo(all.email)).toHaveLength(3)
    expect(await mailsTo(approver.email)).toHaveLength(1)
    expect((await mailsTo(approver.email))[0]).toContain(`The grievance ${ackPastDue} in market AT must be acknowledged by`)

    // Clock fixture: the later grievance's deadline comes nearer (received_at moved back by the owner), so it escalates
    // now, once; the escalated ack does not escalate again, and its acknowledgement then waits for the resolution deadline.
    await ownerRows(`UPDATE case_file SET payload = jsonb_set(payload, '{received_at}', to_jsonb($2::text)) WHERE id = $1`, [ackLater, ago(30 * HOUR)])
    await run()
    await run()
    expect((await escalations()).map((row) => `${row.case_id}:${row.deadline}`).sort())
      .toEqual([`${ackNearLead}:ack`, `${ackPastDue}:ack`, `${resolution}:resolution`, `${ackLater}:ack`].sort())
    expect(await mailsTo(all.email)).toHaveLength(4)
    const register = (await call(app, { method: 'GET', url: `/v1/registers/grievances?case_id=${ackLater}`, as: all })).json().data[0]
    expect(register.escalated).toEqual(['ack'])
  })
})
