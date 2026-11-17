import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb,
  type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { calendarDeleteRefusal } from './calendars.js'
import { tenModule } from './index.js'
import { setPeriodState } from './test-support.js'

let app: FastifyInstance
let acme: TestTenant
let fr: string
let us: string
let admin: TestUser
let signer: TestUser
let reader: TestUser
let globexAdmin: TestUser

// Far enough ahead that "periods ahead of now" counts from the first period start whatever day the suite runs.
const YEAR = new Date().getUTCFullYear() + 2

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  fr = await createMarket(acme.id, 'FR')
  us = await createMarket(acme.id, 'US')
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  signer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'], marketIds: [us] })
  reader = await createSignedInUser({ tenantId: acme.id, roles: ['Commission analyst'] })
  globexAdmin = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  app = await buildTestApp({ modules: [tenModule] })
})

afterAll(async () => {
  await app.close()
})

interface Period { id: string; starts_at: string; ends_at: string; state: string }

const create = (as: TestUser, body: Record<string, unknown>) =>
  call(app, { method: 'POST', url: '/v1/calendars', as, body: { reason: 'set up', ...body }, idempotencyKey: true })
const periods = async (id: string, as: TestUser = admin): Promise<Period[]> =>
  (await call(app, { method: 'GET', url: `/v1/calendars/${id}/periods?limit=200`, as })).json().data
const local = (iso: string, zone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
const hours = (period: Period) => (Date.parse(period.ends_at) - Date.parse(period.starts_at)) / 3_600_000

describe('POST /v1/calendars (AC-TEN2-4, T-B1-03)', () => {
  test('monthly in Europe/Paris: periods_ahead periods from local midnight on the 1st, contiguous, DST-correct', async () => {
    const response = await create(admin, {
      market_id: fr, name: 'FR monthly', cadence: 'monthly', cutoff_time_zone: 'Europe/Paris', first_period_start: `${YEAR}-01-01`, periods_ahead: 12,
    })
    const list = await periods(response.json().data.calendar.id)

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toMatchObject({ generated: 12, calendar: { name: 'FR monthly', market: { id: fr, code: 'FR' }, periods: { count: 12, open: 12 } } })
    expect(list[0]!.starts_at).toBe(`${YEAR - 1}-12-31T23:00:00.000Z`)
    expect(list.every((p) => local(p.starts_at, 'Europe/Paris').endsWith('01, 00:00'))).toBe(true)
    expect(list.slice(1).every((p, index) => p.starts_at === list[index]!.ends_at)).toBe(true)
    expect(list[2]!.ends_at).toBe(`${YEAR}-03-31T22:00:00.000Z`) // summer time began in March
    expect(new Set(list.map(hours)).size).toBeGreaterThan(2)
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['CALENDAR.CREATED', 'SETTINGS.VERSION_CREATED']))
  })

  test('weekly in America/New_York: 7 local days from the first start\'s weekday, 167 / 169 hours across DST; extending is idempotent', async () => {
    const response = await create(admin, {
      market_id: us, name: 'US weekly', cadence: 'weekly', cutoff_time_zone: 'America/New_York', first_period_start: `${YEAR}-01-06`, periods_ahead: 52,
    })
    const id = response.json().data.calendar.id as string
    const extend = (through: string) => call(app, { method: 'POST', url: `/v1/calendars/${id}/periods`, as: admin, body: { through, reason: 'horizon' }, idempotencyKey: true })
    const first = await extend(`${YEAR + 1}-01-31`)
    const again = await extend(`${YEAR + 1}-01-31`)
    const list = await periods(id)
    const weekday = local(list[0]!.starts_at, 'America/New_York').slice(0, 3)

    expect(response.json().data.generated).toBe(52)
    expect(list.every((p) => local(p.starts_at, 'America/New_York').startsWith(weekday) && local(p.starts_at, 'America/New_York').endsWith('00:00'))).toBe(true)
    expect(new Set(list.map(hours))).toEqual(new Set([167, 168, 169]))
    expect(first.json().data.generated).toBeGreaterThan(0)
    expect(again.json().data.generated).toBe(0)
    expect(list.at(-1)!.starts_at <= `${YEAR + 1}-02-01`).toBe(true)
    expect(await auditActions(acme.id)).toContain('CALENDAR.PERIODS_GENERATED')
    const [version] = await ownerRows<{ reason: string; settings: { structure: { calendars: { id: string; periods_through: string }[] } } }>(
      'SELECT reason, settings FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1', [acme.id])
    expect(version!.reason).toBe('horizon') // D-B1-02: generating periods appends a structure version
    expect(Date.parse(version!.settings.structure.calendars.find((c) => c.id === id)!.periods_through)).toBe(Date.parse(list.at(-1)!.ends_at))
  })

  test('refusals: more than 520 periods, monthly not on day 1, unknown zone, unknown market, duplicate name', async () => {
    const base = { market_id: fr, name: 'x', cadence: 'weekly', cutoff_time_zone: 'Europe/Paris', first_period_start: '2000-01-03', periods_ahead: 1 }
    const before = await ownerRows('SELECT 1 FROM calendar WHERE tenant_id = $1', [acme.id])

    const limit = await create(admin, base)
    const dayTwo = await create(admin, { ...base, cadence: 'monthly', first_period_start: `${YEAR}-01-02` })
    const zone = await create(admin, { ...base, first_period_start: `${YEAR}-01-02`, cutoff_time_zone: 'Mars/Base' })
    const market = await create(admin, { ...base, first_period_start: `${YEAR}-01-02`, market_id: crypto.randomUUID() })
    const duplicate = await create(admin, { ...base, first_period_start: `${YEAR}-01-02`, name: 'FR monthly' })

    expect(limit.json().error).toMatchObject({ code: 'GENERATION_LIMIT', details: { limit: 520 } })
    expect(await ownerRows('SELECT 1 FROM calendar WHERE tenant_id = $1', [acme.id])).toHaveLength(before.length)
    expect([dayTwo, zone, market].map((r) => [r.statusCode, r.json().error.details.issues[0].path]))
      .toEqual([[422, 'first_period_start'], [422, 'cutoff_time_zone'], [422, 'market_id']])
    expect(duplicate.json().error.code).toBe('CALENDAR_NAME_TAKEN')
  })
})

