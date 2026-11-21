// V1-A schema guards and SQL contracts (PLAN V1-A section 1.8a): credit types, lots, expiry and redemption through the ledger
// (FIFO, Σ remainders = liability, origin and balance rules), credit notices, FX batches and rates, provisional calendars,
// periods, origins and the run backstop, order dispute outcomes, account holders, retention schedules, legal holds and the
// classes' due objects, erasure deferrals, offboarding transitions per realm, read-only, and tenant_purge (T-V1A-53).
import { randomBytes, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'vitest'
import { withSystem, withTenant, withVendor, type TenantContext } from '../src/index.js'
import { createTenant, createUser, getOwnerPool, resetTestDb, type TestTenant } from '../src/testing.js'
import { seedTenantRows, seedVendorRows, type TenantSeed } from './seed.js'
import { asUser, closePoolsAfterAll, insertAuditEvent, insertMarket, insertRow, PERMISSION_DENIED } from './support.js'

const CHECK = { code: '23514' }
const NOT_ALLOWED = { code: '42501' }
const UNIQUE = { code: '23505' }
const INVALID = { code: '22023' }
const ZONE = 'Europe/Brussels'

let tenant: TestTenant
let a: TenantContext
let second: TenantContext
let seed: TenantSeed
let be: { marketId: string; calendarId: string; periods: string[] }
let creditTypeId: string

closePoolsAfterAll()

const owner = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await getOwnerPool().query(sql, params)).rows as T[]
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = [], ctx = a): Promise<T[]> =>
  (await withTenant(ctx, (tx) => tx.query(sql, params))).rows as T[]
const value = async <T>(sql: string, params: unknown[] = [], ctx = a): Promise<T> =>
  Object.values((await rows(sql, params, ctx))[0]!)[0] as T

/** An approval of the object by `by` (prepared by the other user), as the approver writes it. */
function approval(objectType: string, objectId: string, by: TenantContext) {
  const preparer = by === a ? second : a
  return withTenant(by, (tx) => insertRow(tx, 'approval', {
    tenant_id: tenant.id, object_type: objectType, object_id: objectId, preparer_id: preparer.userId, approver_id: by.userId,
    decision: 'approved', decided_at: new Date(),
  }))
}

/** A committed run of the period (owner), committed `daysAgo`, with these credit awards, posted by led_post_run (nmp_app). */
async function committedRunWithAwards(periodId: string, daysAgo: number, awards: number[], typeId = creditTypeId): Promise<{ runId: string; awardIds: string[] }> {
  const runId = randomUUID()
  const [made] = await owner<{ id: string }>(
    `INSERT INTO approval (tenant_id, object_type, object_id, preparer_id, approver_id, decision, decided_at, created_by)
     VALUES ($1, 'run', $2, $3, $4, 'approved', now(), $4) RETURNING id`, [tenant.id, runId, a.userId, second.userId])
  await owner(
    `INSERT INTO run (id, tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, snapshot_id, engine_version, state,
       totals, inputs_hash, lines_hash, outputs, prepared_by, review_opened_at, review_opened_by, approval_id, finished_at, committed_at)
     VALUES ($1::uuid, $2, $3, $1::text, $4, $5, (SELECT snapshot_id FROM run WHERE id = $6), 'test', 'committed', '{"gross_minor": "0"}',
       'x', 'x', '{}', $7, now(), $7, $8, now(), now() - make_interval(days => $9))`,
    [runId, tenant.id, periodId, seed.planVersionId, seed.settingsVersionId, seed.runId, a.userId, made!.id, daysAgo])
  const awardIds: string[] = []
  for (const [index, amount] of awards.entries()) {
    const [award] = await owner<{ id: string }>(
      `INSERT INTO credit_award (tenant_id, run_id, market_id, payee_participant_id, payee_position_id, rule_key, credit_type_id, amount_minor,
         currency, taxable, trace) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'EUR', true, '{}') RETURNING id`,
      [tenant.id, runId, be.marketId, seed.participantId, seed.positionId, `loyalty_${index}`, typeId, amount])
    awardIds.push(award!.id)
  }
  await owner(`UPDATE period SET state = 'committed', committed_run_id = $2 WHERE id = $1`, [periodId, runId])
  await rows('SELECT led_post_run($1)', [runId])
  return { runId, awardIds }
}

const lots = () => rows<{ award_id: string; remaining_minor: string; expires_at: Date }>(
  'SELECT award_id, remaining_minor, expires_at FROM credit_lots($1, $2, $3)', [seed.participantId, creditTypeId, be.marketId])
const liability = (typeId = creditTypeId) => value<string>(
  `SELECT coalesce(sum(x.credit_minor - x.debit_minor), 0)::text FROM ledger_account c JOIN posting x ON x.account_id = c.id
   WHERE c.type = 'credit_liability' AND c.payee_participant_id = $1 AND c.credit_type_id = $2 AND c.market_id = $3`,
  [seed.participantId, typeId, be.marketId])

/** A redemption and, unless entry is false, its entry for `posted` (default: the amount), in one transaction. */
function redeem(amount: number, options: { posted?: number; entry?: boolean; marketId?: string; currency?: string; typeId?: string } = {}) {
  return withTenant(a, async (tx) => {
    const marketId = options.marketId ?? be.marketId
    const typeId = options.typeId ?? creditTypeId
    const id = await insertRow(tx, 'credit_redemption', {
      tenant_id: tenant.id, market_id: marketId, participant_id: seed.participantId, credit_type_id: typeId, amount_minor: amount,
      currency: options.currency ?? 'EUR', source_system: 'shop', source_redemption_id: randomUUID(), occurred_at: new Date(),
    })
    if (options.entry === false) return id
    const posted = String(options.posted ?? amount)
    await tx.query(`SELECT ledger_post($1, led_attribution_period($1), 'credit_redeemed', 'credit_redemption', $2, $3, NULL, $4)`, [
      marketId, id, `credit-redeem:${id}`, JSON.stringify([
        { type: 'credit_liability', payee_participant_id: seed.participantId, credit_type_id: typeId, debit_minor: posted, credit_minor: '0' },
        { type: 'settled_clearing', debit_minor: '0', credit_minor: posted },
      ])])
    return id
  })
}

