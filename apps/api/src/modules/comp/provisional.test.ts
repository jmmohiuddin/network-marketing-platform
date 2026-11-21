import { randomUUID } from 'node:crypto'
import { stringifyEngineJson, type BonusRule, type PlanVersion } from '@nmp/engine'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { buildTestApp, call, closePoolsAfterAll, createPortalUser, createSignedInUser, ownerRows, resetApiDb, type TestUser } from '../../../test/helpers/index.js'
import { createCasModule } from '../cas/index.js'
import { compCaseTypes, compModule } from './index.js'
import {
  approval, balance, calculate, commit, createWorld, lateItem, linesOf, member, order, ownerUnchecked, type Member, type Period, type World,
} from './test-support.js'

// PLAN V1-A D-V1A-02/03/04 with the section 6 values: a weekly advances calendar provisional for the monthly calendar
// of one plan; weeks W1, W2 (committed advances 10.00 and 8.00 to A) and W3 (B's 200.00 order, never advanced) nest in
// the final month F. F pays monthly_bonus 8 % (A 14.40, B 16.00) and loyalty_credit 5 % in PRODUCT_CREDIT (A 9.00,
// B 10.00): true-up A -3.60, B +16.00, run gross 12.40.

let app: FastifyInstance
closePoolsAfterAll()

const pv = { kind: 'volume.personal', key: 'pv', unit: 'currency', source: { from: 'amount' }, items: { excludeItemClasses: [], categories: null }, orders: 'all' } as const
const pay = (key: string, rate: string, creditType?: string): BonusRule => ({
  key, kind: 'pay.percent_of_measure', sourceKind: 'other', reversalPolicy: 'restatement', eligibleIf: null, measure: 'pv',
  byRank: { ladder: 'main', rates: [{ rank: 'R1', rate }] }, ...(creditType === undefined ? {} : { award: { creditType } }),
})
const planOf = (versionId: string, calendarId: string, bonuses: BonusRule[]): PlanVersion => ({
  planVersionId: versionId, version: 1, contentHash: '', effectiveFromUs: 0n, calendars: [calendarId], measures: [pv],
  ladders: [{ key: 'main', ranks: [{ key: 'R1', requires: [], maintenance: null }] }], bonuses, constraints: [], caps: [], carries: [], counters: [],
  transitions: [], pointsToCurrency: [], customerRollUp: null,
})

