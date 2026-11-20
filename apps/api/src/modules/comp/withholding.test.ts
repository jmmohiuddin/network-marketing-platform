import { withTenant } from '@nmp/db'
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, call, closePoolsAfterAll, createPortalUser, ownerRows, resetApiDb, runQueuedJobs } from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { compCaseTypes, compModule } from './index.js'
import { simulationJob } from './simulations.js'
import { readSnapshot, type StoredInstruction } from './snapshot.js'
import { activePlan, calculate, commit, createWorld, inside, lateItem, member, order, orderEvent, postingsOf, ts10Plan, user, type Member, type World } from './test-support.js'

// PLAN B-MKT D-BM-03/04: T-BM-03 the run snapshot's withholding instructions, tax_line writes and review warnings,
// T-BM-04 the statement's withholding detail, TS-38 end to end, AC-TAX2-2 refusals. Packs are TEST FIXTURES ONLY
// (hypothetical values, not recommendations, DEC-14), written by the owner as migrations would.

let app: FastifyInstance
closePoolsAfterAll()

const RULE = 'fx-comp-wh@2020-01-01'
const NO_DUTY = 'fx-comp-nd@2020-01-01'

async function fixturePacks(): Promise<void> {
  const owner = getOwnerPool()
  const basis = `true, '2020-01-01', 'test fixture, not a real tax rule', 'screening', 'test fixture'`
  await owner.query(
    `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rate, threshold_minor, threshold_basis, missing_id_rate, rounding, mandatory,
       effective_from, basis, basis_status, source_ref)
     VALUES ('${RULE}', 'fx-comp-wh', 'FIXTURE withholding', 'withholding', '{}', 0.020000, 2350, 'current_year_cumulative', 0.200000, 'half_up', ${basis}),
            ('${NO_DUTY}', 'fx-comp-nd', 'FIXTURE no duty', 'withholding', '{"residency": ["DE"]}', NULL, NULL, NULL, NULL, 'none', ${basis}),
            ('fx-comp-amb-1@2020-01-01', 'fx-comp-amb', 'FIXTURE one', 'withholding', '{}', 0.010000, NULL, NULL, NULL, 'half_up', ${basis}),
            ('fx-comp-amb-2@2020-01-01', 'fx-comp-amb', 'FIXTURE two', 'withholding', '{}', 0.020000, NULL, NULL, NULL, 'half_up', ${basis}),
            ('fx-comp-noyear@2020-01-01', 'fx-comp-noyear', 'FIXTURE no year', 'withholding', '{}', 0.020000, 100, 'current_year_cumulative', NULL,
             'half_up', ${basis})
     ON CONFLICT (id) DO NOTHING`,
  )
  await owner.query(
    `INSERT INTO pack_rule (id, market_pack, kind, title, params, mandatory, basis, basis_status, source_ref, effective_from)
     VALUES ('fx-comp-wh-year@2020-01-01', 'fx-comp-wh', 'tax_year', 'FIXTURE calendar tax year', '{"start_month": 1, "start_day": 1}', true,
             'test fixture', 'screening', 'test fixture', '2020-01-01')
     ON CONFLICT (id) DO NOTHING`,
  )
}

async function taxProfile(w: World, m: Member, options: { taxId?: boolean; residency?: string } = {}): Promise<void> {
  const sealed = options.taxId === false ? null : 'fixture-sealed'
  await ownerRows(
    `INSERT INTO tax_profile (tenant_id, participant_id, residency, entity_type, tax_id_sealed, tax_id_masked, valid_from, created_by)
     VALUES ($1, $2, $3, 'individual', $4, $5, '2020-01-01', $6)`,
    [w.tenantId, m.participantId, options.residency ?? 'DE', sealed, sealed === null ? null : '****1234', w.analyst.id],
  )
}

type TaxLineRow = { payee: string; rule_id: string; taxable: string; withheld: string; rate: string; rate_basis: string; tax_year: number; tax_date: string }

const taxLines = (runId: string) => ownerRows<TaxLineRow>(
  `SELECT payee_participant_id AS payee, rule_id, taxable_minor::text AS taxable, withheld_minor::text AS withheld, rate::text, rate_basis, tax_year,
          to_char(tax_date, 'YYYY-MM-DD') AS tax_date
   FROM tax_line WHERE run_id = $1 ORDER BY withheld_minor DESC, taxable_minor DESC`, [runId])

