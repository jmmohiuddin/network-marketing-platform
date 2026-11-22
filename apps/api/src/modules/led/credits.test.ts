import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { iamModule } from '../iam/index.js'
import { creditExpiryCron } from './credit-expiry.js'
import { ledModule } from './index.js'
import { apiKey, asKey, award, creditType, ledWorld, liability, participant, type LedWorld } from './test-support.js'

// PLAN V1-A 2.1 / 4.3: credit types (T-V1A-10), redemptions (T-V1A-12, concurrent double-redeem), the expiry cron (T-V1A-13).

let app: FastifyInstance
let w: LedWorld
let other: LedWorld
let token: string
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  w = await ledWorld()
  other = await ledWorld()
  app = await buildTestApp({ modules: [iamModule, ledModule] })
  token = await apiKey(app, w.minter, ['credits:write'])
}, 120_000)

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })
const redeem = (body: Record<string, unknown>, key = token, idempotencyKey?: string) => asKey(app, key, '/v1/credit-redemptions', {
  source_redemption_id: `r-${randomUUID()}`, market: 'GB', amount_minor: '100', occurred_at: new Date().toISOString(), ...body,
}, idempotencyKey)

describe('credit types (T-V1A-10, AC-FIN6-1)', () => {
  const create = (as: TestUser, body: Record<string, unknown>, withKey = true) =>
    call(app, { method: 'POST', url: '/v1/credit-types', as, body, ...(withKey ? { idempotencyKey: true as const } : {}) })
  const valid = (code: string) => ({ code, name: 'Product credit', unit_value_minor: '100', expiry_days: 30, expiry_notice_days: 7, redemption_scope: { item_classes: ['product'] }, taxable: false })

  test('created with every term given, no defaults; the code never changes; later awards copy the changed terms', async () => {
    const created = await create(w.finance, valid('PRODUCT_CREDIT'))
    expect(created.statusCode, created.body).toBe(201)
    const type = created.json().data
    expect(type).toMatchObject({ code: 'PRODUCT_CREDIT', unit_value_minor: '100', expiry_days: 30, expiry_notice_days: 7, taxable: false, active: true })
    const holder = await participant(w.tenant.id, w.market)
    const before = await award(w, holder.id, type.id, '500', ago(1))

    const patched = await call(app, { method: 'PATCH', url: `/v1/credit-types/${type.id}`, as: w.finance, body: { expected_updated_at: type.updated_at, expiry_days: 10, expiry_notice_days: 5, name: 'Renamed' } })
    expect(patched.statusCode, patched.body).toBe(200)
    expect(patched.json().data).toMatchObject({ code: 'PRODUCT_CREDIT', name: 'Renamed', expiry_days: 10, expiry_notice_days: 5 })
    const after = await award(w, holder.id, type.id, '500', ago(1))
    const terms = await ownerRows<{ id: string; expiry_days: number }>('SELECT id, expiry_days FROM credit_award WHERE id = ANY ($1) ORDER BY expiry_days', [[before, after]])
    expect(terms).toEqual([{ id: after, expiry_days: 10 }, { id: before, expiry_days: 30 }])

    const stale = await call(app, { method: 'PATCH', url: `/v1/credit-types/${type.id}`, as: w.finance, body: { expected_updated_at: type.updated_at, name: 'Again' } })
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, 'STALE_VERSION'])
    expect((await call(app, { method: 'PATCH', url: `/v1/credit-types/${type.id}`, as: w.finance, body: { expected_updated_at: patched.json().data.updated_at, code: 'OTHER' } })).statusCode).toBe(400)
    expect(await auditActions(w.tenant.id)).toEqual(expect.arrayContaining(['CREDIT_TYPE.CREATED', 'CREDIT_TYPE.UPDATED']))
  })

  test('validation: taxable required, expiry and notice together, notice within expiry, scope markets of the tenant, code once', async () => {
    const { taxable: _taxable, ...noTaxable } = valid('NO_TAX')
    expect((await create(w.finance, noTaxable)).statusCode).toBe(400)
    const half = await create(w.finance, { ...valid('HALF'), expiry_notice_days: undefined })
    expect([half.statusCode, half.json().error.details]).toEqual([422, { field: 'expiry_notice_days' }])
    expect((await create(w.finance, { ...valid('LATE'), expiry_days: 5, expiry_notice_days: 6 })).json().error.details).toEqual({ field: 'expiry_notice_days' })
    expect((await create(w.finance, { ...valid('ELSEWHERE'), redemption_scope: { markets: [other.market] } })).json().error.code).toBe('MARKET_NOT_FOUND')
    expect((await create(w.finance, { ...valid('EMPTY'), redemption_scope: {} })).statusCode).toBe(400)
    expect((await create(w.finance, valid('TWICE'))).statusCode).toBe(201)
    expect((await create(w.finance, valid('TWICE'))).json().error.code).toBe('CODE_TAKEN')
    expect((await create(w.finance, valid('lower'))).statusCode).toBe(400)
  })

  test('credit.manage for all markets with step-up; reads need credit.read; another tenant sees none of it', async () => {
    const scoped = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Finance approver'], marketIds: [w.market], stepUp: true })
    const stale = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Finance approver'] })
    const planner = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Plan administrator'], stepUp: true })
    expect((await create(w.analyst, valid('ANALYST'))).statusCode).toBe(403)
    expect((await create(scoped, valid('SCOPED'))).json().error.code).toBe('SCOPE_NOT_HELD')
    expect((await create(stale, valid('STALE'))).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await create(w.finance, valid('NO_KEY'), false)).json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    // SC-04: plan.edit holders list the catalogue to choose a rule's credit type; a role with neither permission does not.
    expect((await get(planner, '/v1/credit-types')).statusCode).toBe(200)
    const compliance = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Compliance officer'] })
    expect((await get(compliance, '/v1/credit-types')).statusCode).toBe(403)
    const listed = await get(w.support, '/v1/credit-types?active=true')
    expect(listed.json().data.map((t: { code: string }) => t.code)).toContain('PRODUCT_CREDIT')
    expect((await get(other.support, '/v1/credit-types')).json().data).toEqual([])
    const id = listed.json().data[0].id as string
    expect((await call(app, { method: 'PATCH', url: `/v1/credit-types/${id}`, as: other.finance, body: { expected_updated_at: new Date().toISOString(), name: 'x' } })).statusCode).toBe(404)
  })
})

