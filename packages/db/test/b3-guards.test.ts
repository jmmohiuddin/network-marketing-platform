// Behaviour of the B3 tables, guards and shared SQL (PLAN B3 sections 1, 4.2 and B; migrations 0300-0304) as the
// runtime role nmp_app. Test ids: AC-PLN1-2 (DB part), AC-46.2 / TS-59 (state writes), AC-COMP3-1 (line total),
// AC-CPL7-2 (decision storage), T-B3-15 (period guard), E-PER-06 (catch-up), OI-3, OI-7.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { withSystem, withTenant, type TenantContext, type Tx } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb } from '../src/testing.js'
import { closePoolsAfterAll, insertMarket, insertRow, PERMISSION_DENIED, race } from './support.js'

const CHECK = { code: '23514' }
const NOT_ALLOWED = { code: '42501' }
const UNIQUE = { code: '23505' }
const STARTER_KIT = 'b3-starter-kit@2026-01-01' // warned, overridable
const ENROLMENT_ONLY = 'b3-enrolment-only@2026-01-01' // blocked, not overridable

// a authors and prepares, b approves, c activates.
let a: TenantContext
let b: TenantContext
let c: TenantContext
let marketId: string
let calendarId: string
let periods: string[] // Jan, Feb, Mar 2026
let settingsVersionId: string
let typeId: string
let participantId: string
let positionId: string
let mainVersionId: string // version 1 of the plan on calendarId

closePoolsAfterAll()

const as = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> => withTenant(ctx, fn)
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = [], ctx = a): Promise<T[]> =>
  (await as(ctx, (tx) => tx.query(sql, params))).rows as T[]
const value = async <T>(sql: string, params: unknown[] = [], ctx = a): Promise<T> =>
  Object.values((await rows(sql, params, ctx))[0]!)[0] as T

const approval = (ctx: TenantContext, objectType: string, objectId: string, preparer: string) =>
  as(ctx, (tx) => insertRow(tx, 'approval', {
    tenant_id: ctx.tenantId, object_type: objectType, object_id: objectId, preparer_id: preparer, approver_id: ctx.userId,
    decision: 'approved', decided_at: new Date(),
  }))

/** A plan on the market and its calendar with version 1 as an empty draft. */
async function newPlan(calendar = calendarId): Promise<{ planId: string; versionId: string }> {
  return as(a, async (tx) => {
    const planId = await insertRow(tx, 'plan', { tenant_id: a.tenantId, name: `Plan ${randomUUID()}`, created_by: a.userId })
    await tx.query('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3)', [a.tenantId, planId, marketId])
    await tx.query('INSERT INTO plan_calendar (tenant_id, plan_id, calendar_id) VALUES ($1, $2, $3)', [a.tenantId, planId, calendar])
    const versionId = await insertRow(tx, 'plan_version', {
      tenant_id: a.tenantId, plan_id: planId, version: 1, engine_version: '0.2.0', compiled: { [calendar]: {} },
      created_by: a.userId,
    })
    return { planId, versionId }
  })
}

const saveRule = (versionId: string, ruleKey: string, params: object = {}, calendar: string | null = null, ctx = a) =>
  as(ctx, (tx) => tx.query(
    `INSERT INTO plan_rule (tenant_id, plan_version_id, rule_key, kind, pass, params, calendar_id, created_by, updated_by)
     VALUES (app_tenant_id(), $1, $2, 'volume.personal', '1', $3, $4, $5, $5)
     ON CONFLICT (plan_version_id, rule_key) DO UPDATE SET params = EXCLUDED.params, updated_by = EXCLUDED.updated_by`,
    [versionId, ruleKey, params, calendar, ctx.userId]))

const submit = (versionId: string, ctx = a) => rows(
  `UPDATE plan_version SET state = 'in_review', crediting_event = 'paid', content_hash = digest(compiled::text, 'sha256'),
     submitted_by = $2, submitted_at = now() WHERE id = $1`, [versionId, ctx.userId], ctx)

/** draft -> in_review (a) -> approved (b) -> active from effectiveFrom (c). */
async function activate(versionId: string, effectiveFrom: Date, state = 'active'): Promise<void> {
  await submit(versionId)
  const approvalId = await approval(b, 'plan_version', versionId, a.userId)
  await rows(`UPDATE plan_version SET state = 'approved', approval_id = $2 WHERE id = $1`, [versionId, approvalId], b)
  const activationId = await approval(c, 'plan_version', versionId, a.userId)
  await rows(
    `UPDATE plan_version SET state = $3, activation_approval_id = $2, effective_from = $4, justification = 'test',
       activated_at = CASE WHEN $3 = 'active' THEN now() END WHERE id = $1`,
    [versionId, activationId, state, effectiveFrom], c)
}

async function snapshot(periodId: string, orderIds: string[] = [], eventIds: string[] = []): Promise<string> {
  const content = randomBytes(8)
  return as(a, (tx) => insertRow(tx, 'run_snapshot', {
    tenant_id: a.tenantId, period_id: periodId, known_at: new Date(), content,
    content_sha256: createHash('sha256').update(content).digest(), row_counts: {}, order_ids: orderIds, order_event_ids: eventIds,
  }))
}

const lineRow = (runId: string, amount: number, fields: object = {}) => ({
  tenant_id: a.tenantId, run_id: runId, payee_position_id: positionId, payee_participant_id: participantId, rule_key: 'pv',
  bonus_type: 'pay.flat', source_kind: 'other', pass: 4, amount_minor: amount, currency: 'GBP', trace: {}, ...fields,
})
const line = (runId: string, amount: number, fields: object = {}) => as(a, (tx) => insertRow(tx, 'result_line', lineRow(runId, amount, fields)))

