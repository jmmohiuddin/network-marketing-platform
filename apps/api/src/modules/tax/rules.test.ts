// FR-TAX-002 routes: T-BM-05 tax rules and withholding lines (AC-TAX2-4); T-BM-06 the pack tax-id format (AC-TAX2-5, D-BM-07).
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, ownerRows, resetApiDb, type TestUser,
} from '../../../test/helpers/index.js'
import { taxModule } from './index.js'
import { committedRun, FIXTURE_FORM, FIXTURE_FORMAT, payee, taxMarket, taxPack, type TaxMarket, type TaxPack } from './test-support.js'

let app: FastifyInstance
let tenantId: string
let pack: TaxPack
let at: TaxMarket
let gb: string
let runId: string
let finance: TestUser
let compliance: TestUser
let payout: TestUser
let analyst: TestUser
let analystGb: TestUser
let scoped: TestUser
let other: TestUser
let portal: TestUser
const ids: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' }

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  pack = await taxPack({ format: true })
  at = await taxMarket(tenantId, pack.pack, 'AT')
  gb = await createMarket(tenantId, 'GB')
  ids.c = await payee(tenantId, at.marketId, 'C-3')
  ids.a = await payee(tenantId, at.marketId, 'A-1', 'FX100001')
  ids.b = await payee(tenantId, at.marketId, 'B-2', 'FX100002')
  runId = (await committedRun(tenantId, at, pack.withholdingId, '2025-06', [
    { participantId: ids.a, gross: 24000, withheld: 480 }, { participantId: ids.b, gross: 2300, withheld: 0 },
    { participantId: ids.c, gross: 5000, withheld: 100 },
  ])).runId
  finance = await createSignedInUser({ tenantId, roles: ['Finance approver'], stepUp: true })
  compliance = await createSignedInUser({ tenantId, roles: ['Compliance officer'] })
  payout = await createSignedInUser({ tenantId, roles: ['Payout officer'] })
  analyst = await createSignedInUser({ tenantId, roles: ['Commission analyst'] })
  analystGb = await createSignedInUser({ tenantId, roles: ['Commission analyst'], marketIds: [gb] })
  scoped = await createSignedInUser({ tenantId, roles: ['Compliance officer'], marketIds: [gb] })
  other = await createSignedInUser({ tenantId: (await createTenant()).id, roles: ['Compliance officer'] })
  portal = await createPortalUser({ tenantId, participantId: ids.a, stepUp: true })
  app = await buildTestApp({ modules: [taxModule] })
})

afterAll(async () => {
  await app.close()
})

const get = (as: TestUser, url: string) => call(app, { method: 'GET', url, as })