describe('GET /v1/calendars and periods', () => {
  test('lists calendars of the markets in scope with period counts; periods page ascending', async () => {
    const all = await call(app, { method: 'GET', url: '/v1/calendars', as: admin })
    const scoped = await call(app, { method: 'GET', url: '/v1/calendars', as: signer })
    const frId = all.json().data.find((c: { name: string }) => c.name === 'FR monthly').id as string
    const page = await call(app, { method: 'GET', url: `/v1/calendars/${frId}/periods?limit=5`, as: admin })
    const next = await call(app, { method: 'GET', url: `/v1/calendars/${frId}/periods?limit=5&cursor=${page.json().meta.next_cursor}`, as: admin })

    expect(all.json().data.map((c: { name: string }) => c.name)).toEqual(['FR monthly', 'US weekly'])
    expect(scoped.json().data.map((c: { name: string }) => c.name)).toEqual(['US weekly'])
    expect(next.json().data[0].starts_at > page.json().data[4].starts_at).toBe(true)
    expect((await call(app, { method: 'GET', url: `/v1/calendars/${frId}/periods`, as: signer })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/calendars/${frId}/periods`, as: globexAdmin })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: '/v1/calendars', as: globexAdmin })).json().data).toEqual([])
    expect((await call(app, { method: 'GET', url: '/v1/calendars', as: reader })).statusCode).toBe(403)
  })
})

describe('PATCH and DELETE /v1/calendars/:id (AC-TEN2-5)', () => {
  test('only the name changes; timing fields are 422 CALENDAR_TIMING_IMMUTABLE', async () => {
    const created = await create(admin, { market_id: fr, name: 'FR temp', cadence: 'monthly', cutoff_time_zone: 'Europe/Paris', first_period_start: `${YEAR}-01-01`, periods_ahead: 2 })
    const id = created.json().data.calendar.id as string

    const timing = await call(app, { method: 'PATCH', url: `/v1/calendars/${id}`, as: admin, body: { name: 'x', cadence: 'weekly', reason: 'r' } })
    const renamed = await call(app, { method: 'PATCH', url: `/v1/calendars/${id}`, as: admin, body: { name: 'FR renamed', reason: 'r' } })
    const foreign = await call(app, { method: 'PATCH', url: `/v1/calendars/${id}`, as: globexAdmin, body: { name: 'x', reason: 'r' } })

    expect(timing.json().error).toMatchObject({ code: 'CALENDAR_TIMING_IMMUTABLE', details: { fields: ['cadence'] } })
    expect(renamed.json().data.name).toBe('FR renamed')
    expect(foreign.statusCode).toBe(404)
    expect(await auditActions(acme.id)).toContain('CALENDAR.RENAMED')
  })

  test('a calendar with a period past open is 409 PERIOD_COMMITTED; an all-open calendar is deleted with its periods', async () => {
    const make = async (name: string) => (await create(admin, {
      market_id: fr, name, cadence: 'monthly', cutoff_time_zone: 'Europe/Paris', first_period_start: `${YEAR}-01-01`, periods_ahead: 3,
    })).json().data.calendar.id as string
    const committed = await make('FR committed')
    const open = await make('FR open')
    await setPeriodState((await periods(committed))[0]!.id, 'committed')

    const refused = await call(app, { method: 'DELETE', url: `/v1/calendars/${committed}`, as: admin, body: { reason: 'drop' } })
    const deleted = await call(app, { method: 'DELETE', url: `/v1/calendars/${open}`, as: admin, body: { reason: 'drop' } })

    expect(refused.json().error).toMatchObject({ code: 'PERIOD_COMMITTED', details: { periods_not_open: 1 } })
    expect(deleted.statusCode).toBe(204)
    expect(await ownerRows('SELECT 1 FROM period WHERE calendar_id = $1', [open])).toEqual([])
    expect(await auditActions(acme.id)).toContain('CALENDAR.DELETED')
    expect((await call(app, { method: 'DELETE', url: `/v1/calendars/${committed}`, as: reader, body: { reason: 'x' } })).statusCode).toBe(403)
  })

  test('D-B3-20: a calendar a plan uses is 409 CALENDAR_IN_PLAN; it and its periods stay', async () => {
    const calendar = (await create(admin, {
      market_id: fr, name: 'FR plan', cadence: 'monthly', cutoff_time_zone: 'Europe/Paris', first_period_start: `${YEAR}-01-01`, periods_ahead: 2,
    })).json().data.calendar.id as string
    const [plan] = await ownerRows<{ id: string }>(`INSERT INTO plan (tenant_id, name, created_by) VALUES ($1, 'FR core', $2) RETURNING id`, [acme.id, admin.id])
    await ownerRows('INSERT INTO plan_market (tenant_id, plan_id, market_id) VALUES ($1, $2, $3)', [acme.id, plan!.id, fr])
    await ownerRows('INSERT INTO plan_calendar (tenant_id, plan_id, calendar_id) VALUES ($1, $2, $3)', [acme.id, plan!.id, calendar])

    const before = await periods(calendar)

    const refused = await call(app, { method: 'DELETE', url: `/v1/calendars/${calendar}`, as: admin, body: { reason: 'drop' } })

    expect([refused.statusCode, refused.json().error.code]).toEqual([409, 'CALENDAR_IN_PLAN'])
    expect(before.length).toBeGreaterThan(0)
    expect(await periods(calendar)).toEqual(before)
  })

  test('a foreign key from an order, run or simulation to a period is 409 CALENDAR_HAS_ACTIVITY, not CALENDAR_IN_PLAN', () => {
    const fk = (constraint: string) => calendarDeleteRefusal(Object.assign(new Error('fk'), { code: '23503', constraint }))

    expect(fk('plan_calendar_tenant_id_calendar_id_fkey')).toMatchObject({ statusCode: 409, code: 'CALENDAR_IN_PLAN' })
    expect(fk('sales_order_tenant_id_period_id_fkey')).toMatchObject({ statusCode: 409, code: 'CALENDAR_HAS_ACTIVITY' })
    expect(calendarDeleteRefusal(Object.assign(new Error('x'), { code: '23505' }))).toBeNull()
  })
})