/** A run of the period by a, running on a fresh snapshot. */
async function runningRun(periodId: string, versionId: string, snapshotId?: string): Promise<string> {
  const runId = await as(a, (tx) => insertRow(tx, 'run', {
    tenant_id: a.tenantId, period_id: periodId, run_request_id: randomUUID(), plan_version_id: versionId,
    settings_version_id: settingsVersionId, engine_version: '0.2.0', prepared_by: a.userId,
  }))
  await rows(`UPDATE run SET state = 'running', snapshot_id = $2 WHERE id = $1`, [runId, snapshotId ?? await snapshot(periodId)])
  return runId
}

const calculate = (runId: string, gross: string) => rows(
  `UPDATE run SET state = 'calculated', totals = jsonb_build_object('gross_minor', $2::text), inputs_hash = 'i',
     lines_hash = 'l', outputs = '{}', finished_at = now() WHERE id = $1`, [runId, gross])

/** Review opened by a, committed by b with b's approval of the run. */
async function commit(runId: string, periodId: string): Promise<void> {
  await rows(`UPDATE run SET review_opened_at = now(), review_opened_by = $2 WHERE id = $1`, [runId, a.userId])
  const approvalId = await approval(b, 'run', runId, a.userId)
  await rows(`UPDATE run SET state = 'committed', approval_id = $2, committed_at = now() WHERE id = $1`, [runId, approvalId], b)
  await rows(`UPDATE period SET state = 'committed', committed_run_id = $2 WHERE id = $1`, [periodId, runId], b)
}

beforeAll(async () => {
  await resetTestDb()
  const tenantId = (await createTenant()).id
  const user = async () => ({ tenantId, userId: (await createUser({ tenantId })).id })
  ;[a, b, c] = [await user(), await user(), await user()]
  const owner = getOwnerPool()
  await owner.query(
    `INSERT INTO guardrail_rule (id, market_pack, title, outcome, predicate, overridable, mandatory, basis, basis_status,
       source_ref, effective_from)
     VALUES ($1, 'test', 'Starter kit', 'warned', '{"check": "starter_kit_volume"}', true, true, 'test', 'screening', 'test', '2026-01-01'),
            ($2, 'test', 'Enrolment only', 'blocked', '{"check": "enrolment_only_pay"}', false, true, 'test', 'screening', 'test', '2026-01-01')`,
    [STARTER_KIT, ENROLMENT_ONLY],
  )
  ;({ marketId, calendarId, periods, settingsVersionId } = await as(a, async (tx) => {
    const market = await insertMarket(tx, tenantId)
    const calendar = await insertRow(tx, 'calendar', {
      tenant_id: tenantId, market_id: market, name: 'Monthly', cadence: 'monthly', cutoff_time_zone: 'UTC', first_period_start: '2026-01-01',
    })
    const ids: string[] = []
    for (const month of [1, 2, 3]) {
      ids.push(await insertRow(tx, 'period', {
        tenant_id: tenantId, calendar_id: calendar, starts_at: `2026-0${month}-01T00:00:00Z`, ends_at: `2026-0${month + 1}-01T00:00:00Z`,
      }))
    }
    const settings = await insertRow(tx, 'tenant_setting_version', {
      tenant_id: tenantId, version: 1, effective_from: '2025-01-01', settings: {}, reason: 'test', created_by: a.userId,
    })
    return { marketId: market, calendarId: calendar, periods: ids, settingsVersionId: settings }
  }))
  typeId = await as(a, (tx) => insertRow(tx, 'participant_type', {
    tenant_id: tenantId, code: 'DIST', name: 'Distributor', can_earn: true, counts_as_end_customer: true, can_sponsor: true,
    can_hold_positions: true, state: 'pending', reason: 'test', requested_by: a.userId,
  }))
  const typeApproval = await approval(b, 'participant_type', typeId, a.userId)
  await rows(`UPDATE participant_type SET state = 'active', decided_by = $2, decided_at = now(), approval_id = $3 WHERE id = $1`,
    [typeId, b.userId, typeApproval], b)
  participantId = await value<string>(`SELECT id FROM par_create_customer('p-1', $1, $2, '2025-12-01')`, [marketId, typeId])
  positionId = await value<string>(`SELECT gen_create_position($1, $2, NULL, NULL, 'active', '2025-12-01')`, [participantId, marketId])
})