/** An active plan version on the world's market whose compiled document holds `plans` (calendar id -> bonuses). */
async function activate(w: World, plans: Record<string, BonusRule[]>, from: Date): Promise<void> {
  const [{ id: planId }] = await ownerRows<{ id: string }>('INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
    [w.tenantId, `plan-${randomUUID().slice(0, 8)}`, w.analyst.id]) as [{ id: string }]
  await ownerRows('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [w.tenantId, planId, w.marketId])
  for (const calendarId of Object.keys(plans)) await ownerRows('INSERT INTO plan_calendar (tenant_id, plan_id, calendar_id) VALUES ($1, $2, $3)', [w.tenantId, planId, calendarId])
  const versionId = randomUUID()
  const compiled = JSON.parse(stringifyEngineJson(Object.fromEntries(Object.entries(plans).map(([c, b]) => [c, planOf(versionId, c, b)])))) as unknown
  await ownerRows(
    `INSERT INTO plan_version (id, tenant_id, plan_id, version, state, effective_from, justification, engine_version, crediting_event,
       compiled, content_hash, submitted_by, submitted_at, approval_id, activation_approval_id, activated_at, created_by)
     VALUES ($1, $2, $3, 1, 'active', $4, 'fixture', '0.1.0', 'paid', $5, digest($5::jsonb::text, 'sha256'), $6, now(), $7, $8, now(), $6)`,
    [versionId, w.tenantId, planId, from, compiled, w.analyst.id, await approval(w.tenantId, 'plan_version', versionId, w.analyst.id, w.compliance.id),
      await approval(w.tenantId, 'plan_version', versionId, w.analyst.id, w.finance.id)],
  )
}

interface Advances {
  readonly w: World
  readonly final: Period
  readonly weeks: readonly Period[]
  readonly a: Member
  readonly b: Member
  readonly converted: string
}

/** The section 6 world; `variant` breaks one precondition of D-V1A-02 for the 422 refusals. */
async function advancesWorld(variant: 'ok' | 'credit_rule' | 'two_plans' = 'ok'): Promise<Advances> {
  const w = await createWorld({ past: 2 })
  const final = w.periods[0]!
  const [{ id: weekly }] = await ownerRows<{ id: string }>(
    `INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start, provisional_for_calendar_id)
     SELECT $1, $2, 'DE weekly advances', 'weekly', 'Europe/Berlin', (p.starts_at AT TIME ZONE 'Europe/Berlin')::date, $3 FROM period p WHERE p.id = $4
     RETURNING id`, [w.tenantId, w.marketId, w.calendarId, final.id]) as [{ id: string }]
  const weeks = (await ownerRows<Period>(
    `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
     SELECT $1, $2, f.starts_at + make_interval(days => s), CASE WHEN s = 14 THEN f.ends_at ELSE f.starts_at + make_interval(days => s + 7) END
     FROM period f CROSS JOIN unnest(ARRAY[0, 7, 14]) AS s WHERE f.id = $3 RETURNING id, starts_at, ends_at`,
    [w.tenantId, weekly, final.id])).sort((x, y) => x.starts_at.getTime() - y.starts_at.getTime())
  await ownerRows(
    `INSERT INTO credit_type (tenant_id, code, name, unit_value_minor, expiry_days, expiry_notice_days, taxable, created_by, updated_by)
     VALUES ($1, 'PRODUCT_CREDIT', 'Product credit', 100, 30, 7, false, $2, $2)`, [w.tenantId, w.finance.id])
  const monthly = [pay('monthly_bonus', '0.08'), pay('loyalty_credit', '0.05', 'PRODUCT_CREDIT')]
  const advance = [pay('weekly_advance', '0.10', variant === 'credit_rule' ? 'PRODUCT_CREDIT' : undefined)]
  if (variant === 'two_plans') {
    await activate(w, { [w.calendarId]: monthly }, final.starts_at)
    await activate(w, { [weekly]: advance }, final.starts_at)
  } else {
    await activate(w, { [w.calendarId]: monthly, [weekly]: advance }, final.starts_at)
  }
  const a = await member(w, 'DE-A')
  const b = await member(w, 'DE-B', a)
  const day = (p: Period, days: number) => new Date(p.starts_at.getTime() + days * 86_400_000)
  const converted = await order(w, a, day(weeks[0]!, 1), 10_000)
  await order(w, a, day(weeks[1]!, 1), 5_000)
  await order(w, a, day(weeks[1]!, 2), 3_000)
  await order(w, b, day(weeks[2]!, 1), 20_000)
  // D-V1A-04: A's first order was CHF 96.04 converted at 1.0412000000 (the rate batch approved by a second person).
  const batch = randomUUID()
  await ownerUnchecked(
    `INSERT INTO fx_rate_batch (id, tenant_id, source, rows, state, proposed_by, approval_id, decided_at)
     VALUES ($1, $2, 'fixture', '[{"base": "CHF", "quote": "EUR", "rate": "1.0412000000", "valid_from": "2020-01-01T00:00:00Z"}]', 'approved', $3, $4, now())`,
    [batch, w.tenantId, w.analyst.id, await approval(w.tenantId, 'fx_rate_batch', batch, w.analyst.id, w.finance.id)])
  await ownerUnchecked(
    `INSERT INTO fx_rate (tenant_id, batch_id, base, quote, rate, source, valid_from) VALUES ($1, $2, 'CHF', 'EUR', 1.0412, 'fixture', '2020-01-01T00:00:00Z')`,
    [w.tenantId, batch])
  await ownerUnchecked(
    `UPDATE sales_order SET original_currency = 'CHF', original_amount_minor = 9604, original_tax_minor = 0,
       fx_rate_id = (SELECT id FROM fx_rate WHERE batch_id = $1) WHERE id = $2`, [batch, converted])
  return { w, final, weeks, a, b, converted }
}

const post = (url: string, as: TestUser, body?: unknown) => call(app, { method: 'POST', url, as, idempotencyKey: true, headers: { 'run-request-id': randomUUID() }, ...(body === undefined ? {} : { body }) })
const get = (url: string, as: TestUser) => call(app, { method: 'GET', url, as })
const requestRun = (w: World, period: Period) => post(`/v1/periods/${period.id}/runs`, w.analyst)
const awardsOf = (runId: string) => ownerRows<{ position: string; rule: string; amount: string; expiry_days: number; taxable: boolean }>(
  `SELECT payee_position_id AS position, rule_key AS rule, amount_minor::text AS amount, expiry_days, taxable FROM credit_award WHERE run_id = $1
   ORDER BY amount_minor`, [runId])

let s: Advances
let weekRuns: string[]
let finalRun: string

beforeAll(async () => {
  await resetApiDb()
  app = await buildTestApp({ modules: [compModule, createCasModule({ types: compCaseTypes })] })
  s = await advancesWorld()
  const w1 = await calculate(app, s.w, s.weeks[0]!.id)
  // T-V1A-03: the final period waits for every nested provisional run that is not committed.
  const open = await requestRun(s.w, s.final)
  expect([open.statusCode, open.json().error.code, open.json().error.details]).toEqual([409, 'PROVISIONAL_RUN_OPEN', { period_ids: [s.weeks[0]!.id] }])
  await commit(app, s.w, w1)
  const w2 = await calculate(app, s.w, s.weeks[1]!.id)
  await commit(app, s.w, w2)
  weekRuns = [w1, w2]
  finalRun = await calculate(app, s.w, s.final.id)
  await commit(app, s.w, finalRun)
}, 240_000)

afterAll(async () => {
  await app.close()
})

describe('FR-COMP-011 provisional runs with true-up (D-V1A-02)', () => {
  test('T-V1A-01 advances 10.00 and 8.00; the final run pays 14.40 and 16.00 with advance lines -10.00 and -8.00 (true-up -3.60 and +16.00)', async () => {
    const { a, b } = s
    expect(await linesOf(weekRuns[0]!)).toEqual([{ position: a.positionId, rule: 'weekly_advance', amount: '1000', origin: null }])
    expect(await linesOf(weekRuns[1]!)).toEqual([{ position: a.positionId, rule: 'weekly_advance', amount: '800', origin: null }])
    const lines = await linesOf(finalRun)
    expect(lines.filter((l) => l.position === a.positionId).map((l) => [l.rule, l.amount, l.origin]).sort()).toEqual([
      ['monthly_bonus', '1440', null], ['weekly_advance', '-1000', 'provisional'], ['weekly_advance', '-800', 'provisional'],
    ])
    expect(lines.filter((l) => l.position === b.positionId).map((l) => [l.rule, l.amount, l.origin])).toEqual([['monthly_bonus', '1600', null]])
    const view = await get(`/v1/runs/${weekRuns[0]}`, s.w.analyst)
    expect(view.json().data.provisional).toEqual({ final_period_id: s.final.id, final_calendar_id: s.w.calendarId })
    expect(view.json().data.true_up).toBeNull()
    const finalView = (await get(`/v1/runs/${finalRun}`, s.w.analyst)).json().data
    expect(finalView).toMatchObject({ provisional: null, true_up: { provisional_run_ids: [...weekRuns].sort(), offsets_minor: '-1800' }, credit_awards_minor: '1900' })
    expect(finalView.totals.gross_minor).toBe('1240')
  })

  test('SC-01 GET /v1/periods: calendar badges (provisional_for / provisional_calendars) and the true-up count of the latest run', async () => {
    const body = (await get(`/v1/periods?calendar_id=${s.w.calendarId}`, s.w.analyst)).json().data
    const byId = Object.fromEntries(body.calendars.map((c: { id: string }) => [c.id, c]))
    const weekly = body.calendars.find((c: { provisional_for: unknown }) => c.provisional_for !== null)
    expect(weekly).toMatchObject({ name: 'DE weekly advances', provisional_for: { id: s.w.calendarId }, provisional_calendars: [] })
    expect(byId[s.w.calendarId]).toMatchObject({ provisional_for: null, provisional_calendars: [{ id: weekly.id, name: 'DE weekly advances' }] })
    expect(body.periods.find((p: { id: string }) => p.id === s.final.id).latest_run).toMatchObject({ id: finalRun, true_up_runs: 2 })
    const weeks = (await get(`/v1/periods?calendar_id=${weekly.id}`, s.w.analyst)).json().data.periods
    expect(weeks.find((p: { id: string }) => p.id === s.weeks[0]!.id).latest_run).toMatchObject({ id: weekRuns[0], true_up_runs: 0 })
  })

  test('T-V1A-02 a negative true-up reduces the payable first; the run entry balances; credits are a liability per payee', async () => {
    const { w, a, b } = s
    expect([await balance(w, a.participantId, 'payee_payable'), await balance(w, b.participantId, 'payee_payable')]).toEqual(['1440', '1600'])
    expect([await balance(w, a.participantId, 'clawback_receivable'), await balance(w, a.participantId, 'credit_liability'),
      await balance(w, b.participantId, 'credit_liability')]).toEqual(['0', '900', '1000'])
    const [entry] = await ownerRows<{ debit: string; credit: string }>(
      `SELECT sum(x.debit_minor)::text AS debit, sum(x.credit_minor)::text AS credit FROM journal_entry e JOIN posting x ON x.entry_id = e.id
       WHERE e.origin_type = 'run' AND e.origin_id = $1`, [finalRun])
    expect(entry!.debit).toBe(entry!.credit)
    // Section 6: net commission expense of the final run 31.40 = cash 12.40 + credits 19.00.
    const [expense] = await ownerRows<{ net: string }>(
      `SELECT sum(x.debit_minor - x.credit_minor)::text AS net FROM journal_entry e JOIN posting x ON x.entry_id = e.id
       JOIN ledger_account l ON l.id = x.account_id WHERE e.origin_type = 'run' AND e.origin_id = $1 AND l.type = 'commission_expense'`, [finalRun])
    expect(expense!.net).toBe('3140')
  })

  test('T-V1A-03 after the final commit no provisional run of its period is requested', async () => {
    for (const week of [s.weeks[2]!, s.weeks[1]!]) {
      const refused = await requestRun(s.w, week)
      expect([refused.statusCode, refused.json().error.code]).toEqual([409, 'FINAL_PERIOD_COMMITTED'])
    }
  })

  test('T-V1A-03 a provisional commit between the final calculation and commit supersedes it; a provisional commit after it is refused', async () => {
    const t = await advancesWorld()
    await commit(app, t.w, await calculate(app, t.w, t.weeks[0]!.id))
    const stale = await calculate(app, t.w, t.final.id)
    await commit(app, t.w, await calculate(app, t.w, t.weeks[1]!.id))
    await call(app, { method: 'GET', url: `/v1/runs/${stale}/review`, as: t.w.analyst })
    await call(app, { method: 'POST', url: `/v1/runs/${stale}/request-commit`, as: t.w.analyst, idempotencyKey: true })
    const superseded = await call(app, { method: 'POST', url: `/v1/runs/${stale}/commit`, as: t.w.finance, idempotencyKey: true, body: { acknowledged_exceptions: [] } })
    expect([superseded.statusCode, superseded.json().error.code, superseded.json().error.details]).toEqual([409, 'RUN_SUPERSEDED', { reason: 'provisional_changed' }])
    const fresh = await calculate(app, t.w, t.final.id)
    const late = await calculate(app, t.w, t.weeks[2]!.id) // allowed while the final run is not committed
    await commit(app, t.w, fresh)
    expect((await linesOf(fresh)).filter((l) => l.origin === 'provisional').map((l) => l.amount).sort()).toEqual(['-1000', '-800'])
    await call(app, { method: 'GET', url: `/v1/runs/${late}/review`, as: t.w.analyst })
    await call(app, { method: 'POST', url: `/v1/runs/${late}/request-commit`, as: t.w.analyst, idempotencyKey: true })
    const refused = await call(app, { method: 'POST', url: `/v1/runs/${late}/commit`, as: t.w.finance, idempotencyKey: true, body: { acknowledged_exceptions: [] } })
    expect([refused.statusCode, refused.json().error.code]).toEqual([409, 'FINAL_PERIOD_COMMITTED'])
  })

  test('T-V1A-04 the committed final run replays to its hash; each provisional origin is consumed once, by the final run', async () => {
    const replay = await post(`/v1/runs/${finalRun}/replay`, s.w.analyst)
    expect([replay.statusCode, replay.json().data.status]).toEqual([200, 'match'])
    const origins = await ownerRows<{ consumed: string; provisional: string }>(
      `SELECT consumed_run_id AS consumed, provisional_run_id AS provisional FROM adjustment_origin WHERE run_id = $1 ORDER BY amount_minor`, [finalRun])
    expect(origins.map((o) => o.consumed)).toEqual([finalRun, finalRun])
    expect(origins.map((o) => o.provisional).sort()).toEqual([...weekRuns].sort())
  })

  test('T-V1A-05 no late origins in a provisional calendar; no restatement of a provisional period; credit rules and two plans refused', async () => {
    const t = await advancesWorld()
    await commit(app, t.w, await calculate(app, t.w, t.weeks[0]!.id))
    const extra = await order(t.w, t.a, new Date(t.weeks[0]!.starts_at.getTime() + 3_600_000), 1_000)
    await lateItem(t.w, { orderId: extra }, t.weeks[0]!.id)
    const next = await calculate(app, t.w, t.weeks[1]!.id)
    expect((await linesOf(next)).map((l) => l.origin)).toEqual([null])
    const restate = await call(app, {
      method: 'POST', url: '/v1/cases', as: t.w.compliance, idempotencyKey: true,
      body: { type: 'restatement', subject_type: 'period', subject_id: t.weeks[0]!.id, reason_code: 'INPUT_CORRECTION', payload: { note: 'advance' } },
    })
    expect([restate.statusCode, restate.json().error.code]).toEqual([422, 'PROVISIONAL_RUN'])
    for (const [variant, code] of [['credit_rule', 'PROVISIONAL_CREDIT_RULE'], ['two_plans', 'PROVISIONAL_PLAN_MISMATCH']] as const) {
      const v = await advancesWorld(variant)
      const refused = await requestRun(v.w, v.weeks[0]!)
      expect([refused.statusCode, refused.json().error.code]).toEqual([422, code])
    }
  })

  test('T-V1A-06 GET true-up: final, advances and true-up per payee; Σ true-up = run gross', async () => {
    const response = await get(`/v1/runs/${finalRun}/true-up?limit=1`, s.w.analyst)
    expect(response.statusCode, response.body).toBe(200)
    const body = response.json()
    expect(body.data.final_period.id).toBe(s.final.id)
    expect(body.data.provisional_runs.map((r: { run_id: string; gross_minor: string }) => [r.run_id, r.gross_minor])).toEqual([[weekRuns[0], '1000'], [weekRuns[1], '800']])
    expect(body.data.totals).toEqual({ final_minor: '3040', provisional_minor: '1800', true_up_minor: '1240' })
    const rest = await get(`/v1/runs/${finalRun}/true-up?cursor=${body.meta.next_cursor}`, s.w.analyst)
    const payees = [...body.data.payees, ...rest.json().data.payees]
    const byRef = Object.fromEntries(payees.map((p: { participant: { external_ref: string }; final_minor: string; provisional_minor: string; true_up_minor: string }) =>
      [p.participant.external_ref, [p.final_minor, p.provisional_minor, p.true_up_minor]]))
    expect(byRef).toEqual({ 'DE-A': ['1440', '1800', '-360'], 'DE-B': ['1600', '0', '1600'] })
    expect(rest.json().meta.next_cursor).toBeNull()
    const notFinal = await get(`/v1/runs/${weekRuns[0]}/true-up`, s.w.analyst)
    expect([notFinal.statusCode, notFinal.json().error.code]).toEqual([422, 'NOT_A_FINAL_RUN'])
  })
})

describe('FR-FIN-006 credit awards of a run (D-V1A-03)', () => {
  test('T-V1A-11 loyalty_credit lines are credit_award rows (expiry and taxable copied), not result lines or cash totals', async () => {
    expect(await awardsOf(finalRun)).toEqual([
      { position: s.a.positionId, rule: 'loyalty_credit', amount: '900', expiry_days: 30, taxable: false },
      { position: s.b.positionId, rule: 'loyalty_credit', amount: '1000', expiry_days: 30, taxable: false },
    ])
    expect((await linesOf(finalRun)).some((l) => l.rule === 'loyalty_credit')).toBe(false)
    const [settled] = await ownerRows<{ gross: string }>('SELECT sum(gross_minor)::text AS gross FROM run_settlement WHERE run_id = $1', [finalRun])
    expect(settled!.gross).toBe('1240')
    const response = await get(`/v1/runs/${finalRun}/credit-awards`, s.w.analyst)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.map((r: { participant: { external_ref: string }; amount_minor: string; credit_type: unknown; rule_key: string }) =>
      [r.participant.external_ref, r.rule_key, r.amount_minor, r.credit_type]).sort()).toEqual([
      ['DE-A', 'loyalty_credit', '900', { code: 'PRODUCT_CREDIT', name: 'Product credit' }],
      ['DE-B', 'loyalty_credit', '1000', { code: 'PRODUCT_CREDIT', name: 'Product credit' }],
    ])
    expect(response.json().meta.totals).toEqual([{ credit_type: { code: 'PRODUCT_CREDIT', name: 'Product credit' }, amount_minor: '1900' }])
  })
})