describe('redemptions (T-V1A-12, AC-FIN6-3, AC-FIN6-5)', () => {
  let free: string
  let scopedType: string

  beforeAll(async () => {
    free = await creditType(w.tenant.id, w.finance.id, 'FREE')
    scopedType = await creditType(w.tenant.id, w.finance.id, 'SCOPED', { expiry: [30, 7], scope: { markets: [w.market], item_classes: ['product'] } })
  })

  test('up to the balance: Dr credit_liability / Cr settled_clearing; the same source id is the first result, never a second posting', async () => {
    const holder = await participant(w.tenant.id, w.market)
    await award(w, holder.id, free, '1000', ago(2))
    const body = { participant_external_ref: holder.ref, credit_type: 'FREE', amount_minor: '400', source_redemption_id: `r-${randomUUID()}` }
    const first = await redeem(body)
    expect(first.statusCode, first.body).toBe(201)
    const redemption = first.json().data.redemption
    expect(redemption).toMatchObject({ amount_minor: '400', currency: 'GBP', available_after_minor: '600', entry_id: expect.any(String) })
    const postings = await ownerRows<{ type: string; debit_minor: string; credit_minor: string }>(
      `SELECT a.type, x.debit_minor::text, x.credit_minor::text FROM posting x JOIN ledger_account a ON a.id = x.account_id
       WHERE x.entry_id = $1 ORDER BY a.type`, [redemption.entry_id])
    expect(postings).toEqual([{ type: 'credit_liability', debit_minor: '400', credit_minor: '0' }, { type: 'settled_clearing', debit_minor: '0', credit_minor: '400' }])

    const again = await redeem(body)
    expect([again.statusCode, again.json().data.redemption.id, again.json().data.replayed]).toEqual([200, redemption.id, true])
    expect((await redeem({ ...body, amount_minor: '401' })).json().error.code).toBe('REDEMPTION_CONFLICT')
    expect(await liability(w.tenant.id, holder.id, free, w.market)).toEqual({ balance: '600', lots: '600' })

    const over = await redeem({ participant_external_ref: holder.ref, credit_type: 'FREE', amount_minor: '601' })
    expect([over.statusCode, over.json().error.code]).toEqual([422, 'CREDIT_INSUFFICIENT'])
    expect(await auditActions(w.tenant.id)).toContain('CREDIT.REDEEMED')

    const read = await get(w.support, `/v1/credits/redemptions?participant_id=${holder.id}`)
    expect(read.json().data).toEqual([expect.objectContaining({ id: redemption.id, entry_id: redemption.entry_id, amount_minor: '400', source_redemption_id: body.source_redemption_id })])
  })

  test('refusals: expired lots, out of scope, unknown participant, type or market, no committed period', async () => {
    const holder = await participant(w.tenant.id, w.market)
    await award(w, holder.id, scopedType, '500', ago(40)) // due 9 days ago
    await award(w, holder.id, scopedType, '200', ago(1))
    const expired = await redeem({ participant_external_ref: holder.ref, credit_type: 'SCOPED', amount_minor: '600', item_class: 'product' })
    expect([expired.statusCode, expired.json().error.code, expired.json().error.details]).toEqual([422, 'CREDIT_EXPIRED', { available_minor: '200' }])
    expect((await redeem({ participant_external_ref: holder.ref, credit_type: 'SCOPED', amount_minor: '701', item_class: 'product' })).json().error.code).toBe('CREDIT_INSUFFICIENT')
    expect((await redeem({ participant_external_ref: holder.ref, credit_type: 'SCOPED', amount_minor: '10', item_class: 'service' })).json().error.code).toBe('REDEMPTION_OUT_OF_SCOPE')
    expect((await redeem({ participant_external_ref: holder.ref, credit_type: 'SCOPED', amount_minor: '10' })).json().error.code).toBe('REDEMPTION_OUT_OF_SCOPE')

    // A redemption first expires the holder's due lots (posted in its transaction), then takes from the rest.
    const ok = await redeem({ participant_external_ref: holder.ref, credit_type: 'SCOPED', amount_minor: '150', item_class: 'product' })
    expect(ok.statusCode, ok.body).toBe(201)
    expect(ok.json().data.redemption.available_after_minor).toBe('50')
    expect(await liability(w.tenant.id, holder.id, scopedType, w.market)).toEqual({ balance: '50', lots: '50' })
    const [breakage] = await ownerRows<{ amount: string }>(
      `SELECT sum(x.credit_minor)::text AS amount FROM posting x JOIN ledger_account a ON a.id = x.account_id
       WHERE a.tenant_id = $1 AND a.type = 'breakage'`, [w.tenant.id])
    expect(breakage!.amount).toBe('500')

    expect((await redeem({ participant_external_ref: 'nobody', credit_type: 'FREE' })).json().error.code).toBe('PARTICIPANT_NOT_FOUND')
    expect((await redeem({ participant_external_ref: holder.ref, credit_type: 'NOPE' })).json().error.code).toBe('CREDIT_TYPE_UNKNOWN')
    expect((await redeem({ participant_external_ref: holder.ref, credit_type: 'FREE', market: 'ZZ' })).json().error.code).toBe('MARKET_NOT_FOUND')
    await createMarket(w.tenant.id, 'IE')
    expect((await redeem({ participant_external_ref: holder.ref, credit_type: 'FREE', market: 'IE' })).json().error.code).toBe('NO_COMMITTED_PERIOD')
    expect((await redeem({ participant_external_ref: holder.ref, credit_type: 'FREE', amount_minor: '0' })).statusCode).toBe(400)
  })

  test('key only, scope credits:write; another tenant\'s key finds no participant of this one', async () => {
    const holder = await participant(w.tenant.id, w.market)
    const session = await call(app, { method: 'POST', url: '/v1/credit-redemptions', as: w.finance, idempotencyKey: true, body: {} })
    expect(session.json().error.code).toBe('API_KEY_REQUIRED')
    const reader = await apiKey(app, w.minter, ['compliance:read'])
    expect((await redeem({ participant_external_ref: holder.ref, credit_type: 'FREE' }, reader)).statusCode).toBe(403)
    const foreign = await apiKey(app, other.minter, ['credits:write'])
    await creditType(other.tenant.id, other.finance.id, 'FREE')
    expect((await redeem({ participant_external_ref: holder.ref, credit_type: 'FREE' }, foreign)).json().error.code).toBe('PARTICIPANT_NOT_FOUND')
  })

  test('concurrent double-redeem: one source id twice is one redemption; two ids for the whole balance, one is refused', async () => {
    const holder = await participant(w.tenant.id, w.market)
    await award(w, holder.id, free, '300', ago(2))
    const same = { participant_external_ref: holder.ref, credit_type: 'FREE', amount_minor: '200', source_redemption_id: `r-${randomUUID()}` }
    const twice = await Promise.all([redeem(same), redeem(same)])
    expect(twice.map((r) => r.statusCode).sort()).toEqual([200, 201])
    expect(new Set(twice.map((r) => r.json().data.redemption.id)).size).toBe(1)

    const race = await Promise.all([1, 2].map(() => redeem({ participant_external_ref: holder.ref, credit_type: 'FREE', amount_minor: '100' })))
    const codes = race.map((r) => (r.statusCode === 201 ? 201 : r.json().error.code)).sort()
    expect(codes).toEqual([201, 'CREDIT_INSUFFICIENT'])
    expect(await liability(w.tenant.id, holder.id, free, w.market)).toEqual({ balance: '0', lots: '0' })
    const [count] = await ownerRows<{ n: number }>('SELECT count(*)::int AS n FROM credit_redemption WHERE participant_id = $1', [holder.id])
    expect(count!.n).toBe(2)
  })
})