/** The period's pay date in the market zone and its calendar year (the fixture tax year starts on 1 January). */
async function taxDateOf(periodId: string): Promise<{ tax_date: string; tax_year: number }> {
  const [row] = await ownerRows<{ tax_date: string; tax_year: number }>(
    `SELECT to_char(((ends_at - interval '1 microsecond') AT TIME ZONE 'Europe/Berlin')::date, 'YYYY-MM-DD') AS tax_date,
            extract(year FROM (ends_at - interval '1 microsecond') AT TIME ZONE 'Europe/Berlin')::int AS tax_year
     FROM period WHERE id = $1`, [periodId])
  return row!
}

const warningsOf = async (runId: string): Promise<{ code: string; ref: string | null }[]> =>
  (await ownerRows<{ outputs: { warnings: { code: string; ref: string | null }[] } }>('SELECT outputs FROM run WHERE id = $1', [runId]))[0]!.outputs.warnings

beforeAll(async () => {
  await resetApiDb()
  await fixturePacks()
  app = await buildTestApp({ modules: [compModule, createCasModule({ types: compCaseTypes })] })
}, 60_000)

afterAll(async () => {
  await app.close()
})

describe('T-BM-03 / TS-38 withholding from the market pack (D-BM-03, D-BM-04)', () => {
  let w: World
  let a: Member // TS-38: gross 1,234.56, tax id
  let b: Member // 23.50: at the threshold
  let c: Member // 23.51: above it
  let d: Member // 100.00 without a tax id
  let runId: string

  beforeAll(async () => {
    w = await createWorld({ market: { code: 'DE', pack: 'fx-comp-wh' } })
    a = await member(w, 'DE-A')
    b = await member(w, 'DE-B')
    c = await member(w, 'DE-C')
    d = await member(w, 'DE-D')
    await Promise.all([taxProfile(w, a), taxProfile(w, b), taxProfile(w, c), taxProfile(w, d, { taxId: false })])
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    // ts10Plan rank_bonus: 5 % of gv (R1), 10 % from gv 700.00 (R2); nobody is sponsored, so nothing is matched.
    await order(w, a, inside(w.periods[0]!), 1_234_560) // R2: 1,234.56
    await order(w, b, inside(w.periods[0]!), 47_000) // R1: 23.50
    await order(w, c, inside(w.periods[0]!), 47_020) // R1: 23.51
    await order(w, d, inside(w.periods[0]!), 100_000) // R2: 100.00
    runId = await calculate(app, w, w.periods[0]!.id)
  }, 120_000)

  test('the stored snapshot holds one instruction per payee: rate, rounding, threshold with prior and the SQL basis', async () => {
    const [run] = await ownerRows<{ snapshot_id: string }>('SELECT snapshot_id FROM run WHERE id = $1', [runId])
    const snapshot = await withTenant({ tenantId: w.tenantId, userId: w.analyst.id }, (tx) => readSnapshot(tx, run!.snapshot_id))
    const byPayee = new Map((snapshot.withholding as readonly StoredInstruction[]).map((i) => [i.participantId, i]))
    expect(byPayee.get(a.participantId)).toEqual({
      participantId: a.participantId, ruleId: RULE, rate: '0.020000', rounding: 'half_up', threshold: { limitMinor: 2350n, priorMinor: 0n }, rateBasis: 'rate',
    })
    expect(byPayee.get(d.participantId)).toMatchObject({ rate: '0.200000', rateBasis: 'missing_id_rate' })
  })

  test('TS-38 / AC-18.1 / AC-19.1: one tax line per payee; at the threshold nothing is withheld, above it 2 %, without a tax id 20 %', async () => {
    const { tax_date, tax_year } = await taxDateOf(w.periods[0]!.id)
    const at = { rule_id: RULE, tax_year, tax_date }
    expect(await taxLines(runId)).toEqual([
      { payee: a.participantId, taxable: '123456', withheld: '2469', rate: '0.020000', rate_basis: 'rate', ...at },
      { payee: d.participantId, taxable: '10000', withheld: '2000', rate: '0.200000', rate_basis: 'missing_id_rate', ...at },
      { payee: c.participantId, taxable: '2351', withheld: '47', rate: '0.020000', rate_basis: 'rate', ...at },
      { payee: b.participantId, taxable: '2350', withheld: '0', rate: '0.000000', rate_basis: 'below_threshold', ...at },
    ])
    expect(await ownerRows(
      `SELECT s.payee_participant_id FROM run_settlement s LEFT JOIN tax_line t ON t.run_id = s.run_id AND t.payee_participant_id = s.payee_participant_id
       WHERE s.run_id = $1 AND s.withheld_minor IS DISTINCT FROM t.withheld_minor`, [runId])).toEqual([]) // AC-TAX2-3
    expect((await warningsOf(runId)).filter((x) => x.code === 'NO_WITHHOLDING_RULE')).toEqual([])
  })

  test('TS-38: commit posts payable 1,209.87 and withholding 24.69 against expense 1,234.56; the replay hashes the same', async () => {
    await commit(app, w, runId)
    const [settlement] = await ownerRows<{ net: string; withheld: string }>(
      'SELECT net_payable_minor::text AS net, withheld_minor::text AS withheld FROM run_settlement WHERE run_id = $1 AND payee_participant_id = $2',
      [runId, a.participantId])
    expect(settlement).toEqual({ net: '120987', withheld: '2469' })
    const postings = await postingsOf(runId)
    const net = (type: string) => postings.filter((r) => r[0] === type).reduce((sum, r) => sum + BigInt(r[3]) - BigInt(r[2]), 0n)
    expect(postings.filter((r) => r[0] === 'payee_payable' && r[1] === a.participantId)).toEqual([['payee_payable', a.participantId, '0', '120987']])
    expect(net('withholding_payable')).toBe(2469n + 2000n + 47n) // ledger credit = Σ tax_line.withheld
    expect(-net('commission_expense')).toBe(net('payee_payable') + net('withholding_payable')) // the run entry balances
    const replay = await call(app, { method: 'POST', url: `/v1/runs/${runId}/replay`, as: w.analyst })
    expect(replay.statusCode, replay.body).toBe(200)
    expect(replay.json().data.status).toBe('match')
  })

  test('T-BM-04: the statement shows the withholding rule, rate and basis beside withheld_minor', async () => {
    const statementOf = async (m: Member) => {
      const portal = await createPortalUser({ tenantId: w.tenantId, participantId: m.participantId })
      const response = await call(app, { method: 'GET', url: `/v1/me/statements/${runId}`, as: portal })
      expect(response.statusCode, response.body).toBe(200)
      return response.json().data.summary
    }
    expect(await statementOf(a)).toMatchObject({ gross_minor: '123456', withheld_minor: '2469', withholding: { rule_id: RULE, rate: '0.020000', rate_basis: 'rate' }, net_minor: '120987' })
    expect((await statementOf(d)).withholding).toEqual({ rule_id: RULE, rate: '0.200000', rate_basis: 'missing_id_rate' })
    expect((await statementOf(b)).withholding).toEqual({ rule_id: RULE, rate: '0.000000', rate_basis: 'below_threshold' })
  })

  test('current-year cumulative: the next period counts the committed gross, so 23.50 again passes the threshold (no catch-up)', async () => {
    await order(w, b, inside(w.periods[1]!), 47_000)
    const next = await calculate(app, w, w.periods[1]!.id)
    expect((await taxLines(next)).map((t) => [t.payee, t.taxable, t.withheld, t.rate_basis])).toEqual([[b.participantId, '2350', '47', 'rate']])
  })
})