describe('plans and versions (D-B3-03, D-B3-04, AC-PLN1-2)', () => {
  test('a plan calendar is in one of its markets and in one plan only', async () => {
    const other = await as(a, async (tx) => {
      const market = await insertMarket(tx, a.tenantId, 'IE')
      return insertRow(tx, 'calendar', {
        tenant_id: a.tenantId, market_id: market, name: 'IE', cadence: 'weekly', cutoff_time_zone: 'UTC', first_period_start: '2026-01-05',
      })
    })
    const { planId, versionId } = await newPlan()
    mainVersionId = versionId
    const link = (calendar: string) => rows('INSERT INTO plan_calendar (tenant_id, plan_id, calendar_id) VALUES (app_tenant_id(), $1, $2)', [planId, calendar])

    await expect(link(other)).rejects.toMatchObject(CHECK)
    await expect(newPlan()).rejects.toMatchObject(UNIQUE) // calendarId already belongs to a plan
  })

  test('a version moves draft -> in_review -> approved -> active with second and third persons; content freezes', async () => {
    const { planId, versionId } = await newPlan(await as(a, (tx) => insertRow(tx, 'calendar', {
      tenant_id: a.tenantId, market_id: marketId, name: `C ${randomUUID()}`, cadence: 'monthly', cutoff_time_zone: 'UTC', first_period_start: '2026-01-01',
    })))
    await expect(as(a, (tx) => insertRow(tx, 'plan_version', {
      tenant_id: a.tenantId, plan_id: planId, version: 2, engine_version: '0.2.0', based_on_version_id: mainVersionId, created_by: a.userId,
    }))).rejects.toMatchObject(CHECK) // based on another plan's version
    await expect(saveRule(versionId, 'pv', {}, calendarId)).rejects.toMatchObject(CHECK) // another plan's calendar
    await saveRule(versionId, 'pv')
    await expect(rows(`UPDATE plan_rule SET updated_by = $2 WHERE plan_version_id = $1`, [versionId, b.userId])).rejects.toMatchObject(NOT_ALLOWED)
    await expect(rows(`UPDATE plan_version SET state = 'in_review', crediting_event = 'paid', content_hash = $2,
                         submitted_by = $3, submitted_at = now() WHERE id = $1`, [versionId, randomBytes(32), a.userId]))
      .rejects.toMatchObject(CHECK) // the hash is the digest of compiled
    await expect(rows(`UPDATE plan_version SET state = 'in_review', crediting_event = 'paid',
                         content_hash = digest(compiled::text, 'sha256'), submitted_by = $2, submitted_at = now() WHERE id = $1`,
                      [versionId, b.userId])).rejects.toMatchObject(NOT_ALLOWED) // submitted as someone else
    await submit(versionId)

    await expect(saveRule(versionId, 'gv')).rejects.toMatchObject(NOT_ALLOWED)
    await expect(rows('DELETE FROM plan_rule WHERE plan_version_id = $1', [versionId])).rejects.toMatchObject(NOT_ALLOWED)
    await expect(rows(`UPDATE plan_version SET compiled = '{}' WHERE id = $1`, [versionId])).rejects.toMatchObject(NOT_ALLOWED)
    const own = await approval(c, 'plan_version', versionId, b.userId)
    await expect(rows(`UPDATE plan_version SET state = 'approved', approval_id = $2 WHERE id = $1`, [versionId,
      await approval(a, 'plan_version', versionId, b.userId)])).rejects.toMatchObject(NOT_ALLOWED) // the submitter approves
    const approvalId = await approval(b, 'plan_version', versionId, a.userId)
    await rows(`UPDATE plan_version SET state = 'approved', approval_id = $2 WHERE id = $1`, [versionId, approvalId], b)
    const byApprover = await approval(b, 'plan_version', versionId, c.userId)
    const schedule = (activation: string, ctx: TenantContext) => rows(
      `UPDATE plan_version SET state = 'scheduled', activation_approval_id = $2, effective_from = '2026-01-01',
         justification = 'go' WHERE id = $1`, [versionId, activation], ctx)

    await expect(schedule(byApprover, b)).rejects.toMatchObject(NOT_ALLOWED) // the compliance approver activates
    await schedule(own, c)
    await expect(rows(`UPDATE plan_version SET effective_from = '2026-02-01' WHERE id = $1`, [versionId], c)).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE plan_version SET state = 'active' WHERE id = $1`, [versionId], c)).rejects.toMatchObject(CHECK) // activated_at
    await expect(rows(`UPDATE plan_version SET state = 'draft' WHERE id = $1`, [versionId], c)).rejects.toMatchObject(CHECK)
  })
})

describe('plan reads (PLAN 4.2)', () => {
  test('version for a period, crediting event, width, structural rules, due activations and the simulation gate', async () => {
    const versionId = mainVersionId
    await saveRule(versionId, 'reparent')
    await rows(`UPDATE plan_version SET placement_width = 3 WHERE id = $1`, [versionId])
    await activate(versionId, new Date('2026-02-01T00:00:00Z'))
    await expect(rows(`UPDATE plan_version SET activated_at = now() WHERE id = $1`, [versionId], c)).rejects.toMatchObject(CHECK)

    expect(await value('SELECT plan_version_for_period($1)', [periods[0]])).toBeNull() // starts before the version
    expect(await value('SELECT plan_version_for_period($1)', [periods[1]])).toBe(versionId)
    // D-B6-05: before the market's first version, that version's event applies.
    expect(await value(`SELECT plan_crediting_event($1, '2025-12-15')`, [marketId])).toBe('paid')
    expect(await value(`SELECT plan_crediting_event($1, '2026-02-15')`, [marketId])).toBe('paid')
    expect(await value('SELECT placement_width_for($1)', [marketId])).toBe(3)
    expect(await rows(`SELECT plan_version_id, rule_key FROM plan_rules_in_force($1, now(), 'volume.personal')`, [marketId]))
      .toContainEqual({ plan_version_id: versionId, rule_key: 'reparent' })
    expect(await value('SELECT plan_version_simulated($1)', [versionId])).toBe(false)
    const simulationId = await as(a, (tx) => tx.query(
      `INSERT INTO simulation (tenant_id, plan_version_id, period_id, kind, content_hash, requested_by)
       SELECT tenant_id, id, $2, 'simulation', content_hash, $3 FROM plan_version WHERE id = $1 RETURNING id`,
      [versionId, periods[1], a.userId]))
    await rows(`UPDATE simulation SET state = 'running' WHERE id = $1`, [simulationId.rows[0]!.id])
    await rows(`UPDATE simulation SET state = 'completed', totals = '{}', comparison = '{}' WHERE id = $1`, [simulationId.rows[0]!.id])
    expect(await value('SELECT plan_version_simulated($1)', [versionId])).toBe(true)

    const later = await newPlan(await as(a, (tx) => insertRow(tx, 'calendar', {
      tenant_id: a.tenantId, market_id: marketId, name: `D ${randomUUID()}`, cadence: 'monthly', cutoff_time_zone: 'UTC', first_period_start: '2026-01-01',
    })))
    await activate(later.versionId, new Date(Date.now() - 1000), 'scheduled')
    await expect(rows('SELECT * FROM pln_due_activations()')).rejects.toMatchObject(NOT_ALLOWED)
    expect((await withSystem((tx) => tx.query('SELECT plan_version_id FROM pln_due_activations()'))).rows)
      .toContainEqual({ plan_version_id: later.versionId })
  })
})

describe('guardrail decisions (D-B3-17, AC-CPL7-2, AC-CPL8-1)', () => {
  test('evaluations are stored once per content, acknowledged and overridden by rule, and never change', async () => {
    const { versionId } = await newPlan(await as(a, (tx) => insertRow(tx, 'calendar', {
      tenant_id: a.tenantId, market_id: marketId, name: `G ${randomUUID()}`, cadence: 'monthly', cutoff_time_zone: 'UTC', first_period_start: '2026-01-01',
    })))
    await saveRule(versionId, 'pv', { items: 'all' })
    await saveRule(versionId, 'capped')
    const evaluate = (rule: string, outcome: string) => as(a, (tx) => tx.query<{ id: string }>(
      `INSERT INTO guardrail_decision (tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail)
       VALUES (app_tenant_id(), $1, $2, 'evaluation', $3, guardrail_rules_hash($2, ARRAY['pv']), '{"rule_keys": ["pv"]}')
       RETURNING id`, [rule, versionId, outcome])).then((r) => r.rows[0]!.id)
    const follow = (ctx: TenantContext, evaluation: string, kind: string, outcome: string, approvalId: string | null = null) =>
      as(ctx, (tx) => tx.query(
        `INSERT INTO guardrail_decision (tenant_id, rule_id, plan_version_id, kind, outcome, content_sha256, detail,
           refers_to_decision_id, justification, approval_id)
         SELECT tenant_id, rule_id, plan_version_id, $2, $3, content_sha256, detail, id, $4, $5 FROM guardrail_decision WHERE id = $1`,
        [evaluation, kind, outcome, kind === 'override' ? 'A justification of twenty characters' : null, approvalId]))
    const outstanding = () => rows<{ decision_id: string; reason: string }>('SELECT decision_id, reason FROM guardrail_outstanding($1)', [versionId])

    const warned = await evaluate(STARTER_KIT, 'warned')
    await expect(evaluate(STARTER_KIT, 'warned')).rejects.toMatchObject(UNIQUE)
    expect(await outstanding()).toEqual([{ decision_id: warned, reason: 'acknowledgement_required' }])
    await expect(follow(a, warned, 'acknowledgement', 'blocked')).rejects.toMatchObject(CHECK) // not the evaluation's outcome
    await follow(a, warned, 'acknowledgement', 'warned')
    await expect(follow(a, warned, 'acknowledgement', 'warned')).rejects.toMatchObject(UNIQUE)
    expect(await outstanding()).toEqual([])
    await expect(follow(b, warned, 'override', 'warned', await approval(b, 'guardrail_decision', warned, c.userId)))
      .rejects.toMatchObject(NOT_ALLOWED) // prepared by someone other than the evaluation's decider
    await follow(b, warned, 'override', 'warned', await approval(b, 'guardrail_decision', warned, a.userId))

    const blocked = await evaluate(ENROLMENT_ONLY, 'blocked')
    await expect(follow(b, blocked, 'override', 'blocked', await approval(b, 'guardrail_decision', blocked, a.userId)))
      .rejects.toMatchObject(CHECK) // not overridable
    expect(await outstanding()).toEqual([{ decision_id: blocked, reason: 'not_overridable' }])
    await saveRule(versionId, 'capped', { changed: true }) // an unrelated rule keeps the decisions current
    expect(await outstanding()).toHaveLength(1)
    await saveRule(versionId, 'pv', { items: 'none' }) // the matched rule changed: no longer current
    expect(await outstanding()).toEqual([])
    await expect(rows(`UPDATE guardrail_decision SET outcome = 'reported' WHERE id = $1`, [warned])).rejects.toThrow(PERMISSION_DENIED)
    await expect(rows('DELETE FROM guardrail_decision WHERE id = $1', [warned])).rejects.toThrow(PERMISSION_DENIED)
  })
})

describe('runs, periods and state (D-B3-09, D-B3-12, D-B3-19, D-B3-20)', () => {
  let versionId: string

  beforeAll(async () => {
    ;({ versionId } = await rows<{ versionId: string }>(
      `SELECT v.id AS "versionId" FROM plan_version v JOIN plan_calendar c ON c.plan_id = v.plan_id WHERE c.calendar_id = $1`,
      [calendarId]).then((r) => r[0]!))
  })

  test('a run is requested queued by its preparer; lines and state are written only while it runs', async () => {
    const request = (preparer: string) => as(a, (tx) => insertRow(tx, 'run', {
      tenant_id: a.tenantId, period_id: periods[0], run_request_id: randomUUID(), plan_version_id: versionId,
      settings_version_id: settingsVersionId, engine_version: '0.2.0', prepared_by: preparer,
    }))
    await expect(request(b.userId)).rejects.toMatchObject(NOT_ALLOWED)
    const queued = await request(a.userId)
    await expect(line(queued, 100)).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE run SET state = 'running' WHERE id = $1`, [queued])).rejects.toMatchObject(CHECK) // no snapshot
    await expect(as(a, (tx) => insertRow(tx, 'run_snapshot', {
      tenant_id: a.tenantId, period_id: periods[0], known_at: new Date(), content: Buffer.from('x'), content_sha256: randomBytes(32),
      row_counts: {}, order_ids: [], order_event_ids: [],
    }))).rejects.toMatchObject(CHECK)
    await rows(`UPDATE run SET state = 'failed', error = '{"code": "INTERNAL"}' WHERE id = $1`, [queued])
    await expect(rows(`UPDATE run SET state = 'running' WHERE id = $1`, [queued])).rejects.toMatchObject(CHECK) // terminal

    const runId = await runningRun(periods[0]!, versionId)
    await line(runId, 100)
    await expect(calculate(runId, '99')).rejects.toMatchObject(CHECK) // Σ lines = totals.gross_minor
    await calculate(runId, '100')
    for (const change of [`finished_at = '2000-01-01'`, `started_at = '2030-01-01'`, `error = '{"x": 1}'`, `progress = 'hacked'`]) {
      await expect(rows(`UPDATE run SET ${change} WHERE id = $1`, [runId])).rejects.toMatchObject(CHECK) // written by transitions only
    }
    await expect(line(runId, 5)).rejects.toMatchObject(CHECK)
    await expect(rows(`INSERT INTO qualification_state (tenant_id, run_id, position_id, paid_as_rank, highest_titles, grace_used,
                         counters, carry, one_time_flags, banked, measures)
                       VALUES (app_tenant_id(), $1, $2, '[]', '[]', '[]', '[]', '[]', '{}', '[]', '[]')`, [runId, positionId]))
      .rejects.toMatchObject(CHECK)
    await expect(rows('UPDATE qualification_state SET measures = $2 WHERE run_id = $1', [runId, '[]'])).rejects.toThrow(PERMISSION_DENIED)
    await expect(rows(`UPDATE run SET totals = '{"gross_minor": "0"}' WHERE id = $1`, [runId])).rejects.toMatchObject(CHECK)
  })

  test('commit needs the review opened and someone else\'s approval; the period follows its committed run', async () => {
    const runId = await rows<{ id: string }>(`SELECT id FROM run WHERE period_id = $1 AND state = 'calculated'`, [periods[0]]).then((r) => r[0]!.id)
    await expect(rows(`UPDATE period SET state = 'committed', committed_run_id = $2 WHERE id = $1`, [periods[0], runId]))
      .rejects.toMatchObject(CHECK) // open -> committed
    await rows(`UPDATE period SET state = 'calculating' WHERE id = $1`, [periods[0]])
    await rows(`UPDATE period SET state = 'calculated' WHERE id = $1`, [periods[0]])
    await expect(rows(`UPDATE run SET review_opened_at = now(), review_opened_by = $2 WHERE id = $1`, [runId, b.userId]))
      .rejects.toMatchObject(NOT_ALLOWED)
    await rows(`UPDATE run SET commit_requested_at = now(), commit_requested_by = $2 WHERE id = $1`, [runId, c.userId], c)
    const byRequester = await approval(c, 'run', runId, a.userId)
    await rows(`UPDATE run SET review_opened_at = now(), review_opened_by = $2 WHERE id = $1`, [runId, a.userId])
    await expect(rows(`UPDATE run SET state = 'committed', approval_id = $2, committed_at = now() WHERE id = $1`, [runId, byRequester], c))
      .rejects.toMatchObject(NOT_ALLOWED)
    const approvalId = await approval(b, 'run', runId, a.userId)
    await rows(`UPDATE run SET state = 'committed', approval_id = $2, committed_at = now() WHERE id = $1`, [runId, approvalId], b)
    const other = await runningRun(periods[1]!, versionId)
    await expect(rows(`UPDATE period SET state = 'committed', committed_run_id = $2 WHERE id = $1`, [periods[0], other])).rejects.toMatchObject(CHECK)
    await rows(`UPDATE period SET state = 'committed', committed_run_id = $2 WHERE id = $1`, [periods[0], runId])
    await expect(rows(`UPDATE period SET state = 'calculating' WHERE id = $1`, [periods[0]])).rejects.toMatchObject(CHECK)
    await expect(rows(`INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at, state) VALUES (app_tenant_id(), $1,
                         '2027-01-01', '2027-02-01', 'committed')`, [calendarId])).rejects.toThrow('a period is created open')
  })

  test('one calculated run per period (checked at commit time) and adjustment origins consumed once by their run', async () => {
    const first = await rows<{ id: string }>(`SELECT id FROM run WHERE period_id = $1 AND state = 'running'`, [periods[1]]).then((r) => r[0]!.id)
    const lateId = await as(a, async (tx) => {
      const inbound = await insertRow(tx, 'inbound_event', {
        tenant_id: a.tenantId, source: 'api:test', idempotency_key: randomUUID(), payload_hash: randomBytes(32), state: 'processed',
        processed_at: new Date(),
      })
      const orderId = await insertRow(tx, 'sales_order', {
        tenant_id: a.tenantId, source_system: 'test', source_order_id: randomUUID(), market_id: marketId, buyer_id: participantId,
        buyer_type_id: typeId, purpose: 'personal', purpose_missing: false, attribution_conflict: false, ordered_at: '2026-01-10',
        credited_at: '2026-01-10', amount_minor: 500, tax_minor: 0, currency: 'GBP', payload_hash: randomBytes(32), inbound_event_id: inbound,
      })
      return insertRow(tx, 'late_transaction', { tenant_id: a.tenantId, order_id: orderId, original_period_id: periods[0], handling: 'adjust', state: 'pending' })
    })
    const lateOrigin = (fields: object = {}) => as(a, (tx) => insertRow(tx, 'adjustment_origin', {
      tenant_id: a.tenantId, origin_type: 'late_transaction', late_transaction_id: lateId, run_id: first, payee_position_id: positionId,
      rule_key: 'pv', source_kind: 'other', amount_minor: 40, original_period_id: periods[0], ...fields,
    }))
    await expect(lateOrigin({ rule_key: 'other_rule', consumed_run_id: first })).rejects.toMatchObject(CHECK) // created consumed
    await expect(lateOrigin({ rule_key: 'other_rule', original_period_id: periods[1] })).rejects.toMatchObject(CHECK) // not the item's period
    const origin = await lateOrigin()
    const carried = { origin_type: 'late_transaction', origin_id: origin, original_period_id: periods[0] }
    await expect(line(first, 999, carried)).rejects.toMatchObject(CHECK) // not the origin's amount
    await line(first, 40, carried)
    await calculate(first, '40')
    await rows(`UPDATE period SET state = 'calculating' WHERE id = $1`, [periods[1]])
    await rows(`UPDATE period SET state = 'calculated' WHERE id = $1`, [periods[1]])
    const second = await runningRun(periods[1]!, versionId)
    await expect(line(second, 40, carried)).rejects.toMatchObject(CHECK) // a late origin of another run
    await expect(calculate(second, '0')).rejects.toMatchObject({ code: '23P01' }) // the first is still calculated
    await as(a, async (tx) => {
      await tx.query(`UPDATE run SET state = 'calculated', totals = '{"gross_minor": "0"}', inputs_hash = 'i', lines_hash = 'l',
                        outputs = '{}', finished_at = now() WHERE id = $1`, [second])
      await tx.query(`UPDATE run SET state = 'discarded' WHERE id = $1`, [first])
    })
    await expect(rows('UPDATE adjustment_origin SET consumed_run_id = $2 WHERE id = $1', [origin, second])).rejects.toMatchObject(CHECK)
    await rows(`UPDATE late_transaction SET state = 'decided', decided_by = $2, decided_at = now(), decision_reason = 'test'
                WHERE id = $1`, [lateId, a.userId])
    await expect(rows(`UPDATE late_transaction SET state = 'consumed', consumed_by_run_id = $2 WHERE id = $1`, [lateId, second]))
      .rejects.toMatchObject(CHECK) // not committed yet
    await commit(second, periods[1]!)
    await rows(`UPDATE late_transaction SET state = 'consumed', consumed_by_run_id = $2 WHERE id = $1`, [lateId, second])
  })

  test('a line written while its run is calculated (two connections) is in the checked total or refused', async () => {
    const runId = await runningRun(periods[0]!, versionId)
    const addLine = (tx: Tx) => insertRow(tx, 'result_line', lineRow(runId, 500))
    const flip = (gross: string) => (tx: Tx) => tx.query(
      `UPDATE run SET state = 'calculated', totals = jsonb_build_object('gross_minor', $2::text), inputs_hash = 'i',
         lines_hash = 'l', outputs = '{}', finished_at = now() WHERE id = $1`, [runId, gross])
    const refusedAfterWaiting = { waited: true, outcome: { ok: false, code: '23514' } }

    expect(await race(a, addLine, flip('0'))).toEqual(refusedAfterWaiting) // the flip waits and sees the line
    expect(await race(a, flip('500'), addLine)).toEqual(refusedAfterWaiting) // the insert waits and sees it calculated
    expect(await rows('SELECT r.state, (SELECT sum(amount_minor) FROM result_line WHERE run_id = r.id) AS lines FROM run r WHERE id = $1', [runId]))
      .toEqual([{ state: 'calculated', lines: '500' }])
  })
})