describe('balances and lots (credit.read, market scope)', () => {
  test('balances with the next expiry and totals; lots per holder; scope, permission and tenant isolation', async () => {
    const typeId = await creditType(w.tenant.id, w.finance.id, 'BAL', { expiry: [30, 7] })
    const holder = await participant(w.tenant.id, w.market)
    const lot = await award(w, holder.id, typeId, '700', ago(3))
    const balances = await get(w.support, `/v1/credits/balances?market_id=${w.market}&credit_type_id=${typeId}`)
    expect(balances.statusCode, balances.body).toBe(200)
    expect(balances.json().data).toEqual([{
      participant: { id: holder.id, external_ref: holder.ref }, credit_type: { id: typeId, code: 'BAL', name: 'BAL' }, market_id: w.market,
      currency: 'GBP', balance_minor: '700', available_minor: '700', next_expiry: { on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), amount_minor: '700' },
    }])
    expect(balances.json().meta.totals).toEqual([{ currency: 'GBP', balance_minor: '700', available_minor: '700' }])

    const lots = await get(w.analyst, `/v1/credits/lots?participant_id=${holder.id}&credit_type_id=${typeId}&market_id=${w.market}`)
    expect(lots.json().data).toEqual([expect.objectContaining({ award_id: lot, expires_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), amount_minor: '700', remaining_minor: '700', notified_at: null, expired_at: null })])
    expect((await get(w.analyst, `/v1/credits/lots?participant_id=${holder.id}`)).statusCode).toBe(400)

    const ie = await createMarket(w.tenant.id, 'FR')
    const ieSupport = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Support agent'], marketIds: [ie] })
    expect((await get(ieSupport, `/v1/credits/balances?market_id=${w.market}`)).statusCode).toBe(404)
    expect((await get(ieSupport, '/v1/credits/balances')).json().data).toEqual([])
    expect((await get(ieSupport, `/v1/credits/lots?participant_id=${holder.id}&credit_type_id=${typeId}&market_id=${w.market}`)).statusCode).toBe(404)
    expect((await get(other.support, `/v1/credits/lots?participant_id=${holder.id}&credit_type_id=${typeId}&market_id=${w.market}`)).statusCode).toBe(404)
    expect((await get(other.support, '/v1/credits/balances')).json().data).toEqual([])
    expect((await get(other.support, '/v1/credits/redemptions')).json().data).toEqual([])
    const planner = await createSignedInUser({ tenantId: w.tenant.id, roles: ['Plan administrator'] })
    for (const url of ['/v1/credits/balances', '/v1/credits/redemptions']) expect((await get(planner, url)).statusCode).toBe(403)
  })
})

