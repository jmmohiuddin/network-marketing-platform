import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, call, closePoolsAfterAll, createPortalUser, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { compCaseTypes, compModule } from './index.js'
import { activePlan, calculate, commit, createWorld, inside, member, order, ownerUnchecked, ts10Plan, type Member, type World } from './test-support.js'

// PLAN B5 section 2.2 over HTTP with real portal sessions (FR-DIST-001/002/003, FR-CAS-003): the session resolves the
// participant, another participant's or tenant's object is 404, a terminated participant reads statements but gets
// 403 PARTICIPANT_TERMINATED on rank and new disputes (D-B5-06), POST /v1/me/disputes replays per Idempotency-Key and
// never replays another participant's response (PLAN B5 section R).

let app: FastifyInstance
let w: World
let a: Member
let runId: string
let lineId: string
let me: TestUser
let peer: TestUser // another participant of the tenant, without lines
let outsider: TestUser // a participant of another tenant
let closed: TestUser // every owned position terminated
closePoolsAfterAll()

const get = (url: string, as: TestUser) => call(app, { method: 'GET', url, as })
const dispute = (as: TestUser, key: string, line = lineId) =>
  call(app, { method: 'POST', url: '/v1/me/disputes', as, idempotencyKey: key, body: { line_id: line, message: 'The rate looks wrong.' } })

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, createCasModule({ types: compCaseTypes })] })
  w = await createWorld()
  const c = await member(w, 'DE-C')
  a = await member(w, 'DE-A', c)
  await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
  await order(w, a, inside(w.periods[0]!), 10_000)
  runId = await calculate(app, w, w.periods[0]!.id)
  await commit(app, w, runId)
  const [line] = await ownerRows<{ id: string }>('SELECT id FROM result_line WHERE run_id = $1 AND payee_position_id = $2 LIMIT 1', [runId, a.positionId])
  lineId = line!.id
  me = await createPortalUser({ tenantId: w.tenantId, participantId: a.participantId })
  peer = await createPortalUser({ tenantId: w.tenantId, participantId: (await member(w, 'DE-P')).participantId })
  const gone = await member(w, 'DE-T')
  await ownerUnchecked(`UPDATE position SET status = 'terminated', status_from = now() WHERE id = $1`, [gone.positionId])
  closed = await createPortalUser({ tenantId: w.tenantId, participantId: gone.participantId })
  const other = await createWorld()
  outsider = await createPortalUser({ tenantId: other.tenantId, participantId: (await member(other, 'DE-X')).participantId })
}, 120_000)

afterAll(async () => {
  await app.close()
})

describe('portal session over HTTP (API-28/29/30)', () => {
  test('the session participant reads its statements, line explanation and rank status', async () => {
    const list = await get('/v1/me/statements', me)
    expect(list.statusCode, list.body).toBe(200)
    expect(list.json().data.map((s: { run_id: string }) => s.run_id)).toEqual([runId])
    expect((await get(`/v1/me/statements/${runId}`, me)).statusCode).toBe(200)
    const csv = await get(`/v1/me/statements/${runId}/download`, me)
    expect([csv.statusCode, csv.headers['content-type']]).toEqual([200, 'text/csv; charset=utf-8'])
    expect((await get(`/v1/me/statement-lines/${lineId}/explanation`, me)).statusCode).toBe(200)
    expect((await get('/v1/me/rank', me)).statusCode).toBe(200)
  })

  test('another participant of the tenant and a participant of another tenant get 404', async () => {
    for (const as of [peer, outsider]) {
      for (const url of [`/v1/me/statements/${runId}`, `/v1/me/statements/${runId}/download`, `/v1/me/statement-lines/${lineId}/explanation`]) {
        expect((await get(url, as)).statusCode, `${url}`).toBe(404)
      }
      expect((await get('/v1/me/statements', as)).json().data).toEqual([])
      expect((await dispute(as, `foreign-${as.id}`)).statusCode).toBe(404)
    }
  })

  test('POST /v1/me/disputes opens once per Idempotency-Key; another participant reusing the key and body never gets the stored response', async () => {
    const key = `dispute-${a.participantId}`
    const opened = await dispute(me, key)
    expect(opened.statusCode, opened.body).toBe(201)
    const replayed = await dispute(me, key)
    expect([replayed.statusCode, replayed.headers['idempotent-replayed'], replayed.json()]).toEqual([201, 'true', opened.json()])
    expect(await ownerRows(`SELECT 1 FROM case_file WHERE type = 'dispute' AND subject_id = $1`, [lineId])).toHaveLength(1)
    expect((await dispute(peer, key)).statusCode).toBe(404)

    const caseId = opened.json().data.case_id as string
    expect((await get('/v1/me/disputes', me)).json().data.map((d: { case_id: string }) => d.case_id)).toEqual([caseId])
    expect((await get(`/v1/me/disputes/${caseId}`, me)).statusCode).toBe(200)
    for (const as of [peer, outsider]) expect((await get(`/v1/me/disputes/${caseId}`, as)).statusCode).toBe(404)
  })

  test('D-B5-06: a terminated participant still reads statements; rank and a new dispute are 403 PARTICIPANT_TERMINATED', async () => {
    expect((await get('/v1/me/statements', closed)).statusCode).toBe(200)
    expect((await get('/v1/me/rank', closed)).json().error.code).toBe('PARTICIPANT_TERMINATED')
    expect((await dispute(closed, 'closed-1')).json().error.code).toBe('PARTICIPANT_TERMINATED')
  })
})
