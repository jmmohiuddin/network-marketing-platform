import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { ledModule } from '../led/index.js'
import { prvCaseTypes, prvModule } from '../prv/index.js'
import { compModule } from './index.js'
import { activePlan, calculate, commit, createWorld, inside, member, order, ownerUnchecked, ts10Plan, user, type Member, type World } from './test-support.js'

// TS-28 (PLAN B6 section B, TK-B5-13): erasing a payee through PRV's erasure request (prv_erase_participant) leaves the
// committed run replayable to the same result hash, and its postings, result lines, relationships and snapshot unchanged.

let app: FastifyInstance
let w: World
let a: Member
let runId: string
let dpo: TestUser
let dpo2: TestUser
closePoolsAfterAll()

/** Digests of everything the erasure must keep: the run's lines and snapshot, the tenant's postings and relationships. */
async function kept(): Promise<Record<string, string>> {
  const [row] = await ownerRows<Record<string, string>>(
    `SELECT (SELECT md5(string_agg(concat_ws('|', id, payee_participant_id, payee_position_id, rule_key, amount_minor, trace::text), ',' ORDER BY id))
             FROM result_line WHERE run_id = $1) AS lines,
            (SELECT md5(string_agg(concat_ws('|', x.id, x.account_id, x.debit_minor, x.credit_minor), ',' ORDER BY x.id))
             FROM posting x WHERE x.tenant_id = $2) AS postings,
            (SELECT md5(string_agg(concat_ws('|', id, parent_position_id, child_position_id, valid_from, superseded_at), ',' ORDER BY id))
             FROM relationship WHERE tenant_id = $2) AS relationships,
            (SELECT encode(s.content_sha256, 'hex') || ':' || encode(digest(s.content, 'sha256'), 'hex')
             FROM run r JOIN run_snapshot s ON s.id = r.snapshot_id WHERE r.id = $1) AS snapshot,
            (SELECT outputs ->> 'result_hash' FROM run WHERE id = $1) AS result_hash`,
    [runId, w.tenantId],
  )
  return row!
}

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, ledModule, prvModule, createCasModule({ types: prvCaseTypes })] })
  w = await createWorld()
  const c = await member(w, 'DE-C')
  a = await member(w, 'DE-A', c)
  await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
  await order(w, a, inside(w.periods[0]!), 30_000)
  runId = await calculate(app, w, w.periods[0]!.id)
  await commit(app, w, runId)
  // A's payable is paid out (fixture: the net of PAY's instructed and settled entries), so the erasure is not deferred.
  // shortcut: hand-made posting (triggers off) — ledger_post's origin guard needs a real payout_instruction, and PAY's
  // batch, bank-detail and provider fixtures stay out of COMP tests (module boundaries); move to apps/api/test once a
  // COMP + PAY + PRV integration test exists.
  await ownerUnchecked(
    `WITH s AS (INSERT INTO ledger_account (tenant_id, market_id, type, payee_participant_id, currency) VALUES ($1, $2, 'settled_clearing', NULL, 'EUR') RETURNING id),
          p AS (SELECT id, led_balance($2, $3, 'payee_payable') AS amount FROM ledger_account WHERE market_id = $2 AND type = 'payee_payable' AND payee_participant_id = $3),
          g AS (SELECT gen_random_uuid() AS id),
          e AS (INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, created_by, created_by_type)
                SELECT $1, $2, $4, 'payout_settled', 'payout_instruction', g.id, 'instr:' || g.id || ':settled', $5, 'user' FROM g RETURNING id)
     INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency)
     SELECT $1, e.id, p.id, p.amount, 0, 'EUR' FROM e, p UNION ALL SELECT $1, e.id, s.id, 0, p.amount, 'EUR' FROM e, s, p`,
    [w.tenantId, w.marketId, a.participantId, w.periods[0]!.id, w.finance.id])
  ;[dpo, dpo2] = [await user(w.tenantId, ['DPO']), await user(w.tenantId, ['DPO'])]
}, 120_000)

afterAll(async () => {
  await app.close()
})

describe('TS-28 replay after erasure (TK-B5-13)', () => {
  test('the erased payee\'s committed run replays to the same hash; postings, lines, relationships and snapshot are unchanged', async () => {
    const before = await kept()
    const created = await call(app, { method: 'POST', url: '/v1/privacy-requests', as: dpo, idempotencyKey: true, body: { type: 'erasure', received_via: 'Letter', participant_ref: 'DE-A' } })
    expect(created.statusCode, created.body).toBe(201)
    const { id, case_id: caseId } = created.json().data
    const verified = await call(app, { method: 'POST', url: `/v1/privacy-requests/${id}/verify`, as: dpo, body: { method: 'other', subject_participant_id: a.participantId, note: 'Identity document checked' } })
    expect(verified.statusCode, verified.body).toBe(200)
    await call(app, { method: 'PATCH', url: `/v1/cases/${caseId}`, as: dpo, body: { payload: { request_id: id, participant_id: a.participantId, retention_basis: 'Ledger: 10 years' } } })
    expect((await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: dpo, body: {} })).statusCode).toBe(200)

    const erased = await call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as: dpo2, idempotencyKey: true, body: { decision: 'approve', reason: 'Checked by the DPO' } })
    const replayed = await call(app, { method: 'POST', url: `/v1/runs/${runId}/replay`, as: w.analyst })

    expect(erased.statusCode, erased.body).toBe(200)
    const [subject] = await ownerRows<{ display_name: string | null; pseudonymised: boolean }>(
      'SELECT display_name, pseudonymised_at IS NOT NULL AS pseudonymised FROM participant WHERE id = $1', [a.participantId])
    expect(subject).toEqual({ display_name: null, pseudonymised: true })
    expect(replayed.json().data).toMatchObject({ status: 'match', result_hash: before.result_hash })
    expect(await kept()).toEqual(before)
  })
})
