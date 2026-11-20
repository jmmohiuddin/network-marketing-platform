import { withTenant } from '@nmp/db'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { auditActions, buildTestApp, call, closePoolsAfterAll, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { ledCaseTypes, ledModule } from '../led/index.js'
import { compCaseTypes, compModule } from './index.js'
import {
  activePlan, balance, calculate, commit, createWorld, inside, lateItem, linesOf, member, order, orderEvent, ownerUnchecked, postingsOf,
  ts10Plan, type Member, type World,
} from './test-support.js'

// D-B4-02/07/08: what a commit posts (led_post_run), receivables in the snapshot and netting, the commit's ledger gates
// and the write-off that clears a receivable (TS-38, TS-10, TS-11, T-B4-02/03/05/06/29/30, AC-14.2, AC-20.1/20.3, AC-FIN3-4).

let app: FastifyInstance
closePoolsAfterAll()

// Receivables up to 50.00 are eligible: one approval for every write-off here.
const WRITE_OFFS = { 'write_offs.policy': { eligible_below_minor: '5000', second_approver_above_minor: '100000' } }

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, ledModule, createCasModule({ types: [...compCaseTypes, ...ledCaseTypes] })] })
})

afterAll(async () => {
  await app.close()
})

const review = (runId: string, as: TestUser) => call(app, { method: 'GET', url: `/v1/runs/${runId}/review`, as })
const commitAs = (runId: string, as: TestUser) =>
  call(app, { method: 'POST', url: `/v1/runs/${runId}/commit`, as, idempotencyKey: true, body: { acknowledged_exceptions: [] } })
const entryOf = async (runId: string) => ownerRows('SELECT id FROM journal_entry WHERE origin_id = $1', [runId])

interface Chain { w: World; a: Member; c: Member; receivableRun: string }

/**
 * TS-10 world: P0 A (sponsored by C) orders 300.00 and 500.00 (5 units), committed (A 80.00, C 16.00); P1 has no orders
 * and commits without an entry; then A's payable is paid out (fixture entry); a late refund of 4 units claws back
 * A -40.00 in P2 with nothing payable: receivable 40.00 (AC-20.1).
 */
async function clawedBack(): Promise<Chain> {
  const w = await createWorld({ settings: WRITE_OFFS })
  const c = await member(w, 'DE-C')
  const a = await member(w, 'DE-A', c)
  await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
  await order(w, a, inside(w.periods[0]!), 30_000)
  const units = await order(w, a, inside(w.periods[0]!, 2), 50_000, { quantity: 5 })
  await commit(app, w, await calculate(app, w, w.periods[0]!.id))
  const empty = await calculate(app, w, w.periods[1]!.id)
  expect((await commit(app, w, empty)).journal_entry_id).toBeNull()
  // Fixture: the payout of A's 80.00 (PAY posts it in B4 through batches; collapsed to one entry on the empty run here).
  const [{ approval_id: approvalId }] = await ownerRows<{ approval_id: string }>('SELECT approval_id FROM run WHERE id = $1', [empty]) as [{ approval_id: string }]
  await withTenant({ tenantId: w.tenantId, userId: w.finance.id }, (tx) => tx.query(
    `SELECT ledger_post($1, $2, 'run_committed', 'run', $3, $4, $5, $6)`,
    [w.marketId, w.periods[1]!.id, empty, `run:${empty}`, approvalId, JSON.stringify([
      { type: 'payee_payable', payee_participant_id: a.participantId, debit_minor: '8000', credit_minor: '0' },
      { type: 'settled_clearing', payee_participant_id: null, debit_minor: '0', credit_minor: '8000' },
    ])],
  ))
  await lateItem(w, { eventId: await orderEvent(w, units, inside(w.periods[2]!), 'refund', { quantity: 4 }) }, w.periods[0]!.id)
  const receivableRun = await calculate(app, w, w.periods[2]!.id)
  await commit(app, w, receivableRun)
  return { w, a, c, receivableRun }
}

async function writeOff(w: World, a: Member, amount: string): Promise<{ statusCode: number; caseId: string }> {
  const { caseId, decide } = await writeOffSubmitted(w, a, amount)
  return { statusCode: (await decide()).statusCode, caseId }
}

