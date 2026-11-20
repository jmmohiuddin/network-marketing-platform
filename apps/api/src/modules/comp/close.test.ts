import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, createSignedInUser, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { ledModule } from '../led/index.js'
import { compModule } from './index.js'
import { activePlan, calculate, commit, createWorld, inside, lateItem, member, migrationAt, order, ownerUnchecked, ts10Plan, user, type Member, type World } from './test-support.js'

// T-B6-50 period close (PLAN B6 D-B6-04, section 2.2; AC-CLS-1, AC-CLS-2 route part, AC-CLS-3). Blocker kinds, the guard,
// the closed-period posting refusal and the attribution skip are the DB agent's T-B6-51.

let app: FastifyInstance
let w: World
let a: Member
let c: Member
let paidId: string
let emptyPaidId: string
let committedId: string
let migrationId: string
closePoolsAfterAll()

const close = (periodId: string, as: TestUser, body: unknown = { note: 'Reconciled and signed off.' }, idempotencyKey: string | true = true) =>
  call(app, { method: 'POST', url: `/v1/periods/${periodId}/close`, as, body, idempotencyKey })
const check = (periodId: string, as: TestUser = w.finance) => call(app, { method: 'GET', url: `/v1/periods/${periodId}/close-check`, as })

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, ledModule] })
  w = await createWorld()
  c = await member(w, 'DE-C')
  a = await member(w, 'DE-A', c)
  await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
  await order(w, a, inside(w.periods[0]!), 30_000)
  await order(w, a, inside(w.periods[2]!), 10_000)
  for (const period of w.periods.slice(0, 3)) await commit(app, w, await calculate(app, w, period.id))
  ;[paidId, emptyPaidId, committedId] = w.periods.slice(0, 3).map((p) => p.id) as [string, string, string]
  // The cutover opening of a signed-off migration posted into the paid period (D-B6-10): A owed 12.50, C owes 3.00.
  const migration = await migrationAt(w, paidId, 'signed_off')
  migrationId = migration.id
  await ownerUnchecked(
    `INSERT INTO migration_opening_balance (tenant_id, migration_id, participant_id, amount_minor) VALUES ($1, $2, $3, 1250), ($1, $2, $4, -300)`,
    [w.tenantId, migrationId, a.participantId, c.participantId])
  await withTenant({ tenantId: w.tenantId, userId: w.finance.id }, (tx) => tx.query('SELECT led_post_migration_opening($1, $2)', [migrationId, migration.openingApprovalId]))
  await ownerUnchecked(`UPDATE period SET state = 'paid' WHERE id = ANY ($1::uuid[])`, [[paidId, emptyPaidId]])
}, 120_000)

afterAll(async () => {
  await app.close()
})