beforeAll(async () => {
  await resetTestDb()
  tenant = await createTenant()
  a = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  second = { tenantId: tenant.id, userId: (await createUser({ tenantId: tenant.id })).id }
  seed = await seedTenantRows(a, second.userId)
  be = await withTenant(a, async (tx) => {
    const marketId = await insertRow(tx, 'market', {
      tenant_id: tenant.id, code: 'BE', currency: 'EUR', minor_unit: 2, time_zone: ZONE, languages: ['en'], market_pack: 'be-1', state: 'draft',
    })
    const calendarId = await insertRow(tx, 'calendar', {
      tenant_id: tenant.id, market_id: marketId, name: 'BE monthly', cadence: 'monthly', cutoff_time_zone: ZONE, first_period_start: '2026-10-01',
    })
    await tx.query(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at)
       SELECT $1, $2, d AT TIME ZONE $3, (d + interval '1 month') AT TIME ZONE $3
       FROM generate_series('2026-10-01'::timestamp, '2027-02-01'::timestamp, interval '1 month') AS d`, [tenant.id, calendarId, ZONE])
    const { rows: periods } = await tx.query<{ id: string }>('SELECT id FROM period WHERE calendar_id = $1 ORDER BY starts_at', [calendarId])
    return { marketId, calendarId, periods: periods.map((p) => p.id) }
  })
})

describe('credit types (D-V1A-03)', () => {
  test('code, expiry pair and scope are checked; the code never changes; a type is not deleted', async () => {
    const make = (fields: Record<string, unknown>) => withTenant(a, (tx) => insertRow(tx, 'credit_type', {
      tenant_id: tenant.id, code: 'PRODUCT_CREDIT', name: 'Product credit', taxable: false, ...fields,
    }))

    await expect(make({ code: 'lower' })).rejects.toMatchObject(CHECK)
    await expect(make({ expiry_days: 30 })).rejects.toMatchObject(CHECK)
    await expect(make({ expiry_days: 30, expiry_notice_days: 31 })).rejects.toMatchObject(CHECK)
    await expect(make({ redemption_scope: {} })).rejects.toMatchObject(CHECK)
    await expect(make({ redemption_scope: { markets: [randomUUID()] } })).rejects.toMatchObject({ code: '23503' })
    await expect(make({ taxable: null })).rejects.toMatchObject({ code: '23502' })
    creditTypeId = await make({ unit_value_minor: 100, expiry_days: 30, expiry_notice_days: 7, redemption_scope: { markets: [be.marketId] } })
    await expect(rows(`UPDATE credit_type SET code = 'OTHER' WHERE id = $1`, [creditTypeId])).rejects.toThrow(PERMISSION_DENIED)
    await expect(owner(`UPDATE credit_type SET code = 'OTHER' WHERE id = $1`, [creditTypeId])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE credit_type SET name = 'Renamed', updated_by = $2 WHERE id = $1`, [creditTypeId, second.userId]))
      .rejects.toMatchObject(NOT_ALLOWED)
    await rows(`UPDATE credit_type SET name = 'Renamed', updated_by = $2, updated_at = now() WHERE id = $1`, [creditTypeId, a.userId])
    await expect(owner('DELETE FROM credit_type WHERE id = $1', [creditTypeId])).rejects.toThrow(/not allowed/)
  })
})

describe('credit lots, expiry and redemption (T-V1A-11..13)', () => {
  let due: string
  let current: string

  test('led_post_run posts Dr commission_expense / Cr credit_liability per payee and type; awards copy their type', async () => {
    due = (await committedRunWithAwards(be.periods[0]!, 45, [900])).awardIds[0]!
    current = (await committedRunWithAwards(be.periods[1]!, 0, [1000])).awardIds[0]!

    expect(await owner('SELECT expiry_days, expiry_notice_days, taxable, unit_value_minor FROM credit_award WHERE id = $1', [due]))
      .toEqual([{ expiry_days: 30, expiry_notice_days: 7, taxable: false, unit_value_minor: '100' }])
    expect(await liability()).toBe('1900')
    expect(await value('SELECT count(*)::int FROM ledger_account WHERE credit_type_id = $1 AND type = $2', [creditTypeId, 'credit_liability'])).toBe(1)
    await expect(owner(`INSERT INTO ledger_account (tenant_id, market_id, type, currency) VALUES ($1, $2, 'credit_liability', 'EUR')`,
      [tenant.id, be.marketId])).rejects.toMatchObject(CHECK)
    expect((await lots()).map((lot) => [lot.award_id, lot.remaining_minor])).toEqual([[due, '900'], [current, '1000']])
  })

  test('a due lot expires once (Dr credit_liability / Cr breakage); a lot not due is refused by the origin guard', async () => {
    expect(await value('SELECT credit_expire_due($1, $2, $3)', [seed.participantId, creditTypeId, be.marketId])).toBe(1)
    expect(await value('SELECT credit_expire_due($1, $2, $3)', [seed.participantId, creditTypeId, be.marketId])).toBe(0)
    expect((await lots()).map((lot) => lot.remaining_minor)).toEqual(['0', '1000'])
    expect(await liability()).toBe('1000')
    expect(await rows(`SELECT kind, amount_minor FROM credit_lot_event WHERE award_id = $1`, [due])).toEqual([{ kind: 'expired', amount_minor: '900' }])
    await expect(rows(`SELECT ledger_post($1, led_attribution_period($1), 'credit_expired', 'credit_award', $2, $3, NULL, $4)`, [
      be.marketId, current, `credit-expire:${current}`, JSON.stringify([
        { type: 'credit_liability', payee_participant_id: seed.participantId, credit_type_id: creditTypeId, debit_minor: '1', credit_minor: '0' },
        { type: 'breakage', debit_minor: '0', credit_minor: '1' },
      ])])).rejects.toMatchObject(NOT_ALLOWED)
  })

  test('a redemption is posted in its transaction, at its amount, never overdrawing; Σ remainders = liability', async () => {
    await redeem(400)
    expect((await lots()).map((lot) => lot.remaining_minor)).toEqual(['0', '600'])
    expect(await liability()).toBe('600')

    await expect(redeem(700)).rejects.toMatchObject(CHECK) // overdraws
    await expect(redeem(100, { entry: false })).rejects.toMatchObject(CHECK) // no entry at COMMIT
    await expect(redeem(100, { posted: 90 })).rejects.toMatchObject(CHECK) // entry of another amount
    await expect(redeem(100, { marketId: seed.marketId, currency: 'GBP' })).rejects.toMatchObject(CHECK) // outside the type's scope
    await expect(redeem(100, { currency: 'GBP' })).rejects.toMatchObject(CHECK) // not the market's currency
    const source = randomUUID()
    const same = { tenant_id: tenant.id, market_id: be.marketId, participant_id: seed.participantId, credit_type_id: creditTypeId,
      amount_minor: 1, currency: 'EUR', source_system: 'shop', source_redemption_id: source, occurred_at: new Date() }
    await expect(withTenant(a, async (tx) => {
      await insertRow(tx, 'credit_redemption', same)
      await insertRow(tx, 'credit_redemption', same)
    })).rejects.toMatchObject(UNIQUE)
    expect(await liability()).toBe('600')
  })

  test('the notice goes once per lot inside its window (credits_to_notify, notify_credit_expiring)', async () => {
    // Another type: a back-dated commit of the first type would take the earlier redemption on replay (credit_lots shortcut).
    const voucher = await withTenant(a, (tx) => insertRow(tx, 'credit_type', {
      tenant_id: tenant.id, code: 'VOUCHER', name: 'Voucher', expiry_days: 30, expiry_notice_days: 7, taxable: true,
    }))
    const soon = (await committedRunWithAwards(be.periods[2]!, 25, [300], voucher)).awardIds[0]!
    const candidates = await withSystem(async (tx) => (await tx.query<{ award_id: string; remaining_minor: string }>(
      'SELECT award_id, remaining_minor FROM credits_to_notify(1000) WHERE tenant_id = $1', [tenant.id])).rows)

    expect(candidates).toEqual([{ award_id: soon, remaining_minor: '300' }])
    await expect(rows('SELECT credits_to_notify(10)')).rejects.toMatchObject(NOT_ALLOWED)
    expect(await value('SELECT notify_credit_expiring($1, 300)', [soon])).toEqual(expect.any(String))
    expect(await value('SELECT notify_credit_expiring($1, 300)', [soon])).toBeNull()
    expect(await rows(`SELECT template, params ->> 'amount_minor' AS amount FROM notification WHERE template = 'credit.expiring'`))
      .toEqual(expect.arrayContaining([{ template: 'credit.expiring', amount: '300' }]))
  })

  test('a redemption never takes a due lot not yet expired; an expiry empties exactly its lot (AC-FIN6-5)', async () => {
    const gift = await withTenant(a, (tx) => insertRow(tx, 'credit_type', {
      tenant_id: tenant.id, code: 'GIFT', name: 'Gift', expiry_days: 30, expiry_notice_days: 7, taxable: false,
    }))
    const lot = (await committedRunWithAwards(be.periods[4]!, 45, [300], gift)).awardIds[0]!
    const expire = (amount: number) => withTenant(a, async (tx) => {
      const { rows: [entry] } = await tx.query<{ id: string }>(
        `SELECT ledger_post($1, led_attribution_period($1), 'credit_expired', 'credit_award', $2, $3, NULL, $4) AS id`, [
          be.marketId, lot, `credit-expire:${lot}`, JSON.stringify([
            { type: 'credit_liability', payee_participant_id: seed.participantId, credit_type_id: gift, debit_minor: String(amount), credit_minor: '0' },
            { type: 'breakage', debit_minor: '0', credit_minor: String(amount) },
          ])])
      await insertRow(tx, 'credit_lot_event', { tenant_id: tenant.id, award_id: lot, kind: 'expired', amount_minor: amount, entry_id: entry!.id })
    })

    await expect(redeem(100, { typeId: gift })).rejects.toMatchObject(CHECK) // the only lot is due: expire first
    await expect(expire(5000)).rejects.toMatchObject(CHECK) // more than the lot holds
    await expect(expire(200)).rejects.toMatchObject(CHECK) // less than the lot holds
    await expire(300)
    expect(await liability(gift)).toBe('0')
    expect(await value('SELECT credit_expire_due($1, $2, $3)', [seed.participantId, gift, be.marketId])).toBe(0)
  })
})