async function writeOffSubmitted(w: World, a: Member, amount: string) {
  const receivables = await call(app, { method: 'GET', url: `/v1/ledger/receivables?market_id=${w.marketId}`, as: w.analyst })
  const accountId = (receivables.json().data as { participant: { id: string }; account_id: string }[]).find((r) => r.participant.id === a.participantId)!.account_id
  const opened = await call(app, {
    method: 'POST', url: '/v1/cases', as: w.analyst, idempotencyKey: true,
    body: { type: 'write_off', subject_type: 'ledger_account', subject_id: accountId, reason_code: 'NO_FUTURE_EARNINGS', payload: { amount_minor: amount, note: 'Left the business' } },
  })
  expect(opened.statusCode, opened.body).toBe(201)
  const caseId = opened.json().data.id as string
  expect((await call(app, { method: 'POST', url: `/v1/cases/${caseId}/submit`, as: w.analyst, body: {} })).statusCode).toBe(200)
  const decide = () => call(app, { method: 'POST', url: `/v1/cases/${caseId}/decision`, as: w.finance, idempotencyKey: true, body: { decision: 'approve', reason: 'Policy applies' } })
  return { caseId, decide }
}

describe('posting at commit (FR-FIN-001, D-B4-02)', () => {
  test('TS-38 / AC-14.2 / T-B4-03: residue and control mismatches roll back (500); a fixture withholding posts expense = payable + withholding', async () => {
    const w = await createWorld()
    const a = await member(w, 'DE-A')
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    await order(w, a, inside(w.periods[0]!), 1_234_560)
    const runId = await calculate(app, w, w.periods[0]!.id)
    expect(await ownerRows('SELECT gross_minor::text, receivable_before_minor::text, netted_minor::text, net_payable_minor::text FROM run_settlement WHERE run_id = $1', [runId]))
      .toEqual([{ gross_minor: '123456', receivable_before_minor: '0', netted_minor: '0', net_payable_minor: '123456' }])
    await review(runId, w.analyst)

    await ownerUnchecked(`UPDATE run SET totals = jsonb_set(totals, '{residue_minor}', '"1"') WHERE id = $1`, [runId])
    expect((await commitAs(runId, w.finance)).json().error.code).toBe('INVARIANT_FAILED')
    await ownerUnchecked(`UPDATE run SET totals = jsonb_set(totals, '{residue_minor}', '"0"') WHERE id = $1`, [runId])
    await ownerUnchecked('DELETE FROM run_settlement WHERE run_id = $1', [runId])
    await ownerUnchecked(
      `INSERT INTO run_settlement (tenant_id, run_id, payee_participant_id, gross_minor, receivable_before_minor, netted_minor, withheld_minor, net_payable_minor)
       VALUES ($1, $2, $3, 123455, 0, 0, 0, 123455)`, [w.tenantId, runId, a.participantId])
    expect((await commitAs(runId, w.finance)).json().error.code).toBe('INVARIANT_FAILED')
    expect(await ownerRows(`SELECT 1 FROM run WHERE id = $1 AND state = 'calculated'`, [runId])).toHaveLength(1)
    expect(await entryOf(runId)).toHaveLength(0)

    // TS-38: the posting builder fed a settlement of gross 1,234.56 with 24.69 withheld.
    await ownerUnchecked('DELETE FROM run_settlement WHERE run_id = $1', [runId])
    await ownerUnchecked(
      `INSERT INTO run_settlement (tenant_id, run_id, payee_participant_id, gross_minor, receivable_before_minor, netted_minor, withheld_minor, net_payable_minor)
       VALUES ($1, $2, $3, 123456, 0, 0, 2469, 120987)`, [w.tenantId, runId, a.participantId])
    const committed = await commitAs(runId, w.finance)
    expect(committed.statusCode, committed.body).toBe(200)
    const entryId = committed.json().data.journal_entry_id as string
    expect(await postingsOf(runId)).toEqual([
      ['commission_expense', null, '123456', '0'], ['payee_payable', a.participantId, '0', '120987'], ['withholding_payable', null, '0', '2469'],
    ])
    expect(await ownerRows(`SELECT idempotency_key, event_type, period_id FROM journal_entry WHERE id = $1`, [entryId]))
      .toEqual([{ idempotency_key: `run:${runId}`, event_type: 'run_committed', period_id: w.periods[0]!.id }])
    const detail = await call(app, { method: 'GET', url: `/v1/runs/${runId}`, as: w.analyst })
    expect(detail.json().data.journal_entry_id).toBe(entryId)
  })

  test('T-B4-02 positive and negative with payable (AC-FIN3-1): A 80.00 + C 16.00 posted, then a -50.00 clawback reduces the payable', async () => {
    const w = await createWorld()
    const c = await member(w, 'DE-C')
    const a = await member(w, 'DE-A', c)
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    await order(w, a, inside(w.periods[0]!), 30_000)
    const o2 = await order(w, a, inside(w.periods[0]!, 2), 50_000)
    const first = await calculate(app, w, w.periods[0]!.id)
    expect((await commit(app, w, first)).journal_entry_id).toEqual(expect.any(String))
    expect(await postingsOf(first)).toEqual(expect.arrayContaining([
      ['commission_expense', null, '9600', '0'], ['payee_payable', a.participantId, '0', '8000'], ['payee_payable', c.participantId, '0', '1600'],
    ]))
    expect(await postingsOf(first)).toHaveLength(3)

    await lateItem(w, { eventId: await orderEvent(w, o2, inside(w.periods[1]!)) }, w.periods[0]!.id)
    const next = await calculate(app, w, w.periods[1]!.id)
    expect((await linesOf(next)).map((l) => [l.origin, l.amount])).toEqual([['clawback', '-5000']])
    await commit(app, w, next)
    expect(await postingsOf(next)).toEqual([['commission_expense', null, '0', '5000'], ['payee_payable', a.participantId, '5000', '0']])
    expect([await balance(w, a.participantId, 'payee_payable'), await balance(w, a.participantId, 'clawback_receivable')]).toEqual(['3000', '0'])
    expect(await auditActions(w.tenantId)).toContain('RUN.COMMITTED')
  })

  test('AC-20.1 / TS-10 / TS-11 / T-B4-05: clawback with nothing payable -> receivable 40.00; next earnings 25.00 netted; write-off clears 15.00', async () => {
    const { w, a, c, receivableRun } = await clawedBack()
    expect((await linesOf(receivableRun)).map((l) => [l.origin, l.amount])).toEqual([['clawback', '-4000']])
    expect(await postingsOf(receivableRun)).toEqual([['clawback_receivable', a.participantId, '4000', '0'], ['commission_expense', null, '0', '4000']])
    expect([await balance(w, a.participantId, 'payee_payable'), await balance(w, a.participantId, 'clawback_receivable')]).toEqual(['0', '4000'])

    await order(w, a, inside(w.periods[3]!), 50_000)
    const earning = await calculate(app, w, w.periods[3]!.id)
    const [snapshot] = await ownerRows<{ adjustments: number }>(
      `SELECT (row_counts ->> 'adjustments')::int AS adjustments FROM run_snapshot s JOIN run r ON r.snapshot_id = s.id WHERE r.id = $1`, [earning])
    expect(snapshot!.adjustments).toBe(0)
    expect(await ownerRows(
      `SELECT payee_participant_id AS payee, gross_minor::text AS gross, receivable_before_minor::text AS before, netted_minor::text AS netted,
              net_payable_minor::text AS net FROM run_settlement WHERE run_id = $1 ORDER BY gross_minor`, [earning]))
      .toEqual([{ payee: c.participantId, gross: '500', before: '0', netted: '0', net: '500' }, { payee: a.participantId, gross: '2500', before: '4000', netted: '2500', net: '0' }])
    await commit(app, w, earning)
    expect([await balance(w, a.participantId, 'payee_payable'), await balance(w, a.participantId, 'clawback_receivable')]).toEqual(['0', '1500'])
    const balances = await call(app, { method: 'GET', url: `/v1/payees/${a.participantId}/balances`, as: w.finance })
    expect(balances.json().data).toEqual([{ market: { id: w.marketId, code: 'DE', currency: 'EUR' }, payable_minor: '0', in_transit_minor: '0', receivable_minor: '1500' }])
    const { statusCode, caseId } = await writeOff(w, a, '1500')
    expect(statusCode).toBe(200)
    expect([await balance(w, a.participantId, 'clawback_receivable'), await balance(w, null, 'write_off')]).toEqual(['0', '1500'])
    expect(await ownerRows(`SELECT idempotency_key, event_type FROM journal_entry WHERE origin_id = $1`, [caseId]))
      .toEqual([{ idempotency_key: `writeoff:${caseId}`, event_type: 'write_off' }])
    expect(await auditActions(w.tenantId)).toContain('LEDGER.WRITE_OFF_POSTED')
  })

  test('T-B4-06 / AC-FIN3-2: a write-off posted between calculation and commit supersedes the run (receivables_changed)', async () => {
    const { w, a } = await clawedBack()
    await order(w, a, inside(w.periods[3]!), 50_000)
    const stale = await calculate(app, w, w.periods[3]!.id)
    expect((await writeOff(w, a, '1000')).statusCode).toBe(200)
    await review(stale, w.analyst)
    const refused = await commitAs(stale, w.finance)
    expect(refused.json().error).toMatchObject({ code: 'RUN_SUPERSEDED', details: { reason: 'receivables_changed', participant_ids: [a.participantId] } })
    expect(await entryOf(stale)).toHaveLength(0)
    expect(await ownerRows(`SELECT 1 FROM run WHERE id = $1 AND state = 'calculated'`, [stale])).toHaveLength(1)

    await commit(app, w, await calculate(app, w, w.periods[3]!.id))
    expect([await balance(w, a.participantId, 'payee_payable'), await balance(w, a.participantId, 'clawback_receivable')]).toEqual(['0', '500'])

    // D-B4-08: a receivable that shrank after submit refuses the approval (409), nothing posted, the case stays submitted.
    const { caseId, decide } = await writeOffSubmitted(w, a, '500')
    const holder = await getOwnerPool().connect()
    try {
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('ledger:' || $1 || ':' || $2, 0))`, [w.tenantId, w.marketId])
      expect((await decide()).json().error.code).toBe('LEDGER_BUSY')
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
    }
    const [account] = await ownerRows<{ id: string }>(`SELECT id FROM ledger_account WHERE type = 'clawback_receivable' AND payee_participant_id = $1`, [a.participantId])
    const [expense] = await ownerRows<{ id: string }>(`SELECT id FROM ledger_account WHERE type = 'commission_expense' AND market_id = $1`, [w.marketId])
    await ownerUnchecked(
      `WITH e AS (INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id, created_by, created_by_type)
                  SELECT $1, $2, $3, 'run_committed', 'run', x.id, 'run:' || x.id, gen_random_uuid(), $4, 'user' FROM (SELECT gen_random_uuid() AS id) x RETURNING id)
       INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency)
       SELECT $1, e.id, v.account, v.debit, v.credit, 'EUR' FROM e, (VALUES ($5::uuid, 100, 0), ($6::uuid, 0, 100)) AS v (account, debit, credit)`,
      [w.tenantId, w.marketId, w.periods[3]!.id, w.finance.id, expense!.id, account!.id])
    expect((await decide()).json().error).toMatchObject({ code: 'RECEIVABLE_CHANGED', details: { receivable_minor: '400' } })
    expect(await ownerRows('SELECT state FROM case_file WHERE id = $1', [caseId])).toEqual([{ state: 'submitted' }])
    expect(await ownerRows('SELECT 1 FROM journal_entry WHERE origin_id = $1', [caseId])).toHaveLength(0)
  })

  test('D-B6-04: approving a write-off when every committed or paid period of the market is closed is refused 422 NO_COMMITTED_PERIOD', async () => {
    const { w, a } = await clawedBack()
    const { caseId, decide } = await writeOffSubmitted(w, a, '1000')
    await ownerUnchecked(
      `UPDATE period SET state = 'closed', closed_at = now(), closed_by = $2, close_note = 'Closed (fixture)'
       WHERE state IN ('committed', 'paid') AND calendar_id IN (SELECT id FROM calendar WHERE market_id = $1)`, [w.marketId, w.finance.id])
    expect((await decide()).json().error.code).toBe('NO_COMMITTED_PERIOD')
    expect(await ownerRows('SELECT state FROM case_file WHERE id = $1', [caseId])).toEqual([{ state: 'submitted' }])
    expect(await ownerRows('SELECT 1 FROM journal_entry WHERE origin_id = $1', [caseId])).toHaveLength(0)
  })

  test('T-B4-29 / AC-FIN3-4: a late refund of a Paid period is consumed by the next run (clawback line, item consumed at commit)', async () => {
    const w = await createWorld()
    const a = await member(w, 'DE-A')
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    const sold = await order(w, a, inside(w.periods[0]!), 50_000)
    await commit(app, w, await calculate(app, w, w.periods[0]!.id))
    // Fixture: P0 paid out (PAY flips it to paid once its batches are terminal).
    await ownerUnchecked(`UPDATE period SET state = 'paid' WHERE id = $1`, [w.periods[0]!.id])
    const late = await lateItem(w, { eventId: await orderEvent(w, sold, inside(w.periods[1]!)) }, w.periods[0]!.id)
    const next = await calculate(app, w, w.periods[1]!.id)
    expect((await linesOf(next)).map((l) => [l.origin, l.amount])).toEqual([['clawback', '-2500']])
    await commit(app, w, next)
    expect(await ownerRows('SELECT state, consumed_by_run_id FROM late_transaction WHERE id = $1', [late]))
      .toEqual([{ state: 'consumed', consumed_by_run_id: next }])
    expect(await balance(w, a.participantId, 'payee_payable')).toBe('0')
  })

  test('T-B4-30: a calculated run with lines but no settlement (calculated before B4) is superseded before any write', async () => {
    const w = await createWorld()
    const a = await member(w, 'DE-A')
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    await order(w, a, inside(w.periods[0]!), 10_000)
    const runId = await calculate(app, w, w.periods[0]!.id)
    await ownerUnchecked('DELETE FROM run_settlement WHERE run_id = $1', [runId])
    await review(runId, w.analyst)
    expect((await commitAs(runId, w.finance)).json().error).toMatchObject({ code: 'RUN_SUPERSEDED', details: { reason: 'settlement_missing' } })
    expect(await ownerRows(`SELECT state FROM period WHERE id = $1`, [w.periods[0]!.id])).toEqual([{ state: 'calculated' }])
  })
})