describe('T-B6-50 POST /v1/periods/:id/close and GET …/close-check (D-B6-04)', () => {
  test('AC-CLS-3: period.close is required (403), step-up (403 STEP_UP_REQUIRED); another market or tenant is 404; the note is validated', async () => {
    expect((await close(paidId, w.analyst)).statusCode).toBe(403)
    const stale = await createSignedInUser({ tenantId: w.tenantId, roles: ['Finance approver'], stepUp: false })
    expect((await close(paidId, stale)).json().error.code).toBe('STEP_UP_REQUIRED')
    const [fr] = await ownerRows<{ id: string }>(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
       VALUES ($1, 'FR', 'EUR', 2, 'Europe/Paris', '{fr}', 'none', 'live') RETURNING id`, [w.tenantId])
    const frFinance = await user(w.tenantId, ['Finance approver'], [fr!.id])
    expect((await close(paidId, frFinance)).statusCode).toBe(404)
    expect((await check(paidId, frFinance)).statusCode).toBe(404)
    const stranger = (await createWorld()).finance
    expect((await close(paidId, stranger)).statusCode).toBe(404)
    expect((await check(paidId, stranger)).statusCode).toBe(404)
    expect((await close(paidId, w.finance, { note: '' })).statusCode).toBe(400)
    expect((await close(paidId, w.finance, {})).statusCode).toBe(400)
  })

  test('AC-CLS-1: a committed period is 409 PERIOD_NOT_PAID {state}', async () => {
    const response = await close(committedId, w.finance)
    expect(response.statusCode).toBe(409)
    expect(response.json().error).toMatchObject({ code: 'PERIOD_NOT_PAID', details: { state: 'committed' } })
  })

  test('AC-CLS-2: an unmapped account type is 422 GL_MAPPING_MISSING and the period stays paid; the check lists it', async () => {
    const before = (await check(paidId)).json().data
    expect(before).toMatchObject({ state: 'paid', closable: false, blockers: [] })
    expect(before.gl_unmapped).toEqual(expect.arrayContaining(['commission_expense', 'migration_clearing', 'payee_payable', 'clawback_receivable']))
    const refused = await close(paidId, w.finance)
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'GL_MAPPING_MISSING', details: { account_types: before.gl_unmapped } })
    expect((await ownerRows<{ state: string }>('SELECT state FROM period WHERE id = $1', [paidId]))[0]!.state).toBe('paid')
    for (const type of before.gl_unmapped as string[]) {
      const mapped = await call(app, { method: 'PUT', url: `/v1/ledger/gl-mappings/${w.marketId}/${type}`, as: w.finance, body: { gl_code: `GL-${type}` } })
      expect(mapped.statusCode, mapped.body).toBe(200)
    }
  })

  test('AC-CLS-2: a blocker is 422 PERIOD_CLOSE_BLOCKED listing it, and the check shows it', async () => {
    const lateId = await lateItem(w, { orderId: (await ownerRows<{ id: string }>('SELECT id FROM sales_order WHERE market_id = $1 LIMIT 1', [w.marketId]))[0]!.id }, paidId)
    const blocker = { kind: 'late_item_pending', id: lateId, late_id: lateId }
    expect((await check(paidId)).json().data).toMatchObject({ state: 'paid', closable: false, blockers: [blocker], gl_unmapped: [] })
    const refused = await close(paidId, w.finance)
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'PERIOD_CLOSE_BLOCKED', details: { blockers: [blocker] } })
    await ownerUnchecked('DELETE FROM late_transaction WHERE id = $1', [lateId])
    expect((await check(paidId)).json().data).toMatchObject({ closable: true, blockers: [], gl_unmapped: [] })
  })

  test('AC-CLS-1: closed with the GL export of the period (migration_opening lines, debits = credits), outbox, audit, period reads; replay; closed is final', async () => {
    const key = randomUUID()
    const closed = await close(paidId, w.finance, { note: 'Reconciled and signed off.' }, key)
    expect(closed.statusCode, closed.body).toBe(200)
    const data = closed.json().data
    expect(data).toMatchObject({ period: { id: paidId, state: 'closed', closed_at: expect.any(String), closed_by: w.finance.id }, journal_export_id: expect.any(String) })
    const [exported] = await ownerRows<{ debit: string; credit: string; content: Buffer }>(
      'SELECT debit_total_minor::text AS debit, credit_total_minor::text AS credit, content FROM journal_export WHERE id = $1', [data.journal_export_id])
    expect(exported!.debit).toBe(exported!.credit)
    const csv = gunzipSync(exported!.content).toString()
    expect(csv).toContain('GL-migration_clearing,migration_clearing,migration,')
    expect((await call(app, { method: 'GET', url: '/v1/ledger/journal-exports', as: w.finance })).json().data)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: data.journal_export_id, created_at_close: true })]))
    const detail = (await call(app, { method: 'GET', url: `/v1/periods/${paidId}`, as: w.analyst })).json().data
    expect(detail).toMatchObject({ state: 'closed', closed_by: w.finance.id, close_note: 'Reconciled and signed off.', close_journal_export_id: data.journal_export_id })
    const listed = (await call(app, { method: 'GET', url: `/v1/periods?state=closed`, as: w.analyst })).json().data.periods
    expect(listed).toEqual([expect.objectContaining({ id: paidId, close_journal_export_id: data.journal_export_id })])
    expect(await ownerRows(`SELECT payload FROM outbox_event WHERE topic = 'period.closed'`)).toEqual([{
      payload: { period_id: paidId, calendar_id: w.calendarId, market_id: w.marketId, journal_export_id: data.journal_export_id },
    }])
    expect(await auditActions(w.tenantId)).toEqual(expect.arrayContaining(['PERIOD.CLOSED', 'JOURNAL_EXPORT.CREATED']))
    const replay = await close(paidId, w.finance, { note: 'Reconciled and signed off.' }, key)
    expect(replay.json().data).toEqual(data)
    const again = await close(paidId, w.finance)
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toMatchObject({ code: 'PERIOD_NOT_PAID', details: { state: 'closed' } })
    expect((await check(paidId)).json().data).toMatchObject({ state: 'closed', closable: false })
  })

  test('AC-CLS-1: a paid period without ledger entries closes without an export', async () => {
    const closed = await close(emptyPaidId, w.finance)
    expect(closed.statusCode, closed.body).toBe(200)
    expect(closed.json().data).toMatchObject({ period: { state: 'closed' }, journal_export_id: null })
    expect(await ownerRows(`SELECT payload ->> 'journal_export_id' AS id FROM outbox_event WHERE topic = 'period.closed' AND payload ->> 'period_id' = $1`, [emptyPaidId]))
      .toEqual([{ id: null }])
  })
})