describe('tax rules and lines (T-BM-05, AC-TAX2-4)', () => {
  test('GET /v1/tax/rules: withholding and form rules with in_force, the tax year and the tax-id format; rates as 6-dp strings', async () => {
    const response = await get(compliance, `/v1/tax/rules?market_id=${at.marketId}`)

    expect(response.statusCode).toBe(200)
    const basis = { basis: 'FIXTURE basis, not a real tax rule', basis_status: 'counsel_confirmed', source_ref: 'FIXTURE', reviewed_by: null, reviewed_at: null, effective_from: '2020-01-01', effective_to: null }
    expect(response.json().data).toEqual({
      market: { id: at.marketId, code: 'AT', market_pack: pack.pack },
      withholding: [{
        id: pack.withholdingId, title: 'FIXTURE withholding', conditions: {}, rate: '0.020000', threshold_minor: '2350', threshold_basis: 'current_year_cumulative',
        missing_id_rate: '0.200000', rounding: 'half_up', ...basis, in_force: true,
      }],
      year_end_forms: [{ id: pack.formId, form_type: FIXTURE_FORM.form_type, title: FIXTURE_FORM.title, min_gross_minor: '2000', ...basis, in_force: true }],
      tax_year: { id: expect.stringMatching(/-year@2020-01-01$/), start_month: 1, start_day: 1, ...basis },
      tax_id_format: { id: expect.stringMatching(/-format@2020-01-01$/), ...FIXTURE_FORMAT, ...basis },
    })
    const none = await get(compliance, `/v1/tax/rules?market_id=${gb}`)
    expect(none.json().data).toMatchObject({ withholding: [], year_end_forms: [], tax_year: null, tax_id_format: null })
  })

  test('GET /v1/tax/lines: the run\'s lines by payee ref, paged, with totals and the run in meta', async () => {
    const first = await get(finance, `/v1/tax/lines?run_id=${runId}&limit=2`)
    const second = await get(finance, `/v1/tax/lines?run_id=${runId}&limit=2&cursor=${first.json().meta.next_cursor}`)

    expect(first.statusCode).toBe(200)
    expect(first.json().data[0]).toEqual({
      id: expect.any(String), payee: { id: ids.a, external_ref: 'A-1' }, rule_id: pack.withholdingId, rate: '0.020000', rate_basis: 'rate',
      taxable_minor: '24000', withheld_minor: '480', tax_year: 2025, tax_date: '2025-06-30',
    })
    expect(first.json().data.map((l: { payee: { external_ref: string } }) => l.payee.external_ref)).toEqual(['A-1', 'B-2'])
    expect(first.json().data[1]).toMatchObject({ rate: '0.000000', rate_basis: 'below_threshold', withheld_minor: '0' })
    expect(first.json().meta).toMatchObject({ totals: { taxable_minor: '31300', withheld_minor: '580' }, run: { id: runId, state: 'committed' } })
    expect(second.json().data.map((l: { payee: { external_ref: string } }) => l.payee.external_ref)).toEqual(['C-3'])
    expect(second.json().meta.next_cursor).toBeNull()
  })

  test('BUG-131: the run reviewer (run.review, no tax.read) reads the run\'s lines in its market, not the rules', async () => {
    const lines = await get(analyst, `/v1/tax/lines?run_id=${runId}&limit=1`)

    expect(lines.statusCode).toBe(200)
    expect(lines.json().meta.totals).toEqual({ taxable_minor: '31300', withheld_minor: '580' })
    expect((await get(analystGb, `/v1/tax/lines?run_id=${runId}`)).statusCode).toBe(404)
    expect((await get(analyst, `/v1/tax/rules?market_id=${at.marketId}`)).statusCode).toBe(403)
  })

  test('access: tax.read required, market scope and another tenant 404, validation, portal sessions refused', async () => {
    const urls = [`/v1/tax/rules?market_id=${at.marketId}`, `/v1/tax/lines?run_id=${runId}`]
    for (const url of urls) {
      expect((await get(payout, url)).statusCode).toBe(403)
      expect((await get(scoped, url)).statusCode).toBe(404)
      expect((await get(other, url)).statusCode).toBe(404)
      expect((await get(portal, url)).json().error.code).toBe('REALM_FORBIDDEN')
    }
    expect((await get(compliance, '/v1/tax/rules?market_id=nope')).json().error.code).toBe('VALIDATION_FAILED')
    expect((await get(compliance, `/v1/tax/lines?run_id=${runId}&cursor=bad`)).json().error.code).toBe('INVALID_CURSOR')
    expect((await get(compliance, `/v1/tax/rules?market_id=${at.marketId}&extra=1`)).json().error.code).toBe('VALIDATION_FAILED')
  })
})

describe('pack tax-id format (T-BM-06, AC-TAX2-5, D-BM-07)', () => {
  const staffPut = (participantId: string, taxId: string) =>
    call(app, { method: 'PUT', url: `/v1/participants/${participantId}/tax-profile`, as: finance, body: { tax_id: taxId }, idempotencyKey: true })
  const portalPut = (taxId: string) =>
    call(app, { method: 'PUT', url: '/v1/me/tax-profile', as: portal, body: { residency: 'AT', entity_type: 'individual', tax_id: taxId }, idempotencyKey: true })

  test('a tax id not matching the pack format is refused with its label (staff and portal); a matching one is saved', async () => {
    const before = await ownerRows('SELECT 1 FROM tax_profile WHERE participant_id IN ($1, $2)', [ids.a, ids.c])
    const staff = await staffPut(ids.c, 'FX12')
    const own = await portalPut('fx 12')

    expect([staff.statusCode, staff.json().error.code, staff.json().error.details]).toEqual([422, 'TAX_ID_FORMAT', { label: 'FX tax id' }])
    expect(staff.json().error.message).toBe('This is not a valid FX tax id.')
    expect([own.statusCode, own.json().error.code, own.json().error.details]).toEqual([422, 'TAX_ID_FORMAT', { label: 'FX tax id' }])
    expect(await ownerRows('SELECT 1 FROM tax_profile WHERE participant_id IN ($1, $2)', [ids.a, ids.c])).toHaveLength(before.length)
    expect((await staffPut(ids.c, 'fx 123456')).json().data).toMatchObject({ tax_id_masked: '•••• 3456' })
    expect((await portalPut('FX654321')).statusCode).toBe(201)
  })

  test('GET carries the format hint (null without a pack rule); the generic B4 format stays without one', async () => {
    const gbPayee = await payee(tenantId, gb, 'G-1')
    const staff = await get(compliance, `/v1/participants/${ids.c}/tax-profile`)
    const own = await get(portal, '/v1/me/tax-profile')

    expect(staff.json().data.format).toEqual({ label: 'FX tax id', pattern: '^FX[0-9]{6}$' })
    expect(own.json().data.format).toEqual({ label: 'FX tax id', pattern: '^FX[0-9]{6}$' })
    expect((await get(compliance, `/v1/participants/${gbPayee}/tax-profile`)).json().data.format).toBeNull()
    expect((await staffPut(gbPayee, 'GB-1234')).statusCode).toBe(200)
    expect((await staffPut(gbPayee, 'G!')).json().error).toMatchObject({ code: 'TAX_ID_FORMAT', details: null })
  })
})