describe('FX batches and rates (D-V1A-04)', () => {
  const row = { base: 'CHF', quote: 'EUR', rate: '1.0412000000', valid_from: '2026-11-01T00:00:00Z' }
  const propose = (rowsJson: unknown) => withTenant(a, (tx) => insertRow(tx, 'fx_rate_batch', {
    tenant_id: tenant.id, source: 'ECB reference', rows: JSON.stringify(rowsJson),
  }))

  test('rows are checked; the proposer cannot approve; rates exist only as rows of an approved batch; latest in force wins', async () => {
    await expect(propose([])).rejects.toMatchObject(CHECK)
    await expect(propose([{ ...row, rate: '1.04' }])).rejects.toMatchObject(CHECK)
    await expect(propose([{ ...row, quote: 'CHF' }])).rejects.toMatchObject(CHECK)
    await expect(propose([row, row])).rejects.toMatchObject(CHECK)
    await expect(propose([{ ...row, valid_from: '2026-13-01T00:00:00Z' }])).rejects.toMatchObject(CHECK)
    const batch = await propose([row, { ...row, rate: '1.0500000000', valid_from: '2026-11-15T00:00:00Z' }])
    const rate = (r: typeof row) => withTenant(a, (tx) => insertRow(tx, 'fx_rate', {
      tenant_id: tenant.id, batch_id: batch, base: r.base, quote: r.quote, rate: r.rate, source: 'ECB reference', valid_from: r.valid_from,
    }))

    await expect(rate(row)).rejects.toMatchObject(CHECK) // batch not approved
    const own = await approval('fx_rate_batch', batch, a)
    await expect(rows(`UPDATE fx_rate_batch SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [batch, own]))
      .rejects.toMatchObject(NOT_ALLOWED)
    const other = await approval('fx_rate_batch', batch, second)
    await rows(`UPDATE fx_rate_batch SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [batch, other])
    await expect(rows(`UPDATE fx_rate_batch SET state = 'rejected' WHERE id = $1`, [batch])).rejects.toMatchObject(NOT_ALLOWED)
    await expect(rate({ ...row, rate: '2.0000000000' })).rejects.toMatchObject(CHECK) // not a row of the batch
    await rate(row)
    await rate({ ...row, rate: '1.0500000000', valid_from: '2026-11-15T00:00:00Z' })
    await expect(rate(row)).rejects.toMatchObject(UNIQUE)

    expect(await rows(`SELECT rate::text, valid_from FROM fx_rate_at('CHF', 'EUR', '2026-11-18T00:00:00Z')`))
      .toEqual([{ rate: '1.0500000000', valid_from: new Date('2026-11-15T00:00:00Z') }])
    expect(await rows(`SELECT rate::text FROM fx_rate_at('CHF', 'EUR', '2026-11-10T00:00:00Z')`)).toEqual([{ rate: '1.0412000000' }])
    expect(await rows(`SELECT * FROM fx_rate_at('CHF', 'EUR', '2026-10-31T00:00:00Z')`)).toEqual([])
  })
})

describe('provisional runs (D-V1A-02, T-V1A-04, T-V1A-07)', () => {
  test('a calendar is provisional for a final calendar of its market; its periods nest; origins offset a committed advance', async () => {
    const calendar = (fields: Record<string, unknown>) => withTenant(a, (tx) => insertRow(tx, 'calendar', {
      tenant_id: tenant.id, market_id: be.marketId, cadence: 'weekly', cutoff_time_zone: ZONE, first_period_start: '2027-01-04', ...fields,
    }))
    await expect(calendar({ name: 'Elsewhere', provisional_for_calendar_id: seed.calendarId })).rejects.toMatchObject(CHECK)
    const weekly = await calendar({ name: 'BE weekly advances', provisional_for_calendar_id: be.calendarId })
    await expect(calendar({ name: 'Chained', provisional_for_calendar_id: weekly })).rejects.toMatchObject(CHECK)
    await expect(owner(`UPDATE calendar SET provisional_for_calendar_id = NULL WHERE id = $1`, [weekly])).rejects.toMatchObject(CHECK)
    const period = (from: string, to: string) => withTenant(a, async (tx) => (await tx.query<{ id: string }>(
      `INSERT INTO period (tenant_id, calendar_id, starts_at, ends_at) VALUES ($1, $2, $3::timestamp AT TIME ZONE $5, $4::timestamp AT TIME ZONE $5)
       RETURNING id`, [tenant.id, weekly, from, to, ZONE])).rows[0]!.id)

    await expect(period('2026-12-28', '2027-01-04')).rejects.toMatchObject({ ...CHECK, detail: 'periods_not_nested' })
    const advance = await period('2027-01-04', '2027-01-11')
    const later = await period('2027-01-11', '2027-01-18')
    const january = be.periods[3]!
    expect(await value('SELECT provisional_final_period($1)', [advance])).toBe(january)
    expect(await value('SELECT provisional_final_period($1)', [january])).toBeNull()

    // A committed advance (owner) paying 6.00 + 4.00 under weekly_advance; a final run of January not yet calculated.
    const provisionalRun = (await committedRunWithAwards(advance, 0, [])).runId
    for (const amount of [600, 400]) {
      await owner(
        `INSERT INTO result_line (tenant_id, run_id, payee_position_id, payee_participant_id, rule_key, bonus_type, source_kind, pass,
           amount_minor, currency, trace) VALUES ($1, $2, $3, $4, 'weekly_advance', 'pay.percent', 'other', 4, $5, 'EUR', '{}')`,
        [tenant.id, provisionalRun, seed.positionId, seed.participantId, amount])
    }
    const finalRun = randomUUID()
    await owner(
      `INSERT INTO run (id, tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, engine_version, prepared_by)
       VALUES ($1::uuid, $2, $3, $1::text, $4, $5, 'test', $6)`, [finalRun, tenant.id, january, seed.planVersionId, seed.settingsVersionId, a.userId])
    const origin = (amount: number, run: string = finalRun, original = advance) => withTenant(a, (tx) => insertRow(tx, 'adjustment_origin', {
      tenant_id: tenant.id, origin_type: 'provisional', provisional_run_id: provisionalRun, run_id: run, payee_position_id: seed.positionId,
      rule_key: 'weekly_advance', source_kind: 'other', amount_minor: amount, original_period_id: original,
    }))

    await expect(origin(-900)).rejects.toMatchObject(CHECK) // not the advance's sum
    await expect(origin(-1000, seed.runId)).rejects.toMatchObject(CHECK) // a run of another period
    await origin(-1000)
    await expect(origin(-1000)).rejects.toMatchObject(UNIQUE) // consumed once
    const [late] = await owner<{ id: string }>('SELECT id FROM late_transaction WHERE tenant_id = $1 LIMIT 1', [tenant.id])
    await expect(withTenant(a, (tx) => insertRow(tx, 'adjustment_origin', {
      tenant_id: tenant.id, origin_type: 'late_transaction', late_transaction_id: late!.id, payee_position_id: seed.positionId,
      rule_key: 'pv', source_kind: 'other', amount_minor: -1, original_period_id: seed.periodId,
    }))).rejects.toMatchObject(CHECK) // a late origin still needs its run
    expect(await rows('SELECT period_id, run_id, run_state FROM provisional_periods_of($1)', [january])).toEqual([
      { period_id: advance, run_id: provisionalRun, run_state: 'committed' }, { period_id: later, run_id: null, run_state: null },
    ])

    // An advance committed after the final run's offsets were made: the final run does not commit without its offset.
    const lastWeek = await period('2027-01-18', '2027-01-25')
    const lateAdvance = (await committedRunWithAwards(lastWeek, 0, [])).runId
    await owner(
      `INSERT INTO result_line (tenant_id, run_id, payee_position_id, payee_participant_id, rule_key, bonus_type, source_kind, pass,
         amount_minor, currency, trace) VALUES ($1, $2, $3, $4, 'weekly_advance', 'pay.percent', 'other', 4, 250, 'EUR', '{}')`,
      [tenant.id, lateAdvance, seed.positionId, seed.participantId])
    await expect(owner(`UPDATE run SET state = 'committed' WHERE id = $1`, [finalRun]))
      .rejects.toMatchObject({ ...CHECK, detail: 'provisional_changed' })

    // January committed: no advance run is requested or committed in it any more (every role).
    await committedRunWithAwards(january, 0, [])
    await expect(owner(
      `INSERT INTO run (tenant_id, period_id, run_request_id, plan_version_id, settings_version_id, engine_version, prepared_by)
       VALUES ($1, $2, 'late', $3, $4, 'test', $5)`, [tenant.id, later, seed.planVersionId, seed.settingsVersionId, a.userId]))
      .rejects.toMatchObject({ ...CHECK, detail: 'final_period_committed' })
  })
})

describe('order events (D-V1A-05)', () => {
  test('a lost dispute names a chargeback of its order; one outcome per chargeback; converted orders carry all originals', async () => {
    const [order] = await owner<{ id: string }>(`SELECT id FROM sales_order WHERE tenant_id = $1 AND source_order_id = 'o1'`, [tenant.id])
    const event = (type: string, fields: Record<string, unknown> = {}) => withTenant(a, async (tx) => insertRow(tx, 'order_event', {
      tenant_id: tenant.id, order_id: order!.id, source_system: 'seed', source_event_id: randomUUID(), type, occurred_at: new Date(),
      lines: '[]', refund_minor: 0, fee_minor: 0, volume_effect: {},
      inbound_event_id: await insertRow(tx, 'inbound_event', {
        tenant_id: tenant.id, source: 'api:seed', idempotency_key: randomUUID(), payload_hash: randomBytes(32), processed_at: new Date(),
        state: 'processed',
      }),
      ...fields,
    }))
    const chargeback = await event('chargeback', { lines: JSON.stringify([{ line_no: 1, quantity: 1 }]) })
    const [returned] = await owner<{ id: string }>(`SELECT id FROM order_event WHERE order_id = $1 AND type = 'return'`, [order!.id])

    await event('subscription_cancelled')
    await expect(event('renewal_failed', { refund_minor: 1 })).rejects.toMatchObject({ ...CHECK, constraint: 'order_event_no_effect' })
    await expect(event('dispute_lost', { dispute_of_event_id: chargeback, volume_effect: { total: { pv: '-1' } } }))
      .rejects.toMatchObject({ ...CHECK, constraint: 'order_event_no_effect' })
    await expect(event('dispute_lost')).rejects.toMatchObject(CHECK)
    await expect(event('dispute_lost', { dispute_of_event_id: returned!.id })).rejects.toMatchObject(CHECK)
    await event('dispute_lost', { dispute_of_event_id: chargeback })
    await expect(event('chargeback_reversed', { reverses_event_id: chargeback, lines: JSON.stringify([{ line_no: 1, quantity: 1 }]) }))
      .rejects.toMatchObject(UNIQUE)
    await expect(event('refund', { original_refund_minor: 5 })).rejects.toMatchObject(CHECK)
    await expect(owner(
      `INSERT INTO sales_order (tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose, purpose_missing,
         attribution_conflict, ordered_at, credited_at, amount_minor, tax_minor, currency, payload_hash, inbound_event_id, created_by,
         created_by_type, original_currency)
       SELECT tenant_id, source_system, 'o-fx', market_id, buyer_id, buyer_type_id, purpose, purpose_missing, attribution_conflict, ordered_at,
         credited_at, amount_minor, tax_minor, currency, payload_hash, inbound_event_id, created_by, created_by_type, 'CHF'
       FROM sales_order WHERE id = $1`, [order!.id]))
      .rejects.toMatchObject(CHECK)
    // A rate of another pair (CHF to EUR, from the FX test) on an order in the market's currency converted from CHF.
    await expect(owner(
      `INSERT INTO sales_order (tenant_id, source_system, source_order_id, market_id, buyer_id, buyer_type_id, purpose, purpose_missing,
         attribution_conflict, ordered_at, credited_at, amount_minor, tax_minor, currency, payload_hash, inbound_event_id, created_by,
         created_by_type, original_currency, original_amount_minor, original_tax_minor, fx_rate_id)
       SELECT tenant_id, source_system, 'o-fx-pair', market_id, buyer_id, buyer_type_id, purpose, purpose_missing, attribution_conflict,
         ordered_at, credited_at, amount_minor, tax_minor, currency, payload_hash, inbound_event_id, created_by, created_by_type, 'CHF',
         amount_minor, tax_minor, (SELECT id FROM fx_rate WHERE tenant_id = $2 AND base = 'CHF' AND quote = 'EUR' LIMIT 1)
       FROM sales_order WHERE id = $1 AND currency <> 'EUR'`, [order!.id, tenant.id]))
      .rejects.toMatchObject({ ...CHECK, message: expect.stringMatching(/rate from its original currency/) })
  })
})

describe('account holders (D-V1A-06, T-V1A-40)', () => {
  test('joint needs a joint holder, entity a signatory, individual none; only type and holders change together', async () => {
    const set = (type: string, holders: unknown) => rows(
      'UPDATE participant SET account_type = $2, account_holders = $3 WHERE id = $1', [seed.participantId, type, JSON.stringify(holders)])

    await expect(set('individual', [{ name: 'A', role: 'joint_holder' }])).rejects.toMatchObject(CHECK)
    await expect(rows(`UPDATE participant SET account_type = 'joint', account_holders = NULL WHERE id = $1`, [seed.participantId]))
      .rejects.toMatchObject(CHECK)
    await expect(set('joint', [{ name: 'A', role: 'authorised_signatory' }])).rejects.toMatchObject(CHECK)
    await expect(set('entity', [{ name: ' ', role: 'authorised_signatory' }])).rejects.toMatchObject(CHECK)
    await expect(set('joint', Array.from({ length: 5 }, () => ({ name: 'A', role: 'joint_holder' })))).rejects.toMatchObject(CHECK)
    await set('joint', [{ name: 'Ann Holder', role: 'joint_holder' }])
    await set('entity', [{ name: 'Sam Signer', role: 'authorised_signatory' }])
    await expect(rows(`UPDATE participant SET account_holders = NULL, display_name = 'x' WHERE id = $1`, [seed.participantId]))
      .rejects.toThrow(PERMISSION_DENIED)
    expect(await value(`SELECT prv_personal_data($1) -> 'participant' -> 'account_holders'`, [seed.participantId]))
      .toEqual([{ name: 'Sam Signer', role: 'authorised_signatory' }])
  })
})

describe('retention and legal holds (D-V1A-08, T-V1A-70..73)', () => {
  /** A proposed schedule approved by `second` (the proposer is a). */
  async function schedule(dataClass: string, retainDays: number, effectiveFrom: string, marketId: string | null = null) {
    const id = await withTenant(a, (tx) => insertRow(tx, 'retention_schedule', {
      tenant_id: tenant.id, data_class: dataClass, market_id: marketId, retain_days: retainDays, basis: 'statute', effective_from: effectiveFrom,
    }))
    await rows(`UPDATE retention_schedule SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [
      id, await approval('retention_schedule', id, second)])
    return id
  }

  // Another tenant's newer all-markets schedules of both classes: the definers (which bypass RLS) must not pick them.
  beforeAll(async () => {
    const other = await createTenant()
    const [proposer, approver] = [(await createUser({ tenantId: other.id })).id, (await createUser({ tenantId: other.id })).id]
    for (const dataClass of ['privacy_request', 'terminated_participant']) {
      const id = await withTenant({ tenantId: other.id, userId: proposer }, async (tx) => (await tx.query<{ id: string }>(
        `INSERT INTO retention_schedule (tenant_id, data_class, retain_days, basis, effective_from)
         VALUES ($1, $2, 3650, 'statute', current_date) RETURNING id`, [other.id, dataClass])).rows[0]!.id)
      await withTenant({ tenantId: other.id, userId: approver }, async (tx) => {
        const decision = await insertRow(tx, 'approval', {
          tenant_id: other.id, object_type: 'retention_schedule', object_id: id, preparer_id: proposer, approver_id: approver,
          decision: 'approved', decided_at: new Date(),
        })
        await tx.query(`UPDATE retention_schedule SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [id, decision])
      })
    }
  })

  test('schedules: one proposal per class and market, decided by another user; the market row wins', async () => {
    const proposed = await withTenant(a, (tx) => insertRow(tx, 'retention_schedule', {
      tenant_id: tenant.id, data_class: 'terminated_participant', retain_days: 30, basis: 'statute', effective_from: '2026-01-01',
    }))
    await expect(withTenant(second, (tx) => insertRow(tx, 'retention_schedule', {
      tenant_id: tenant.id, data_class: 'terminated_participant', retain_days: 60, basis: 'statute', effective_from: '2026-01-01',
    }))).rejects.toMatchObject(UNIQUE)
    await expect(rows(`UPDATE retention_schedule SET state = 'approved', approval_id = $2, decided_at = now() WHERE id = $1`, [
      proposed, await approval('retention_schedule', proposed, a)])).rejects.toMatchObject(NOT_ALLOWED)
    await rows(`UPDATE retention_schedule SET state = 'rejected', approval_id = $2, decided_at = now() WHERE id = $1`, [
      proposed, await withTenant(second, (tx) => insertRow(tx, 'approval', {
        tenant_id: tenant.id, object_type: 'retention_schedule', object_id: proposed, preparer_id: a.userId, approver_id: second.userId,
        decision: 'rejected', decided_at: new Date(),
      }))])
    const all = await schedule('terminated_participant', 30, '2026-01-01')
    const own = await schedule('terminated_participant', 90, '2026-01-01', be.marketId)

    expect(await value(`SELECT retention_schedule_in_force('terminated_participant', $1, current_date)`, [seed.marketId])).toBe(all)
    expect(await value(`SELECT retention_schedule_in_force('terminated_participant', $1, current_date)`, [be.marketId])).toBe(own)
    await expect(owner(`INSERT INTO retention_run (tenant_id, schedule_id, started_at, finished_at, due, applied, held, deferred, items)
      VALUES ($1, $2, now(), now(), 0, 0, 0, 0, '[{"object_type": "participant", "object_id": "x", "outcome": "applied"}]')`, [tenant.id, all]))
      .rejects.toMatchObject(CHECK)
  })

  test('a due terminated participant: held while a hold is active (released by another user), then pseudonymised', async () => {
    const [x] = await owner<{ id: string }>(
      `INSERT INTO participant (tenant_id, external_ref, account_type, account_holders, market_id, display_name, enrolled_at, created_by, created_by_type)
       VALUES ($1, 'leaver', 'joint', '[{"name": "Lee Ver", "role": "joint_holder"}]', $2, 'Lee', '2020-01-01', $3, 'user') RETURNING id`,
      [tenant.id, seed.marketId, a.userId])
    const [position] = await owner<{ id: string }>(
      `INSERT INTO position (tenant_id, position_ref, market_id, status, status_from, created_by, created_by_type)
       VALUES ($1, 'leaver-1', $2, 'terminated', '2025-09-01', $3, 'user') RETURNING id`, [tenant.id, seed.marketId, a.userId])
    await owner(`INSERT INTO position_ownership (tenant_id, position_id, participant_id, valid_from, created_by, created_by_type)
      VALUES ($1, $2, $3, '2020-01-01', $4, 'user')`, [tenant.id, position!.id, x!.id, a.userId])
    const scheduleId = await value<string>(`SELECT retention_schedule_in_force('terminated_participant', $1, current_date)`, [seed.marketId])
    const due = () => rows<{ object_id: string; held: boolean }>(
      `SELECT object_id, held FROM prv_retention_due($1, 1000) WHERE object_type = 'participant'`, [scheduleId])

    expect(await due()).toEqual([{ object_id: x!.id, held: false }])
    const hold = await withTenant(a, (tx) => insertRow(tx, 'legal_hold', { tenant_id: tenant.id, participant_id: x!.id, reason: 'litigation' }))
    expect(await due()).toEqual([{ object_id: x!.id, held: true }])
    await expect(rows('SELECT prv_retention_erase($1, $2)', [scheduleId, x!.id])).rejects.toMatchObject({ code: 'PV001' })
    await expect(rows('SELECT prv_retention_due($1, 0)', [scheduleId])).rejects.toMatchObject(INVALID)
    expect(await rows('SELECT id FROM legal_hold', [], { ...a, participantId: seed.participantId })).toEqual([])
    await expect(rows('UPDATE legal_hold SET released_by = $2, released_at = now() WHERE id = $1', [hold, a.userId])).rejects.toMatchObject(CHECK)
    await rows('UPDATE legal_hold SET released_by = $2, released_at = now() WHERE id = $1', [hold, second.userId], second)
    await expect(rows('UPDATE legal_hold SET released_at = now() WHERE id = $1', [hold], second)).rejects.toMatchObject(CHECK)

    const result = await value<{ cleared: string[] }>('SELECT prv_retention_erase($1, $2)', [scheduleId, x!.id])
    expect(result.cleared).toContain('participant.account_holders')
    expect(await owner('SELECT display_name, account_holders, pseudonymised_at IS NOT NULL AS erased FROM participant WHERE id = $1', [x!.id]))
      .toEqual([{ display_name: null, account_holders: null, erased: true }])
    expect(await due()).toEqual([])
    await expect(rows('SELECT prv_retention_erase($1, $2)', [scheduleId, x!.id])).rejects.toMatchObject(INVALID)
  })

  test('erasure is deferred by a legal hold and by unexpired credits still owed (C-V1A-19)', async () => {
    const hold = await withTenant(a, (tx) => insertRow(tx, 'legal_hold', { tenant_id: tenant.id, participant_id: seed.participantId, reason: 'claim' }))
    const blockers = await value<{ reason: string }[]>('SELECT prv_erasure_blockers($1)', [seed.participantId])

    expect(blockers).toEqual(expect.arrayContaining([
      { reason: 'legal_hold', hold_id: hold },
      { reason: 'credits_outstanding', market_id: be.marketId, credit_type_id: creditTypeId, amount_minor: '600' },
    ]))
    await rows('UPDATE legal_hold SET released_by = $2, released_at = now() WHERE id = $1', [hold, second.userId], second)
  })

  test('a due closed request: sealed data cleared, its export deleted, sha256 and size kept', async () => {
    await rows(`UPDATE privacy_request SET outcome = 'fulfilled', closed_at = now() - interval '400 days' WHERE id = $1`, [seed.privacyRequestId])
    await expect(rows('SELECT prv_retention_clear_request($1)', [seed.privacyRequestId])).rejects.toMatchObject(INVALID) // 3650 days in force
    const [kept] = await owner<{ sha: Buffer; bytes: number }>(
      'SELECT content_sha256 AS sha, length(content) AS bytes FROM privacy_export WHERE request_id = $1', [seed.privacyRequestId])
    const scheduleId = await schedule('privacy_request', 30, '2026-06-01')

    expect(await rows(`SELECT object_id, held FROM prv_retention_due($1, 10)`, [scheduleId])).toEqual([{ object_id: seed.privacyRequestId, held: false }])
    await expect(rows(`UPDATE privacy_request SET retention_cleared_at = now() WHERE id = $1`, [seed.privacyRequestId])).rejects.toThrow(PERMISSION_DENIED)
    await rows('SELECT prv_retention_clear_request($1)', [seed.privacyRequestId])
    expect(await owner('SELECT count(*)::int AS n FROM privacy_export WHERE request_id = $1', [seed.privacyRequestId])).toEqual([{ n: 0 }])
    expect(await owner(`SELECT export_sha256 AS sha, export_bytes AS bytes, requester_sealed, retention_cleared_at IS NOT NULL AS cleared
      FROM privacy_request WHERE id = $1`, [seed.privacyRequestId])).toEqual([{ sha: kept!.sha, bytes: kept!.bytes, requester_sealed: null, cleared: true }])
    await expect(rows('SELECT prv_retention_clear_request($1)', [seed.privacyRequestId])).rejects.toMatchObject(INVALID)
  })
})