describe('catch-up, simulations and restatements (D-B3-12, D-B3-14, D-B3-15)', () => {
  test('comp_late_catch_up queues the period\'s orders and events missing from the run\'s snapshot, once', async () => {
    const versionId = await value<string>('SELECT plan_version_for_period($1)', [periods[2]])
    const { inSnapshot, missing, eventId } = await as(a, async (tx) => {
      const order = async (credited: string) => insertRow(tx, 'sales_order', {
        tenant_id: a.tenantId, source_system: 'test', source_order_id: randomUUID(), market_id: marketId, buyer_id: participantId,
        buyer_type_id: typeId, purpose: 'personal', purpose_missing: false, attribution_conflict: false, ordered_at: credited,
        credited_at: credited, amount_minor: 700, tax_minor: 0, currency: 'GBP', payload_hash: randomBytes(32),
        inbound_event_id: await insertRow(tx, 'inbound_event', {
          tenant_id: a.tenantId, source: 'api:test', idempotency_key: randomUUID(), payload_hash: randomBytes(32), state: 'processed',
          processed_at: new Date(),
        }),
      })
      const kept = await order('2026-03-05')
      const late = await order('2026-03-20')
      await order('2026-04-02') // another period
      await insertRow(tx, 'order_line', {
        tenant_id: a.tenantId, order_id: late, line_no: 1, sku: 'SKU', item_class: 'product', quantity: 2, amount_minor: 700, volumes: { pv: '300' },
      })
      await insertRow(tx, 'order_line', {
        tenant_id: a.tenantId, order_id: kept, line_no: 1, sku: 'SKU', item_class: 'product', quantity: 1, amount_minor: 700, volumes: { pv: '100' },
      })
      const event = await insertRow(tx, 'order_event', {
        tenant_id: a.tenantId, order_id: kept, source_system: 'test', source_event_id: randomUUID(), type: 'refund', occurred_at: '2026-04-03',
        lines: JSON.stringify([{ line_no: 1, quantity: 1 }]), refund_minor: 700, fee_minor: 0, volume_effect: { total: { pv: '-100' } },
        inbound_event_id: await insertRow(tx, 'inbound_event', {
          tenant_id: a.tenantId, source: 'api:test', idempotency_key: randomUUID(), payload_hash: randomBytes(32), state: 'processed',
          processed_at: new Date(),
        }),
      })
      return { inSnapshot: kept, missing: late, eventId: event }
    })
    const runId = await runningRun(periods[2]!, versionId!, await snapshot(periods[2]!, [inSnapshot]))

    const created = await rows<{ id: string }>('SELECT comp_late_catch_up($1) AS id', [runId])
    expect(await rows('SELECT order_id, order_event_id, original_period_id, handling, state, effect_estimate FROM late_transaction WHERE id = ANY ($1) ORDER BY order_id NULLS LAST',
      [created.map((r) => r.id)])).toEqual([
      { order_id: missing, order_event_id: null, original_period_id: periods[2], handling: 'adjust', state: 'pending',
        effect_estimate: { volumes: { pv: '300' }, amount_minor: '700', attributed_position_id: null } },
      { order_id: null, order_event_id: eventId, original_period_id: periods[2], handling: 'adjust', state: 'pending',
        effect_estimate: { volumes: { pv: '-100' }, amount_minor: '-700', attributed_position_id: null } },
    ])
    expect(await rows('SELECT comp_late_catch_up($1) AS id', [runId])).toEqual([])
  })

  test('a simulation carries the compiled digest; its lines land only while it runs; its source is readable', async () => {
    const versionId = await value<string>('SELECT plan_version_for_period($1)', [periods[2]])
    const request = (hash: Buffer | null) => as(a, (tx) => tx.query<{ id: string }>(
      `INSERT INTO simulation (tenant_id, plan_version_id, period_id, kind, content_hash, requested_by)
       SELECT tenant_id, id, $2, 'simulation', coalesce($3, digest(compiled::text, 'sha256')), $4 FROM plan_version WHERE id = $1
       RETURNING id`, [versionId, periods[2], hash, a.userId])).then((r) => r.rows[0]!.id)
    await expect(request(randomBytes(32))).rejects.toMatchObject(CHECK)
    const simulationId = await request(null)
    const simLine = () => as(a, (tx) => insertRow(tx, 'sim_result_line', {
      tenant_id: a.tenantId, simulation_id: simulationId, payee_position_id: positionId, payee_participant_id: participantId,
      rule_key: 'pv', bonus_type: 'pay.flat', source_kind: 'other', pass: 4, amount_minor: 250, currency: 'GBP', trace: {},
    }))
    await expect(simLine()).rejects.toMatchObject(CHECK)
    await rows(`UPDATE simulation SET state = 'running', snapshot_id = $2 WHERE id = $1`, [simulationId, await snapshot(periods[2]!)])
    await simLine()
    await expect(rows(`UPDATE simulation SET state = 'completed' WHERE id = $1`, [simulationId])).rejects.toMatchObject(CHECK)
    await rows(`UPDATE simulation SET state = 'completed', totals = '{}', comparison = '{}' WHERE id = $1`, [simulationId])

    expect(await rows('SELECT calendar_id, settings_version_id, lines FROM comp_simulation_source($1)', [simulationId])).toEqual([{
      calendar_id: calendarId, settings_version_id: settingsVersionId,
      lines: [{ payee_position_id: positionId, rule_key: 'pv', origin_type: null, origin_id: null, amount_minor: '250' }],
    }])
  })

  test('a restatement follows its case; its origins are carried as matching lines and paid by one committed run', async () => {
    const simulationId = await value<string>(`SELECT id FROM simulation WHERE state = 'completed' LIMIT 1`)
    const openCase = (type: string) => as(a, (tx) => insertRow(tx, 'case_file', {
      tenant_id: a.tenantId, type, subject_type: 'period', subject_id: periods[0], reason_code: 'INPUT_CORRECTION', state: 'open',
      payload: {}, opened_by: a.userId,
    }))
    const create = async (caseId: string) => as(a, (tx) => insertRow(tx, 'restatement', {
      tenant_id: a.tenantId, period_id: periods[0], case_id: caseId, simulation_id: simulationId, state: 'calculated', diff: {},
    }))
    await expect(create(await openCase('adjustment'))).rejects.toMatchObject(CHECK)
    const caseId = await openCase('restatement')
    const restatementId = await create(caseId)
    const setState = (state: string, runId: string | null = null) =>
      rows(`UPDATE restatement SET state = $2, applied_in_run_id = $3 WHERE id = $1`, [restatementId, state, runId])
    const origin = (fields: object = {}) => as(a, (tx) => insertRow(tx, 'adjustment_origin', {
      tenant_id: a.tenantId, origin_type: 'restatement', restatement_id: restatementId, payee_position_id: positionId, rule_key: 'pv',
      source_kind: 'other', amount_minor: -700, original_period_id: periods[0], ...fields,
    }))
    const runId = await value<string>(`SELECT id FROM run WHERE period_id = $1 AND state = 'running'`, [periods[2]])

    await expect(setState('approved')).rejects.toMatchObject(CHECK) // the case is not decided
    await expect(setState('applied')).rejects.toMatchObject(CHECK)
    await expect(origin()).rejects.toMatchObject(CHECK)
    await rows(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now() WHERE id = $1`, [caseId, a.userId])
    await rows(`UPDATE case_file SET state = 'approved', decided_at = now(), approval_id = $2 WHERE id = $1`,
      [caseId, await approval(c, 'case', caseId, a.userId)], c)
    await expect(setState('rejected')).rejects.toMatchObject(CHECK) // the case was approved
    await expect(origin({ consumed_run_id: runId })).rejects.toMatchObject(CHECK) // created consumed
    await expect(origin({ original_period_id: periods[1] })).rejects.toMatchObject(CHECK) // not the restated period
    const originId = await origin()
    await expect(setState('applied')).rejects.toMatchObject(CHECK) // with origins, applied by the run that pays them
    await setState('approved')
    const committedRun = await value<string>(`SELECT committed_run_id FROM period WHERE id = $1`, [periods[0]])
    await expect(setState('applied', committedRun)).rejects.toMatchObject(CHECK) // committed, but it did not consume the origin

    const carried = { origin_type: 'restatement', origin_id: originId, original_period_id: periods[0] }
    await expect(line(runId, 999, carried)).rejects.toMatchObject(CHECK) // not the origin's amount
    await expect(line(runId, -700, { ...carried, rule_key: 'other_rule' })).rejects.toMatchObject(CHECK)
    await expect(line(runId, -700, { ...carried, origin_type: 'manual' })).rejects.toMatchObject(CHECK)
    await line(runId, -700, carried)
    await calculate(runId, '-700')
    await rows(`UPDATE period SET state = 'calculating' WHERE id = $1`, [periods[2]])
    await rows(`UPDATE period SET state = 'calculated' WHERE id = $1`, [periods[2]])
    await rows(`UPDATE run SET review_opened_at = now(), review_opened_by = $2 WHERE id = $1`, [runId, a.userId])
    const approvalId = await approval(b, 'run', runId, a.userId)
    const commitRun = `UPDATE run SET state = 'committed', approval_id = $2, committed_at = now() WHERE id = $1`
    await expect(rows(commitRun, [runId, approvalId], b)).rejects.toMatchObject(CHECK) // its origin unconsumed at COMMIT
    await as(b, async (tx) => {
      await tx.query(commitRun, [runId, approvalId])
      await tx.query('UPDATE adjustment_origin SET consumed_run_id = $2 WHERE id = $1', [originId, runId])
      await tx.query(`UPDATE restatement SET state = 'applied', applied_in_run_id = $2 WHERE id = $1`, [restatementId, runId])
    })
    await expect(rows(`UPDATE restatement SET diff = '{"x": 1}' WHERE id = $1`, [restatementId])).rejects.toMatchObject(CHECK)

    const emptyCase = await openCase('restatement') // an empty diff is applied at approval
    const empty = await create(emptyCase)
    await rows(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now() WHERE id = $1`, [emptyCase, a.userId])
    await rows(`UPDATE case_file SET state = 'approved', decided_at = now(), approval_id = $2 WHERE id = $1`,
      [emptyCase, await approval(c, 'case', emptyCase, a.userId)], c)
    await rows(`UPDATE restatement SET state = 'applied' WHERE id = $1`, [empty])
  })
})