describe('T-BM-03 no-duty rule, unmatched payees and pack refusals (AC-TAX2-1, AC-TAX2-2)', () => {
  test('a rate-NULL rule writes a 0 tax line (no_duty) without a warning; a payee no rule matches gets NO_WITHHOLDING_RULE and no tax line', async () => {
    const w = await createWorld({ market: { code: 'DE', pack: 'fx-comp-nd' } })
    const p = await member(w, 'DE-P')
    const q = await member(w, 'DE-Q')
    await taxProfile(w, p) // residency DE matches; q has no profile, so the residency condition does not match
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    await order(w, p, inside(w.periods[0]!), 10_000)
    await order(w, q, inside(w.periods[0]!), 10_000)
    const runId = await calculate(app, w, w.periods[0]!.id)
    const { tax_date, tax_year } = await taxDateOf(w.periods[0]!.id)
    // No tax_year rule in this pack: the line carries the calendar year of its tax date.
    expect(await taxLines(runId)).toEqual([
      { payee: p.participantId, rule_id: NO_DUTY, taxable: '500', withheld: '0', rate: '0.000000', rate_basis: 'no_duty', tax_year, tax_date },
    ])
    expect((await warningsOf(runId)).filter((x) => x.code === 'NO_WITHHOLDING_RULE')).toEqual([{ code: 'NO_WITHHOLDING_RULE', ref: q.participantId, message: expect.any(String) }])
  })

  test.each([
    ['fx-comp-amb', 'TAX_RULE_AMBIGUOUS'],
    ['fx-comp-noyear', 'TAX_YEAR_NOT_DEFINED'],
  ])('pack %s: the run request is 422 TAX_RULES_INVALID {code: %s}; a simulation of the period ends failed with that code', async (pack, code) => {
    const w = await createWorld({ market: { code: 'DE', pack } })
    const m = await member(w, 'DE-M')
    const { versionId } = await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    await order(w, m, inside(w.periods[0]!), 10_000)
    const response = await call(app, { method: 'POST', url: `/v1/periods/${w.periods[0]!.id}/runs`, as: w.analyst, headers: { 'run-request-id': `tax-${pack}` } })
    expect(response.statusCode, response.body).toBe(422)
    expect(response.json().error).toMatchObject({ code: 'TAX_RULES_INVALID', details: { code } })
    if (code === 'TAX_RULE_AMBIGUOUS') {
      expect(response.json().error.details).toEqual({ code, rule_ids: ['fx-comp-amb-1@2020-01-01', 'fx-comp-amb-2@2020-01-01'], participant_ids: [m.participantId] })
    }
    expect(await ownerRows('SELECT 1 FROM run WHERE period_id = $1', [w.periods[0]!.id])).toEqual([])
    // The period page shows the refusal in advance (§2.2 preflight).
    const detail = await call(app, { method: 'GET', url: `/v1/periods/${w.periods[0]!.id}`, as: w.analyst })
    expect(detail.statusCode, detail.body).toBe(200)
    expect(detail.json().data.blockers).toEqual([{ code: 'TAX_RULES_INVALID', message: expect.any(String), details: response.json().error.details }])

    const admin = await user(w.tenantId, ['Plan administrator'])
    const requested = await call(app, { method: 'POST', url: '/v1/simulations', as: admin, idempotencyKey: true, body: { plan_version_id: versionId, period_id: w.periods[0]!.id } })
    expect(requested.statusCode, requested.body).toBe(202)
    await runQueuedJobs(simulationJob)
    const [simulation] = await ownerRows<{ state: string; error: { code: string } }>('SELECT state, error FROM simulation WHERE id = $1', [requested.json().data.id])
    expect(simulation).toMatchObject({ state: 'failed', error: { code: 'TAX_RULES_INVALID', details: response.json().error.details } })
  })
})