describe('offboarding (D-V1A-07, T-V1A-50..53)', () => {
  test('blockers: ids for the tenant\'s staff, counts only for the vendor; a blocked confirmation is refused; cancel', async () => {
    const vendor = (await createUser({ tenantId: null })).id
    await seedVendorRows(vendor, tenant.id)
    const ownView = await rows<{ kind: string; count: string; ids: string[] | null }>('SELECT kind, count, ids FROM offboarding_blockers($1)', [tenant.id])
    const vendorView = await withVendor({ userId: vendor }, async (tx) => (await tx.query<{ kind: string; ids: string[] | null }>(
      'SELECT kind, ids FROM offboarding_blockers($1)', [tenant.id])).rows)

    expect(ownView.map((b) => b.kind)).toEqual(['run_open', 'period_not_closed', 'payout_batch_open', 'payout_in_transit',
      'payables_outstanding', 'receivables_outstanding', 'case_open', 'privacy_request_open', 'export_running', 'credits_outstanding'])
    expect(ownView.find((b) => b.kind === 'period_not_closed')!.ids).toContain(seed.periodId)
    expect(vendorView.every((b) => b.ids === null)).toBe(true)
    await expect(rows('SELECT * FROM offboarding_blockers($1)', [tenant.id], { ...a, participantId: seed.participantId })).rejects.toMatchObject(NOT_ALLOWED)
    const [request] = await rows<{ id: string }>(`SELECT id FROM tenant_offboarding WHERE state = 'requested'`)
    await expect(rows(`UPDATE tenant_offboarding SET state = 'confirmed', confirmed_by = $2, confirmed_at = now(), retention_basis = 'law',
      retention_months = 12, acknowledged_warnings = '{credits_outstanding}' WHERE id = $1`, [request!.id, a.userId]))
      .rejects.toMatchObject({ ...CHECK, detail: 'offboarding_blocked' })
    expect(await value('SELECT tenant_read_only($1)', [tenant.id])).toBe(false)
    await withVendor({ userId: vendor }, (tx) => tx.query(
      `UPDATE tenant_offboarding SET state = 'cancelled', closed_by = $2, closed_at = now() WHERE id = $1`, [request!.id, vendor]))
    expect(await owner('SELECT state FROM tenant_offboarding WHERE id = $1', [request!.id])).toEqual([{ state: 'cancelled' }])
  })

  test('request, confirm (read-only), archive with a later export, purge request and independent approval, then tenant_purge', async () => {
    const other = await createTenant()
    const staff = { tenantId: other.id, userId: (await createUser({ tenantId: other.id, passwordHash: 'x' })).id }
    const [v1, v2] = [(await createUser({ tenantId: null })).id, (await createUser({ tenantId: null })).id]
    await owner('UPDATE user_account SET mfa_enrolled = true WHERE id = ANY ($1)', [[v1, v2]])
    const otherMarket = await withTenant(staff, async (tx) => {
      await insertAuditEvent(tx, other.id, 'TEST.PURGE')
      return insertMarket(tx, other.id)
    })
    await owner(`SELECT pgboss.create_queue('v1a-purge-test', '{"policy": "standard"}')`)
    await owner(`INSERT INTO pgboss.job (name, data) VALUES ('v1a-purge-test', $1), ('v1a-purge-test', $2)`,
      [{ tenantId: other.id, payload: {} }, { tenantId: tenant.id, payload: {} }])
    /** Rows of the tenant per table with a tenant_id column (the table list is materialised first: no count on a table without it). */
    const rowsPerTable = (tenantId: string) => owner<{ name: string; n: number }>(`
      WITH t AS MATERIALIZED (
        SELECT c.oid FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
        WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relnamespace IN ('public'::regnamespace, 'audit'::regnamespace))
      SELECT t.oid::regclass::text AS name,
             (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s WHERE tenant_id = %L', t.oid::regclass, $1::text), false, true, '')))[1]::text::int AS n
      FROM t ORDER BY 1`, [tenantId])
    const tenantATotals = () => rowsPerTable(tenant.id)
    const before = await tenantATotals()
    const asVendor = (user: string, sql: string, params: unknown[]) => withVendor({ userId: user }, (tx) => tx.query(sql, params))
    /** Foreign keys with a referencing row whose referenced row is gone (MATCH SIMPLE: a row with a NULL key column is skipped). */
    const danglingKeys = () => owner<{ name: string }>(`
      WITH k AS MATERIALIZED (
        SELECT k.conname, format('SELECT count(*) AS n FROM %s c WHERE (%s) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE (%s) = (%s))',
                 k.conrelid::regclass, cols.c, k.confrelid::regclass, cols.p, cols.c) AS sql
        FROM pg_constraint k
        CROSS JOIN LATERAL (
          SELECT string_agg(format('c.%I', ca.attname), ', ' ORDER BY u.i) AS c, string_agg(format('p.%I', pa.attname), ', ' ORDER BY u.i) AS p
          FROM unnest(k.conkey, k.confkey) WITH ORDINALITY AS u (ck, pk, i)
          JOIN pg_attribute ca ON ca.attrelid = k.conrelid AND ca.attnum = u.ck
          JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = u.pk) cols
        WHERE k.contype = 'f' AND k.connamespace IN ('public'::regnamespace, 'audit'::regnamespace))
      SELECT conname AS name FROM k WHERE (xpath('/row/n/text()', query_to_xml(k.sql, false, true, '')))[1]::text::int > 0 ORDER BY 1`)
    // An earlier offboarding of the tenant, restored a year ago (owner: back-dated).
    const [stale] = await owner<{ id: string }>(
      `INSERT INTO tenant_offboarding (tenant_id, state, reason, previous_state, requested_by, requested_at, confirmed_by, confirmed_at,
         retention_basis, retention_months, acknowledged_warnings, export_id, archived_by, archived_at, closed_by, closed_at)
       VALUES ($1, 'restored', 'earlier', 'live', $2, now() - interval '1 year', $3, now() - interval '1 year', 'law', 1, '{}',
         gen_random_uuid(), $2, now() - interval '1 year', $3, now() - interval '11 months') RETURNING id`, [other.id, v1, staff.userId])

    await expect(withTenant(staff, (tx) => insertRow(tx, 'tenant_offboarding', {
      tenant_id: other.id, state: 'requested', reason: 'contract ended', previous_state: 'live', requested_by: staff.userId,
    }))).rejects.toMatchObject(NOT_ALLOWED)
    const [request] = (await asVendor(v1, `INSERT INTO tenant_offboarding (tenant_id, state, reason, previous_state, requested_by)
      VALUES ($1, 'requested', 'contract ended', 'live', $2) RETURNING id`, [other.id, v1])).rows as { id: string }[]
    const id = request!.id
    await expect(asVendor(v1, `UPDATE tenant_offboarding SET state = 'confirmed', confirmed_by = $2, confirmed_at = now(), retention_basis = 'law',
      retention_months = 1, acknowledged_warnings = '{}' WHERE id = $1`, [id, v1])).rejects.toMatchObject(NOT_ALLOWED)
    const confirm = (warnings: string) => withTenant(staff, (tx) => tx.query(`UPDATE tenant_offboarding SET state = 'confirmed',
      confirmed_by = $2, confirmed_at = now(), retention_basis = 'law', retention_months = 1, acknowledged_warnings = $3 WHERE id = $1`,
      [id, staff.userId, warnings]))
    await expect(confirm('{junk}')).rejects.toMatchObject({ ...CHECK, constraint: 'tenant_offboarding_warnings' })
    await confirm('{}')
    expect(await withTenant(staff, async (tx) => (await tx.query('SELECT tenant_read_only($1) AS ro', [other.id])).rows[0])).toEqual({ ro: true })
    expect(await withSystem(async (tx) => (await tx.query('SELECT tenant_read_only($1) AS ro', [other.id])).rows[0])).toEqual({ ro: true })
    await expect(rows('SELECT tenant_read_only($1)', [other.id])).rejects.toMatchObject(NOT_ALLOWED) // another tenant's realm

    const archive = (exportId: string | null) => asVendor(v1,
      `UPDATE tenant_offboarding SET state = 'archived', export_id = $2, archived_by = $3, archived_at = now() WHERE id = $1`, [id, exportId, v1])
    await expect(archive(null)).rejects.toMatchObject(CHECK)
    const [job] = await owner<{ id: string }>(`INSERT INTO export_job (tenant_id, kind, state, created_by_type) VALUES ($1, 'full_data', 'done', 'system')
      RETURNING id`, [other.id])
    const [made] = await owner<{ id: string }>(`INSERT INTO data_export (tenant_id, trigger, model_version, requested_by_type)
      VALUES ($1, 'manual', 1, 'system') RETURNING id`, [other.id])
    await owner(`UPDATE data_export SET state = 'running', snapshot_at = now() WHERE id = $1`, [made!.id])
    await owner(`UPDATE data_export SET state = 'completed', export_job_id = $2, manifest = '{}', signature = $3, finished_at = now() WHERE id = $1`,
      [made!.id, job!.id, randomBytes(64)])
    await archive(made!.id)
    expect(await owner('SELECT state FROM tenant WHERE id = $1', [other.id])).toEqual([{ state: 'archived' }])
    // Only the archive/restore trigger moves the tenant: a stale 'restored' record cannot lift the archive from any realm.
    await expect(rows('SELECT tenant_set_offboarding_state($1)', [stale!.id])).rejects.toThrow(PERMISSION_DENIED)
    await expect(asVendor(v1, 'SELECT tenant_set_offboarding_state($1)', [stale!.id])).rejects.toThrow(PERMISSION_DENIED)
    expect(await owner('SELECT state FROM tenant WHERE id = $1', [other.id])).toEqual([{ state: 'archived' }])

    // An erasure while archived expires the tenant's other exports but keeps the pinned one (rolled back afterwards).
    const client = await getOwnerPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('app.realm', 'tenant', true), set_config('app.tenant_id', $1, true)`, [other.id])
      const { rows: [subject] } = await client.query<{ id: string }>(
        `INSERT INTO participant (tenant_id, external_ref, account_type, market_id, display_name, enrolled_at, created_by, created_by_type)
         VALUES ($1, 'erased', 'individual', $2, 'Ed', '2020-01-01', $3, 'user') RETURNING id`, [other.id, otherMarket, staff.userId])
      const { rows: [later] } = await client.query<{ id: string }>(`INSERT INTO data_export (tenant_id, trigger, model_version, requested_by_type)
        VALUES ($1, 'manual', 1, 'system') RETURNING id`, [other.id])
      await client.query(`UPDATE data_export SET state = 'running', snapshot_at = now() WHERE id = $1`, [later!.id])
      await client.query(`UPDATE data_export SET state = 'completed', export_job_id = $2, manifest = '{}', signature = $3, finished_at = now()
        WHERE id = $1`, [later!.id, job!.id, randomBytes(64)])
      const { rows: [erased] } = await client.query<{ r: { exports: unknown[] } }>('SELECT prv_erase_subject($1, $2, NULL) AS r', [
        other.id, subject!.id])

      expect(erased!.r.exports).toEqual([{ id: later!.id, state: 'expired' }])
      expect((await client.query('SELECT state FROM data_export WHERE id = $1', [made!.id])).rows).toEqual([{ state: 'completed' }])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }

    const requestPurge = () => asVendor(v1, `UPDATE tenant_offboarding SET state = 'purge_requested', purge_requested_by = $2,
      purge_requested_at = now() WHERE id = $1`, [id, v1])
    await expect(requestPurge()).rejects.toMatchObject({ ...CHECK, detail: 'retention_not_elapsed' })
    await owner(`UPDATE tenant_offboarding SET archived_at = now() - interval '2 months' WHERE id = $1`, [id])
    await requestPurge()
    const approve = (user: string) => asVendor(user, `UPDATE tenant_offboarding SET state = 'purge_approved', purge_approved_by = $2,
      purge_approved_at = now() WHERE id = $1`, [id, user])
    await expect(approve(v1)).rejects.toMatchObject(NOT_ALLOWED)
    await approve(v2)

    await expect(asVendor(v1, 'SELECT tenant_purge($1, $2)', [other.id, other.slug])).rejects.toThrow(PERMISSION_DENIED)
    await expect(owner('SELECT tenant_purge($1, $2)', [other.id, 'wrong'])).rejects.toMatchObject(INVALID)
    const [{ tenant_purge: summary }] = await owner<{ tenant_purge: { rows: number } }>('SELECT tenant_purge($1, $2)', [other.id, other.slug]) as [
      { tenant_purge: { rows: number } }]

    expect(summary.rows).toBeGreaterThan(0)
    expect((await rowsPerTable(other.id)).filter((row) => row.n > 0)).toEqual([{ name: 'tenant_offboarding', n: 2 }])
    expect(await danglingKeys()).toEqual([])
    // pgboss survives resetTestDb: earlier runs' jobs name other tenants.
    expect(await owner(`SELECT data ->> 'tenantId' AS t FROM pgboss.job WHERE name = 'v1a-purge-test' AND data ->> 'tenantId' = ANY ($1)`,
      [[tenant.id, other.id]])).toEqual([{ t: tenant.id }])
    expect(await owner('SELECT count(*)::int AS n FROM password_credential WHERE user_id = $1', [staff.userId])).toEqual([{ n: 0 }])
    expect(await owner('SELECT state, purge_summary IS NOT NULL AS summarised FROM tenant_offboarding WHERE id = $1', [id]))
      .toEqual([{ state: 'purged', summarised: true }])
    expect(await owner('SELECT count(*)::int AS n FROM tenant WHERE id = $1', [other.id])).toEqual([{ n: 1 }])
    expect(await tenantATotals()).toEqual(before)
    await expect(owner('SELECT tenant_purge($1, $2)', [other.id, other.slug])).rejects.toMatchObject({ code: '55000' })
  })
})