describe('statements of the portal (PLAN V1-A section 2.4)', () => {
  test('T-V1A-23 credit awards, the converted order and the advance lines with their period and explanation', async () => {
    await ownerRows(`UPDATE market SET languages = '{en,de}' WHERE id = $1`, [s.w.marketId])
    const me = await createPortalUser({ tenantId: s.w.tenantId, participantId: s.a.participantId })
    const response = await get(`/v1/me/statements/${finalRun}`, me)
    expect(response.statusCode, response.body).toBe(200)
    const statement = response.json().data
    const [committed] = await ownerRows<{ day: string }>(
      `SELECT ((committed_at AT TIME ZONE 'Europe/Berlin')::date + 30)::text AS day FROM run WHERE id = $1`, [finalRun])
    expect(statement.credit_awards).toEqual([
      { credit_type: { code: 'PRODUCT_CREDIT', name: 'Product credit' }, amount_minor: '900', currency: 'EUR', expires_on: committed!.day, taxable: false },
    ])
    expect(statement.conversions).toMatchObject([{
      original_currency: 'CHF', original_amount_minor: '9604', rate: '1.0412000000', converted_amount_minor: '10000', currency: 'EUR',
    }])
    expect(statement.summary).toMatchObject({ gross_minor: '1440', adjustment_minor: '-1800', net_minor: '0' })
    const advances = statement.positions[0].bonuses.find((b: { rule_key: string }) => b.rule_key === 'weekly_advance').lines
    expect(advances.map((l: { origin_kind: string; original_period: unknown }) => [l.origin_kind, l.original_period !== null])).toEqual([
      ['provisional', true], ['provisional', true],
    ])
    const explanation = await get(`/v1/me/statement-lines/${advances[0].id}/explanation`, me)
    expect(explanation.statusCode, explanation.body).toBe(200)
    expect(explanation.json().data.text.join(' ')).toMatch(/Advance paid for the period .+; deducted from the final amount\./)
    // A run without converted orders or awards of the participant lists neither.
    const plain = (await get(`/v1/me/statements/${weekRuns[1]}`, me)).json().data
    expect([plain.credit_awards, plain.conversions]).toEqual([[], []])
  })
})

