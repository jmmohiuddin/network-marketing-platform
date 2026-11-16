import { withTenant } from '@nmp/db'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, baseRoleId, buildTestApp, call, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows,
  resetApiDb, type TestTenant, type TestUser,
} from '../../../test/helpers/index.js'
import { assertMarketLive, marketName, tenModule } from './index.js'
import { ISO_4217_MINOR_UNITS } from './iso4217.js'

let app: FastifyInstance
let acme: TestTenant
let markets: { gb: string; in: string; fr: string }
let reader: TestUser
let admin: TestUser
let scopedAdmin: TestUser
let globexReader: TestUser
let vendor: TestUser

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  acme = await createTenant()
  const globex = await createTenant()
  markets = { in: await createMarket(acme.id, 'IN'), gb: await createMarket(acme.id, 'GB'), fr: await createMarket(globex.id, 'FR') }
  reader = await createSignedInUser({ tenantId: acme.id })
  admin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'] })
  scopedAdmin = await createSignedInUser({ tenantId: acme.id, roles: ['Tenant admin'], marketIds: [markets.gb] })
  globexReader = await createSignedInUser({ tenantId: globex.id, roles: ['Tenant admin'] })
  vendor = await createSignedInUser({ tenantId: null })
  app = await buildTestApp({ modules: [tenModule] })
})

afterAll(async () => {
  await app.close()
})

const list = (as?: TestUser) => call(app, { method: 'GET', url: '/v1/markets', ...(as === undefined ? {} : { as }) })
const NEW_FR = { code: 'FR', currency: 'EUR', time_zone: 'Europe/Paris', languages: ['fr'], market_pack: 'fr-pack', reason: 'expansion' }
const create = (as: TestUser, body: Record<string, unknown>) => call(app, { method: 'POST', url: '/v1/markets', as, body, idempotencyKey: true })
const remove = (as: TestUser, id: string) => call(app, { method: 'DELETE', url: `/v1/markets/${id}`, as, body: { reason: 'cleanup' } })
const structureOfLatest = async (tenantId: string) => {
  const [row] = await ownerRows<{ settings: { structure: { markets: { code: string; state: string }[]; brands: { name: string }[] } }; reason: string }>(
    'SELECT settings, reason FROM tenant_setting_version WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1', [tenantId])
  return row!
}

describe('GET /v1/markets', () => {
  test('any signed-in tenant user lists its tenant\'s markets by code, named, with state, pack, zone, languages, minor unit', async () => {
    const response = await list(reader)

    expect(response.statusCode).toBe(200)
    expect(response.json().data[0]).toEqual({
      id: markets.gb, code: 'GB', name: 'United Kingdom', currency: 'GBP', state: 'live', market_pack: 'none',
      time_zone: 'Europe/London', languages: ['en'], minor_unit: 2,
    })
    expect(response.json().data.map((m: { code: string }) => m.code)).toEqual(['GB', 'IN'])
  })

  test('another tenant sees only its own markets; vendor users and anonymous callers are refused', async () => {
    const foreign = await list(globexReader)

    expect(foreign.json().data.map((m: { id: string }) => m.id)).toEqual([markets.fr])
    expect((await list(vendor)).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await list()).statusCode).toBe(401)
  })

  test('a code that is not an ISO region code is named by the code itself', () => {
    expect([marketName('DE'), marketName('M2'), marketName('TINY')]).toEqual(['Germany', 'M2', 'TINY'])
  })
})