describe('B2 follow-ups (OI-3, OI-7)', () => {
  test('par_create_customer says whether it created the customer', async () => {
    const create = () => rows<{ id: string; created: boolean }>(`SELECT id, created FROM par_create_customer('p-2', $1, $2, now())`, [marketId, typeId])
    const [first] = await create()

    expect(first!.created).toBe(true)
    expect(await create()).toEqual([{ id: first!.id, created: false }])
  })

  test('a new position makes both path models stale; an expired model is listed for rebuild', async () => {
    await rows(`UPDATE path_model SET stale_since = NULL, valid_until = NULL`)
    await value(`SELECT gen_create_position($1, $2, NULL, NULL, 'active', now())`, [participantId, marketId])
    expect(await rows('SELECT kind FROM path_model WHERE stale_since IS NOT NULL ORDER BY kind')).toEqual([{ kind: 'placement' }, { kind: 'sponsor' }])

    const parent = await value<string>(`SELECT gen_create_position($1, $2, NULL, NULL, 'active', '2025-12-01')`, [participantId, marketId])
    const future = new Date(Date.now() + 86_400_000)
    await value(`SELECT gen_apply_relationship('sponsor', $1, $2, NULL, $3, 'enrolment', NULL, NULL)`, [positionId, parent, future])
    expect(await value(`SELECT gen_path_valid_until('sponsor')`)).toEqual(future)
    await rows(`UPDATE path_model SET stale_since = NULL, valid_until = CASE kind WHEN 'sponsor' THEN now() END`)
    expect((await withSystem((tx) => tx.query('SELECT tenant_id, kind FROM gen_stale_models()'))).rows)
      .toEqual([{ tenant_id: a.tenantId, kind: 'sponsor' }])
  })

  test('someone who edited a case cannot decide it', async () => {
    const caseId = await as(a, (tx) => insertRow(tx, 'case_file', {
      tenant_id: a.tenantId, type: 'grievance', subject_type: 'test', subject_id: randomUUID(), reason_code: 'R', state: 'open',
      payload: {}, opened_by: a.userId,
    }))
    await as(b, (tx) => insertRow(tx, 'case_event', { tenant_id: a.tenantId, case_id: caseId, actor_id: b.userId, kind: 'updated' }))
    await rows(`UPDATE case_file SET state = 'submitted', submitted_by = $2, submitted_at = now() WHERE id = $1`, [caseId, a.userId])
    const decide = async (ctx: TenantContext) => rows(
      `UPDATE case_file SET state = 'approved', decided_at = now(), approval_id = $2 WHERE id = $1`,
      [caseId, await approval(ctx, 'case', caseId, a.userId)], ctx)

    await expect(decide(b)).rejects.toMatchObject(NOT_ALLOWED)
    await decide(c)
  })

  test('volumes have at most 18 digits; per-unit and line volumes are not negative, effects are signed', () => {
    const valid = (fn: string, v: unknown) => value<boolean>(`SELECT ${fn}($1::jsonb)`, [JSON.stringify(v)])

    return Promise.all([
      expect(valid('volumes_valid', { pv: '999999999999999999' })).resolves.toBe(true),
      expect(valid('volumes_valid', { pv: '1000000000000000000' })).resolves.toBe(false),
      expect(valid('volumes_valid', { pv: '-1' })).resolves.toBe(false),
      expect(valid('volume_effect_valid', { total: { pv: '-999999999999999999' } })).resolves.toBe(true),
      expect(valid('volume_effect_valid', { total: { pv: '-1000000000000000000' } })).resolves.toBe(false),
    ])
  })
})