describe('new run routes: permission, scope, tenant and validation', () => {
  let outsider: TestUser
  let otherMarket: TestUser
  let nobody: TestUser
  beforeAll(async () => {
    const other = await createWorld()
    outsider = other.analyst
    const [{ id: marketId }] = await ownerRows<{ id: string }>(
      `INSERT INTO market (tenant_id, code, currency, minor_unit, time_zone, languages, market_pack, state)
       VALUES ($1, 'AT', 'EUR', 2, 'Europe/Vienna', '{de}', 'none', 'live') RETURNING id`, [s.w.tenantId]) as [{ id: string }]
    otherMarket = await createSignedInUser({ tenantId: s.w.tenantId, roles: ['Commission analyst'], marketIds: [marketId] })
    nobody = await createSignedInUser({ tenantId: s.w.tenantId, roles: [] })
  })

  test.each(['true-up', 'credit-awards'])('GET /v1/runs/:id/%s', async (route) => {
    expect((await get(`/v1/runs/${finalRun}/${route}`, nobody)).statusCode).toBe(403)
    expect((await get(`/v1/runs/${finalRun}/${route}`, otherMarket)).statusCode).toBe(404)
    expect((await get(`/v1/runs/${finalRun}/${route}`, outsider)).statusCode).toBe(404)
    expect((await get(`/v1/runs/${randomUUID()}/${route}`, s.w.analyst)).statusCode).toBe(404)
    const invalid = await get(`/v1/runs/not-a-uuid/${route}`, s.w.analyst)
    expect([invalid.statusCode, invalid.json().error.code]).toEqual([400, 'VALIDATION_FAILED'])
    expect((await get(`/v1/runs/${finalRun}/${route}?limit=0`, s.w.analyst)).statusCode).toBe(400)
  })
})