describe('T-BM-03 two calendars of one market: a commit after another calendar committed (D-BM-03)', () => {
  test('the instructions frozen before the other commit are stale: 409 RUN_SUPERSEDED; the recalculation withholds', async () => {
    const w = await createWorld({ market: { code: 'DE', pack: 'fx-comp-wh' } })
    // A second monthly calendar of the market with the same periods (same tax dates), its own plan (owner fixture).
    const [calendar] = await ownerRows<{ id: string }>(
      `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start)
       SELECT tenant_id, market_id, 'DE monthly 2', cadence, cutoff_time_zone, first_period_start FROM calendar WHERE id = $1 RETURNING id`, [w.calendarId])
    const periods = await ownerRows<{ id: string; starts_at: Date; ends_at: Date }>(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at) SELECT tenant_id, $2, starts_at, ends_at FROM period WHERE calendar_id = $1
       ORDER BY starts_at RETURNING id, starts_at, ends_at`, [w.calendarId, calendar!.id])
    const w2: World = { ...w, calendarId: calendar!.id, periods: [...periods].sort((x, y) => x.starts_at.getTime() - y.starts_at.getTime()) }
    const m = await member(w, 'DE-TWO')
    await taxProfile(w, m)
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    await activePlan(w2, ts10Plan(), w.periods[0]!.starts_at)
    await order(w, m, inside(w.periods[0]!), 47_000) // R1: 23.50 in each calendar's run

    const second = await calculate(app, w2, w2.periods[0]!.id) // prior 0: 23.50 is at the threshold
    await commit(app, w, await calculate(app, w, w.periods[0]!.id))
    await call(app, { method: 'GET', url: `/v1/runs/${second}/review`, as: w.analyst })
    await call(app, { method: 'POST', url: `/v1/runs/${second}/request-commit`, as: w.analyst, idempotencyKey: true })
    const stale = await call(app, { method: 'POST', url: `/v1/runs/${second}/commit`, as: w.finance, idempotencyKey: true, body: { acknowledged_exceptions: [] } })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error).toMatchObject({ code: 'RUN_SUPERSEDED', details: { reason: 'withholding_changed' } })
    const again = await calculate(app, w2, w2.periods[0]!.id) // prior 23.50 + 23.50 crosses the threshold
    expect((await taxLines(again)).map((t) => [t.payee, t.taxable, t.withheld, t.rate_basis])).toEqual([[m.participantId, '2350', '47', 'rate']])
    await commit(app, w2, again)
  })
})

describe('T-BM-03 a clawback-only period before a cumulative threshold run (D-BM-05 a)', () => {
  test('this tax year\'s committed gross is negative: the next run calculates with a negative prior and nothing is withheld below the limit', async () => {
    const w = await createWorld({ market: { code: 'DE', pack: 'fx-comp-neg' } })
    // The fixture tax year starts with periods[1], so periods[0] belongs to the previous tax year.
    const startMonth = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', month: 'numeric' }).format(w.periods[1]!.starts_at))
    const basis = `true, '2020-01-01', 'test fixture, not a real tax rule', 'screening', 'test fixture'`
    await getOwnerPool().query(
      `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rate, threshold_minor, threshold_basis, missing_id_rate, rounding, mandatory,
         effective_from, basis, basis_status, source_ref)
       VALUES ('fx-comp-neg@2020-01-01', 'fx-comp-neg', 'FIXTURE withholding', 'withholding', '{}', 0.020000, 2350, 'current_year_cumulative', NULL,
               'half_up', ${basis})`,
    )
    await getOwnerPool().query(
      `INSERT INTO pack_rule (id, market_pack, kind, title, params, mandatory, basis, basis_status, source_ref, effective_from)
       VALUES ('fx-comp-neg-year@2020-01-01', 'fx-comp-neg', 'tax_year', 'FIXTURE tax year', jsonb_build_object('start_month', $1::int, 'start_day', 1),
               true, 'test fixture', 'screening', 'test fixture', '2020-01-01')`, [startMonth])
    const m = await member(w, 'DE-N')
    await taxProfile(w, m)
    await activePlan(w, ts10Plan(), w.periods[0]!.starts_at)
    const sold = await order(w, m, inside(w.periods[0]!), 47_000) // R1: 23.50
    await commit(app, w, await calculate(app, w, w.periods[0]!.id))
    await lateItem(w, { eventId: await orderEvent(w, sold, inside(w.periods[1]!)) }, w.periods[0]!.id)
    const clawback = await calculate(app, w, w.periods[1]!.id)
    expect(await ownerRows('SELECT gross_minor::text AS gross FROM run_settlement WHERE run_id = $1', [clawback])).toEqual([{ gross: '-2350' }])
    await commit(app, w, clawback)

    await order(w, m, inside(w.periods[2]!), 47_020) // R1: 23.51; prior -23.50 + 23.51 = 0.01 <= 23.50
    const next = await calculate(app, w, w.periods[2]!.id)
    expect(await ownerRows('SELECT state FROM run WHERE id = $1', [next])).toEqual([{ state: 'calculated' }])
    const [run] = await ownerRows<{ snapshot_id: string }>('SELECT snapshot_id FROM run WHERE id = $1', [next])
    const snapshot = await withTenant({ tenantId: w.tenantId, userId: w.analyst.id }, (tx) => readSnapshot(tx, run!.snapshot_id))
    expect((snapshot.withholding as readonly StoredInstruction[])[0]!.threshold).toEqual({ limitMinor: 2350n, priorMinor: -2350n })
    expect((await taxLines(next)).map((t) => [t.payee, t.taxable, t.withheld, t.rate_basis])).toEqual([[m.participantId, '2351', '0', 'below_threshold']])
  })
})