describe('POST /v1/markets (AC-TEN2-1/2/7, T-B1-01)', () => {
  test('creates a draft market with minor_unit from ISO 4217, a structure version with the reason, and an audit event', async () => {
    const response = await create(admin, NEW_FR)
    const latest = await structureOfLatest(acme.id)

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toMatchObject({ code: 'FR', currency: 'EUR', minor_unit: 2, state: 'draft', languages: ['fr'], name: 'France' })
    expect(latest.reason).toBe('expansion')
    expect(latest.settings.structure.markets.map((m) => m.code).sort()).toEqual(['FR', 'GB', 'IN'])
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['MARKET.CREATED', 'SETTINGS.VERSION_CREATED']))
    expect((await create(admin, NEW_FR)).json().error.code).toBe('MARKET_CODE_TAKEN')
  })

  test('invalid country, currency, zone or language is 422 VALIDATION_FAILED naming the field', async () => {
    const cases = [
      [{ code: 'XX' }, 'code'], [{ code: 'EU' }, 'code'], [{ currency: 'EUX' }, 'currency'], [{ time_zone: 'Mars/Base' }, 'time_zone'],
      [{ time_zone: '+01:00' }, 'time_zone'], [{ languages: ['zz-!!'] }, 'languages'],
    ] as const

    for (const [override, field] of cases) {
      const response = await create(admin, { ...NEW_FR, code: 'DE', ...override })
      expect([field, response.statusCode, response.json().error.details.issues[0].path]).toEqual([field, 422, field])
    }
  })

  test('minor units come from the pinned ISO 4217 table, not CLDR: IQD 3, RSD 2, JPY 0', async () => {
    const iq = await create(admin, { ...NEW_FR, code: 'IQ', currency: 'IQD', time_zone: 'Asia/Baghdad', languages: ['ar'] })
    const rs = await create(admin, { ...NEW_FR, code: 'RS', currency: 'RSD', time_zone: 'Europe/Belgrade', languages: ['sr'] })
    const jp = await create(admin, { ...NEW_FR, code: 'JP', currency: 'JPY', time_zone: 'Asia/Tokyo', languages: ['ja'] })

    expect([iq.json().data.minor_unit, rs.json().data.minor_unit, jp.json().data.minor_unit]).toEqual([3, 2, 0])
  })

  test('the ISO 4217 table: every entry is an exponent 0..4, and the CLDR-divergent codes keep their ISO exponent', () => {
    const divergent = { ALL: 2, AFN: 2, IQD: 3, IRR: 2, LAK: 2, LBP: 2, MMK: 2, RSD: 2, SYP: 2, YER: 2 }

    expect(Object.entries(ISO_4217_MINOR_UNITS).every(([code, unit]) => /^[A-Z]{3}$/.test(code) && [0, 2, 3, 4].includes(unit))).toBe(true)
    expect(Object.keys(ISO_4217_MINOR_UNITS)).toHaveLength(156)
    expect(Object.fromEntries(Object.keys(divergent).map((code) => [code, ISO_4217_MINOR_UNITS[code]]))).toEqual(divergent)
    expect(['BHD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND', 'IQD'].every((code) => ISO_4217_MINOR_UNITS[code] === 3)).toBe(true)
    expect(ISO_4217_MINOR_UNITS.UYW).toBe(4)
  })

  test('creating a market needs settings.manage over every market; other users are refused', async () => {
    expect((await create(scopedAdmin, { ...NEW_FR, code: 'ES', currency: 'EUR', time_zone: 'Europe/Madrid', languages: ['es'] })).statusCode).toBe(403)
    expect((await create(reader, { ...NEW_FR, code: 'ES' })).statusCode).toBe(403)
  })
})