describe('expiry cron led.credits.expire (T-V1A-13, AC-FIN6-4)', () => {
  test('notices once per lot inside the notice window, expires due lots once with Dr credit_liability / Cr breakage', async () => {
    const typeId = await creditType(w.tenant.id, w.finance.id, 'CRON', { expiry: [30, 7] })
    const soon = await participant(w.tenant.id, w.market)
    const due = await participant(w.tenant.id, w.market)
    const soonLot = await award(w, soon.id, typeId, '300', ago(25)) // expires in 5-6 days: inside the 7-day notice
    const dueLot = await award(w, due.id, typeId, '250', ago(40))
    const run = () => creditExpiryCron.run({ jobId: randomUUID(), log: app.log, config: app.config })

    await run()
    await run()
    const notices = await ownerRows<{ template: string; channel: string; params: Record<string, string> }>(
      `SELECT template, channel, params FROM notification WHERE recipient_participant_id = $1`, [soon.id])
    expect(notices).toEqual([{ template: 'credit.expiring', channel: 'in_app', params: expect.objectContaining({ credit_type_code: 'CRON', amount_minor: '300', currency: 'GBP' }) }])
    const events = await ownerRows<{ award_id: string; kind: string; amount_minor: string }>(
      'SELECT award_id, kind, amount_minor::text FROM credit_lot_event WHERE award_id = ANY ($1) ORDER BY kind', [[soonLot, dueLot]])
    expect(events).toEqual([{ award_id: dueLot, kind: 'expired', amount_minor: '250' }, { award_id: soonLot, kind: 'notified', amount_minor: '300' }])
    expect(await liability(w.tenant.id, due.id, typeId, w.market)).toEqual({ balance: '0', lots: '0' })
    expect(await liability(w.tenant.id, soon.id, typeId, w.market)).toEqual({ balance: '300', lots: '300' })
    expect(await auditActions(w.tenant.id)).toEqual(expect.arrayContaining(['CREDIT.EXPIRED', 'CREDIT.EXPIRY_NOTIFIED']))
  })
})