describe('GET/PATCH /v1/markets/:id', () => {
  test('detail shows references and deletable; out of scope and another tenant are 404; no permission is 403', async () => {
    const detail = await call(app, { method: 'GET', url: `/v1/markets/${markets.gb}`, as: admin })

    expect(detail.json().data).toMatchObject({ code: 'GB', deletable: false, references: { calendars: 0, grants: 1 } })
    expect((await call(app, { method: 'GET', url: `/v1/markets/${markets.in}`, as: scopedAdmin })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/markets/${markets.gb}`, as: globexReader })).statusCode).toBe(404)
    expect((await call(app, { method: 'GET', url: `/v1/markets/${markets.gb}`, as: reader })).statusCode).toBe(403)
  })

  test('zone and languages change any time; pack and currency only on a draft; currency only while unreferenced', async () => {
    const zone = await call(app, { method: 'PATCH', url: `/v1/markets/${markets.gb}`, as: scopedAdmin, body: { time_zone: 'Europe/Dublin', reason: 'tz' } })
    const pack = await call(app, { method: 'PATCH', url: `/v1/markets/${markets.gb}`, as: admin, body: { market_pack: 'x', reason: 'pack' } })
    const de = (await create(admin, { ...NEW_FR, code: 'DE', time_zone: 'Europe/Berlin', languages: ['de'] })).json().data.id as string
    const currency = await call(app, { method: 'PATCH', url: `/v1/markets/${de}`, as: admin, body: { currency: 'KWD', reason: 'cur' } })
    await ownerRows(`INSERT INTO role_assignment (tenant_id, user_id, role_id, market_ids, valid_from) VALUES ($1, $2, $3, $4, now())`,
      [acme.id, reader.id, await baseRoleId('Executive read-only'), [de]])
    const referenced = await call(app, { method: 'PATCH', url: `/v1/markets/${de}`, as: admin, body: { currency: 'EUR', reason: 'cur' } })
    const outOfScope = await call(app, { method: 'PATCH', url: `/v1/markets/${markets.in}`, as: scopedAdmin, body: { time_zone: 'Asia/Kolkata', reason: 'tz' } })

    expect(zone.json().data.time_zone).toBe('Europe/Dublin')
    expect(pack.json().error.code).toBe('MARKET_NOT_DRAFT')
    expect(currency.json().data).toMatchObject({ currency: 'KWD', minor_unit: 3 })
    expect(referenced.json().error).toMatchObject({ code: 'MARKET_REFERENCED', details: { references: { grants: 1 } } })
    expect(outOfScope.statusCode).toBe(404)
    expect(await auditActions(acme.id)).toContain('MARKET.UPDATED')
  })
})

describe('DELETE /v1/markets/:id (AC-TEN2-3, T-B1-02)', () => {
  test('referenced markets are refused 409 MARKET_REFERENCED with the counts; live ones MARKET_NOT_DRAFT; unreferenced drafts go', async () => {
    const tenant = await createTenant()
    const owner = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'] })
    const id = (kind: string) => create(owner, { ...NEW_FR, code: kind, currency: 'EUR', time_zone: 'Europe/Paris', languages: ['fr'] })
    const withCalendar = (await id('FR')).json().data.id as string
    const withGrant = (await id('BE')).json().data.id as string
    const withRequest = (await id('LU')).json().data.id as string
    const withParticipant = (await id('NL')).json().data.id as string
    const free = (await id('MC')).json().data.id as string
    await ownerRows(`INSERT INTO calendar (tenant_id, market_id, name, cadence, cutoff_time_zone, first_period_start) VALUES ($1, $2, 'c', 'monthly', 'Europe/Paris', '2027-01-01')`, [tenant.id, withCalendar])
    await ownerRows(`INSERT INTO role_assignment (tenant_id, user_id, role_id, market_ids, valid_from) VALUES ($1, $2, $3, $4, now())`,
      [tenant.id, owner.id, await baseRoleId('Executive read-only'), [withGrant]])
    await ownerRows(`INSERT INTO role_grant_request (tenant_id, user_id, role_id, market_ids, state, requested_by) VALUES ($1, $2, $3, $4, 'pending', $2)`,
      [tenant.id, owner.id, await baseRoleId('Executive read-only'), [withRequest]])
    await ownerRows(
      `INSERT INTO cpl_fact_participant (tenant_id, source, market_id, participant_ref, type_code, counts_as_end_customer, can_earn, enrolled_month)
       VALUES ($1, 'native', $2, 'P-1', 'distributor', false, true, '2026-01-01')`,
      [tenant.id, withParticipant])
    const live = await createMarket(tenant.id, 'GB')

    const refusals = await Promise.all([withCalendar, withGrant, withRequest, withParticipant].map((market) => remove(owner, market)))
    const deleted = await remove(owner, free)
    const liveRefused = await remove(owner, live)

    expect(refusals.map((r) => r.json().error.code)).toEqual(Array(4).fill('MARKET_REFERENCED'))
    expect(refusals.map((r) => r.json().error.details.references)).toEqual([
      expect.objectContaining({ calendars: 1 }), expect.objectContaining({ grants: 1 }), expect.objectContaining({ grants: 1 }),
      expect.objectContaining({ fact_participants: 1 }),
    ])
    expect(deleted.statusCode).toBe(204)
    expect(liveRefused.json().error.code).toBe('MARKET_NOT_DRAFT')
    expect((await structureOfLatest(tenant.id)).settings.structure.markets.map((m) => m.code)).not.toContain('MC')
    expect(await auditActions(tenant.id)).toContain('MARKET.DELETED')
    expect((await remove(globexReader, withCalendar)).statusCode).toBe(404)
  })
})

describe('brands (AC-TEN2-6)', () => {
  test('create, rename, unique names, refuse deleting a brand a grant is scoped to, delete otherwise', async () => {
    const created = await call(app, { method: 'POST', url: '/v1/brands', as: admin, body: { name: 'Acme Nutrition', reason: 'launch' }, idempotencyKey: true })
    const id = created.json().data.id as string
    const duplicate = await call(app, { method: 'POST', url: '/v1/brands', as: admin, body: { name: 'Acme Nutrition', reason: 'again' }, idempotencyKey: true })
    const renamed = await call(app, { method: 'PATCH', url: `/v1/brands/${id}`, as: admin, body: { name: 'Acme Health', reason: 'rebrand' } })
    const other = (await call(app, { method: 'POST', url: '/v1/brands', as: admin, body: { name: 'Acme Beauty', reason: 'launch' }, idempotencyKey: true })).json().data.id as string
    await ownerRows(`INSERT INTO role_assignment (tenant_id, user_id, role_id, brand_ids, valid_from) VALUES ($1, $2, $3, $4, now())`,
      [acme.id, reader.id, await baseRoleId('Executive read-only'), [id]])
    const referenced = await call(app, { method: 'DELETE', url: `/v1/brands/${id}`, as: admin, body: { reason: 'drop' } })
    const deleted = await call(app, { method: 'DELETE', url: `/v1/brands/${other}`, as: admin, body: { reason: 'drop' } })
    const listed = await call(app, { method: 'GET', url: '/v1/brands', as: reader })

    expect(created.statusCode).toBe(201)
    expect(duplicate.json().error.code).toBe('BRAND_NAME_TAKEN')
    expect(renamed.json().data).toEqual({ id, name: 'Acme Health' })
    expect(referenced.json().error).toMatchObject({ code: 'BRAND_REFERENCED', details: { references: { grants: 1 } } })
    expect(deleted.statusCode).toBe(204)
    expect(listed.json().data).toEqual([{ id, name: 'Acme Health' }])
    expect((await structureOfLatest(acme.id)).settings.structure.brands).toEqual([{ id, name: 'Acme Health' }])
    expect(await auditActions(acme.id)).toEqual(expect.arrayContaining(['BRAND.CREATED', 'BRAND.RENAMED', 'BRAND.DELETED']))
    expect((await call(app, { method: 'GET', url: '/v1/brands', as: globexReader })).json().data).toEqual([])
    expect((await call(app, { method: 'PATCH', url: `/v1/brands/${id}`, as: globexReader, body: { name: 'x', reason: 'x' } })).statusCode).toBe(404)
    expect((await call(app, { method: 'POST', url: '/v1/brands', as: reader, body: { name: 'x', reason: 'x' }, idempotencyKey: true })).statusCode).toBe(403)
  })
})

describe('structure versions (T-B1-04)', () => {
  test('the version detail shows a structure change by id', async () => {
    const tenant = await createTenant()
    const owner = await createSignedInUser({ tenantId: tenant.id, roles: ['Tenant admin'] })
    const created = await create(owner, NEW_FR)

    const detail = await call(app, { method: 'GET', url: '/v1/settings/versions/1', as: owner })

    expect(detail.json().data.changes).toEqual([{
      key: 'structure',
      markets: { added: [expect.objectContaining({ id: created.json().data.id, code: 'FR', state: 'draft' })], removed: [], changed: [] },
      brands: { added: [], removed: [], changed: [] },
      calendars: { added: [], removed: [], changed: [] },
    }])
  })
})

describe('assertMarketLive (AC-38.2)', () => {
  test('a live market passes; a draft or unknown market is 422 MARKET_NOT_LIVE', async () => {
    const draft = (await list(admin)).json().data.find((m: { code: string }) => m.code === 'FR').id as string
    const check = (id: string) => withTenant({ tenantId: acme.id, userId: admin.id }, (tx) => assertMarketLive(tx, id))

    await expect(check(markets.gb)).resolves.toBeUndefined()
    await expect(check(draft)).rejects.toMatchObject({ code: 'MARKET_NOT_LIVE', statusCode: 422 })
    await expect(check(markets.fr)).rejects.toMatchObject({ code: 'MARKET_NOT_LIVE' })
  })
})
