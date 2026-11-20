// FR-TAX-003 year-end statements (D-BM-06): T-BM-11 routes, step-up, idempotency, scope, refusals; T-BM-12 filing export;
// T-BM-13 the payee's portal forms and the tax_form.available notice. AC-18.2, AC-TAX3-1..4.
import { getOwnerPool } from '@nmp/db/testing'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  auditActions, buildTestApp, call, closePoolsAfterAll, createMarket, createPortalUser, createSignedInUser, createTenant, ownerReplica, ownerRows, resetApiDb,
  type TestUser,
} from '../../../test/helpers/index.js'
import { taxModule } from './index.js'
import { committedRun, FIXTURE_FORM, payee, taxMarket, taxPack, taxProfile, type TaxMarket, type TaxPack } from './test-support.js'

let app: FastifyInstance
let tenantId: string
let pack: TaxPack
let at: TaxMarket
let finance: TestUser
let compliance: TestUser
let staleFinance: TestUser
let scopedFinance: TestUser
let otherFinance: TestUser
let p1Portal: TestUser
const p: Record<'p1' | 'p2' | 'p3' | 'p4', string> = { p1: '', p2: '', p3: '', p4: '' }

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  tenantId = (await createTenant()).id
  pack = await taxPack()
  at = await taxMarket(tenantId, pack.pack, 'AT')
  const gb = await createMarket(tenantId, 'GB')
  p.p1 = await payee(tenantId, at.marketId, 'P1', 'FX111111')
  p.p2 = await payee(tenantId, at.marketId, 'P2', 'FX222222')
  p.p3 = await payee(tenantId, at.marketId, 'P3', 'FX333333')
  p.p4 = await payee(tenantId, at.marketId, 'P4')
  // AC-18.2: P1 withheld 4.80; P2 nothing withheld but 23.00 >= the form's 20.00; P3 below both; P4 withheld 1.00, no tax id.
  await committedRun(tenantId, at, pack.withholdingId, '2025-06', [
    { participantId: p.p1, gross: 24000, withheld: 480 }, { participantId: p.p2, gross: 2300, withheld: 0 },
    { participantId: p.p3, gross: 1000, withheld: 0 }, { participantId: p.p4, gross: 5000, withheld: 100 },
  ])
  finance = await createSignedInUser({ tenantId, roles: ['Finance approver'], stepUp: true })
  compliance = await createSignedInUser({ tenantId, roles: ['Compliance officer'], stepUp: true })
  staleFinance = await createSignedInUser({ tenantId, roles: ['Finance approver'] })
  scopedFinance = await createSignedInUser({ tenantId, roles: ['Finance approver'], marketIds: [gb], stepUp: true })
  otherFinance = await createSignedInUser({ tenantId: (await createTenant()).id, roles: ['Finance approver'], stepUp: true })
  p1Portal = await createPortalUser({ tenantId, participantId: p.p1, stepUp: true })
  app = await buildTestApp({ modules: [taxModule] })
})

afterAll(async () => {
  await app.close()
})

const year = (as: TestUser, query = '', market = at.marketId, taxYear = 2025) =>
  call(app, { method: 'GET', url: `/v1/tax/year-end?market_id=${market}&tax_year=${taxYear}${query}`, as })
const generate = (as: TestUser, body: Record<string, unknown> = { market_id: at.marketId, tax_year: 2025 }, key: true | string = true) =>
  call(app, { method: 'POST', url: '/v1/tax/year-end-forms', as, body, idempotencyKey: key })
const forms = (as: TestUser, query = '') => call(app, { method: 'GET', url: `/v1/tax/year-end-forms?market_id=${at.marketId}&tax_year=2025${query}`, as })
const download = (as: TestUser, id: string) => call(app, { method: 'GET', url: `/v1/tax/year-end-forms/${id}/download`, as })
const exportForms = (as: TestUser, body: Record<string, unknown> = { market_id: at.marketId, tax_year: 2025 }, on = app) =>
  call(on, { method: 'POST', url: '/v1/tax/year-end-forms/export', as, body })
const latest = async (participantId: string) => (await forms(finance, `&participant_id=${participantId}`)).json().data[0]

describe('year-end statements (T-BM-11, AC-18.2, AC-TAX3-1, AC-TAX3-2)', () => {
  test('the preview: bounds, no reasons, payees by ref with inclusion and tax id, totals equal to the ledger; paged', async () => {
    const view = await year(compliance)
    const first = await year(finance, '&limit=2')
    const second = await year(finance, `&limit=2&cursor=${first.json().meta.next_cursor}`)

    expect(view.statusCode).toBe(200)
    expect(view.json().data).toMatchObject({
      bounds: { starts_on: '2025-01-01', ends_on: '2025-12-31' }, ended: true, open_period_ids: [], reasons: [],
      form_rule: { id: pack.formId, form_type: 'FX-ANNUAL', title: FIXTURE_FORM.title, min_gross_minor: '2000' },
      totals: { withheld_minor: '580', ledger_withheld_minor: '580', equal: true, included: 3, held: 1 },
    })
    expect(view.json().data.payees).toEqual([
      { participant: { id: p.p1, external_ref: 'P1' }, gross_minor: '24000', taxable_minor: '24000', withheld_minor: '480', tax_id: 'present', included: true, latest_version: null },
      { participant: { id: p.p2, external_ref: 'P2' }, gross_minor: '2300', taxable_minor: '2300', withheld_minor: '0', tax_id: 'present', included: true, latest_version: null },
      { participant: { id: p.p3, external_ref: 'P3' }, gross_minor: '1000', taxable_minor: '1000', withheld_minor: '0', tax_id: 'present', included: false, latest_version: null },
      { participant: { id: p.p4, external_ref: 'P4' }, gross_minor: '5000', taxable_minor: '5000', withheld_minor: '100', tax_id: 'missing', included: true, latest_version: null },
    ])
    expect(first.json().data.payees.map((row: { participant: { external_ref: string } }) => row.participant.external_ref)).toEqual(['P1', 'P2'])
    expect(second.json().data.payees.map((row: { participant: { external_ref: string } }) => row.participant.external_ref)).toEqual(['P3', 'P4'])
    expect(second.json().meta.next_cursor).toBeNull()
  })

  test('the ledger check counts only the market tenant\'s entries, also without RLS (tax_generate_forms is a definer)', async () => {
    const ledger = async () => (await ownerRows<{ minor: string }>('SELECT tax_ledger_withheld($1, 2025)::text AS minor', [at.marketId]))[0]!.minor
    const before = await ledger()
    const other = (await createTenant()).id
    const market = await taxMarket(other, pack.pack, 'AT')
    const own = await committedRun(other, market, pack.withholdingId, '2025-07', [{ participantId: await payee(other, market.marketId, 'B1'), gross: 1000, withheld: 20 }])
    // Another tenant's entry naming this tenant's run as its origin (only possible below the API).
    await ownerReplica(
      `WITH forged AS (
         INSERT INTO journal_entry (tenant_id, market_id, period_id, event_type, origin_type, origin_id, idempotency_key, approval_id, created_by, created_by_type)
         SELECT $1, $2, $3, 'run_committed', 'run', p.committed_run_id, 'run:' || p.committed_run_id::text, gen_random_uuid(), gen_random_uuid(), 'system'
         FROM period p WHERE p.calendar_id = $4 AND p.committed_run_id IS NOT NULL LIMIT 1 RETURNING id)
       INSERT INTO posting (tenant_id, entry_id, account_id, debit_minor, credit_minor, currency)
       SELECT $1, forged.id, a.id, 0, 999, 'EUR' FROM forged, ledger_account a WHERE a.tenant_id = $1 AND a.type = 'withholding_payable'`,
      [other, market.marketId, own.periodId, at.calendarId])

    expect(await ledger()).toBe(before)
  })

  test('access: tax.read reads; generation needs tax.forms and step-up; scope, another tenant, validation and the portal are refused', async () => {
    const portal = p1Portal
    expect((await generate(compliance)).json().error.code).toBe('PERMISSION_DENIED')
    expect((await generate(staleFinance)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await generate(scopedFinance)).statusCode).toBe(404)
    expect((await year(scopedFinance)).statusCode).toBe(404)
    expect((await generate(otherFinance)).statusCode).toBe(404)
    expect((await year(otherFinance)).statusCode).toBe(404)
    const outOfRange = await year(finance, '', at.marketId, 1999)
    expect([outOfRange.statusCode, outOfRange.json().error.code]).toEqual([400, 'VALIDATION_FAILED'])
    expect((await generate(finance, { market_id: at.marketId, tax_year: '2025' })).json().error.code).toBe('VALIDATION_FAILED')
    expect((await generate(finance, { market_id: at.marketId, tax_year: 2025 }, 'no spaces allowed')).json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect((await year(portal)).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await generate(portal)).json().error.code).toBe('REALM_FORBIDDEN')
    expect(await ownerRows('SELECT 1 FROM tax_form_generation WHERE tenant_id = $1', [tenantId])).toHaveLength(0)
  })

  test('generation: version 1 per included payee with a tax id, the held payee listed, audited, replayed by its key', async () => {
    const key = `gen-${Date.now()}`
    const created = await generate(finance, undefined, key)
    const replayed = await generate(finance, undefined, key)
    const generations = await call(app, { method: 'GET', url: `/v1/tax/year-end-generations?market_id=${at.marketId}&tax_year=2025`, as: compliance })

    expect(created.statusCode).toBe(201)
    expect(created.json().data).toEqual({ generation_id: expect.any(String), generated: 2, unchanged: 0, held: [{ participant_id: p.p4, external_ref: 'P4' }] })
    expect(replayed.headers['idempotent-replayed']).toBe('true')
    expect(replayed.json()).toEqual(created.json())
    expect(generations.json().data).toEqual([{
      id: created.json().data.generation_id, form_type: 'FX-ANNUAL', generated: 2, unchanged: 0, held: [{ participant_id: p.p4, external_ref: 'P4' }],
      withheld_total_minor: '580', created_by: expect.objectContaining({ id: finance.id }), created_at: expect.any(String),
    }])
    expect(await latest(p.p1)).toMatchObject({
      participant: { id: p.p1, external_ref: 'P1' }, form_type: 'FX-ANNUAL', version: 1, versions: 1, tax_id_masked: '•••• 1111', currency: 'EUR',
      totals: { gross_minor: '24000', taxable_minor: '24000', withheld_minor: '480', by_rule: [{ rule_id: pack.withholdingId, rate: '0.020000', taxable_minor: '24000', withheld_minor: '480' }] },
    })
    const [audit] = await ownerRows<{ after_ref: string }>(`SELECT after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action = 'TAX_FORMS.GENERATED'`, [tenantId])
    expect(JSON.parse(audit!.after_ref)).toMatchObject({ after: { generation_id: created.json().data.generation_id, market_id: at.marketId, tax_year: 2025, generated: 2, unchanged: 0, held_count: 1 } })
  })

  test('a tax id recorded later: the next generation makes its version 1 and leaves the others unchanged; changed totals make version 2', async () => {
    await taxProfile(tenantId, p.p4, 'FX444444', new Date(Date.now() - 1000).toISOString())
    const second = await generate(finance)
    await committedRun(tenantId, at, pack.withholdingId, '2025-11', [{ participantId: p.p1, gross: 10000, withheld: 200 }])
    const third = await generate(finance)
    const p1 = await latest(p.p1)
    const all = await forms(finance)

    expect(second.json().data).toMatchObject({ generated: 1, unchanged: 2, held: [] })
    expect(third.json().data).toMatchObject({ generated: 1, unchanged: 2, held: [] })
    expect(p1).toMatchObject({ version: 2, versions: 2, totals: { gross_minor: '34000', withheld_minor: '680' } })
    expect(all.json().data.map((f: { participant: { external_ref: string }; version: number }) => [f.participant.external_ref, f.version]))
      .toEqual([['P1', 2], ['P2', 1], ['P4', 1]])
    const [v1] = await ownerRows<{ id: string }>('SELECT id FROM tax_form WHERE participant_id = $1 AND version = 1', [p.p1])
    expect((await download(compliance, v1!.id)).statusCode).toBe(200)
  })

  test('download: the label,value statement under the pack title, audited; scope and another tenant get 404', async () => {
    const form = await latest(p.p1)
    const file = await download(compliance, form.id)

    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(file.headers['content-disposition']).toBe('attachment; filename="FX-ANNUAL-2025-v2.csv"')
    expect(file.headers['cache-control']).toBe('no-store')
    const lines = file.body.trim().split('\r\n')
    expect(lines.slice(0, 8)).toEqual(['label,value', `title,${FIXTURE_FORM.title}`, 'tax_year,2025', 'form_type,FX-ANNUAL', 'version,2', 'payee_ref,P1', 'tax_id,•••• 1111', 'currency,EUR'])
    expect(lines.slice(9)).toEqual(['gross,340.00', 'taxable,340.00', 'withheld,6.80', `rule_1_id,${pack.withholdingId}`, 'rule_1_rate,0.020000', 'rule_1_taxable,340.00', 'rule_1_withheld,6.80'])
    expect(file.body).not.toContain('FX111111')
    expect(await auditActions(tenantId)).toContain('TAX_FORM.DOWNLOADED')
    expect((await download(scopedFinance, form.id)).statusCode).toBe(404)
    expect((await download(otherFinance, form.id)).statusCode).toBe(404)
    expect((await forms(scopedFinance)).statusCode).toBe(404)
    expect((await forms(otherFinance)).statusCode).toBe(404)
  })

  test('a form keeps no title when the rule now in force for its year defines another form type (never another rule\'s title)', async () => {
    const sk = await taxMarket(tenantId, pack.pack, 'SK')
    const r1 = await payee(tenantId, sk.marketId, 'R1', 'FX777777')
    await committedRun(tenantId, sk, pack.withholdingId, '2025-06', [{ participantId: r1, gross: 10000, withheld: 200 }])
    expect((await generate(finance, { market_id: sk.marketId, tax_year: 2025 })).statusCode).toBe(201)
    const [form] = await ownerRows<{ id: string }>('SELECT id FROM tax_form WHERE participant_id = $1', [r1])
    // FIXTURE: the market moves to a pack whose year-end form rule defines another form type.
    const other = await taxPack({ form: false })
    await ownerRows(
      `INSERT INTO tax_rule (id, market_pack, title, kind, conditions, rounding, mandatory, effective_from, basis, basis_status, source_ref)
       VALUES ($1, $2, 'FIXTURE other form', 'year_end_form', $3, 'none', true, '2020-01-01', 'FIXTURE basis, not a real tax rule', 'counsel_confirmed', 'FIXTURE')`,
      [`${other.pack}-other@2020-01-01`, other.pack, { form_type: 'FX-OTHER', title: 'FIXTURE other statement' }])
    await ownerRows('UPDATE market SET market_pack = $1 WHERE id = $2', [other.pack, sk.marketId])

    const lines = (await download(finance, form!.id)).body.trim().split('\r\n')
    expect(lines.slice(1, 4)).toEqual(['title,', 'tax_year,2025', 'form_type,FX-ANNUAL'])
  })

  test('refusals (AC-TAX3-2): not ended, not closed with the periods, no form, no tax year, busy, ledger mismatch', async () => {
    const committed = await committedRun(tenantId, at, pack.withholdingId, '2024-06', [{ participantId: p.p1, gross: 100, withheld: 0 }], { state: 'committed' })
    const noForm = await taxMarket(tenantId, (await taxPack({ form: false })).pack, 'DE')
    const noYear = await taxMarket(tenantId, (await taxPack({ taxYear: false })).pack, 'CH')
    const mismatch = await taxMarket(tenantId, pack.pack, 'LI')
    const mp = await payee(tenantId, mismatch.marketId, 'M1', 'FX555555')
    await committedRun(tenantId, mismatch, pack.withholdingId, '2025-03', [{ participantId: mp, gross: 10000, withheld: 200 }], { ledgerWithheld: 150 })

    const results = [
      await generate(finance, { market_id: at.marketId, tax_year: 2026 }),
      await generate(finance, { market_id: at.marketId, tax_year: 2024 }),
      await generate(finance, { market_id: noForm.marketId, tax_year: 2025 }),
      await generate(finance, { market_id: noYear.marketId, tax_year: 2025 }),
    ]
    const broken = await generate(finance, { market_id: mismatch.marketId, tax_year: 2025 })
    const preview = await year(finance, '', at.marketId, 2024)

    expect(results.map((r) => [r.statusCode, r.json().error.code])).toEqual([
      [422, 'TAX_YEAR_NOT_ENDED'], [422, 'TAX_YEAR_NOT_CLOSED'], [422, 'FORM_NOT_DEFINED'], [422, 'TAX_YEAR_NOT_DEFINED'],
    ])
    expect(results[1]!.json().error.details).toEqual({ period_ids: [committed.periodId] })
    expect(preview.json().data).toMatchObject({ reasons: ['TAX_YEAR_NOT_CLOSED'], open_period_ids: [committed.periodId] })
    expect([broken.statusCode, broken.json().error.code]).toEqual([500, 'INVARIANT_FAILED'])
    expect(await ownerRows('SELECT 1 FROM tax_form_generation WHERE market_id = $1', [mismatch.marketId])).toHaveLength(0)

    const holder = await getOwnerPool().connect()
    try {
      await holder.query('BEGIN')
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('tax_forms:' || $1 || ':' || $2 || ':' || 2025, 0))`, [tenantId, at.marketId])
      const busy = await generate(finance)
      expect([busy.statusCode, busy.json().error.code]).toEqual([409, 'GENERATION_BUSY'])
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
    }
  })
})

describe('filing export (T-BM-12, AC-TAX3-3)', () => {
  test('the latest version per payee with the full tax id in force at creation; an erased id is empty; audited without values', async () => {
    // P2 is erased after its form was made (prv_erase_participant clears the sealed and masked id).
    await ownerReplica('UPDATE tax_profile SET tax_id_sealed = NULL, tax_id_masked = NULL WHERE participant_id = $1', [p.p2])
    // A later tax id of P1 does not change what its form was made with.
    await taxProfile(tenantId, p.p1, 'FX999999', new Date().toISOString())
    const file = await exportForms(finance)

    expect(file.statusCode).toBe(200)
    expect(file.headers['cache-control']).toBe('no-store')
    expect(file.headers['content-disposition']).toBe(`attachment; filename="tax-forms-${at.marketId}-2025.csv"`)
    expect(file.body.trim().split('\r\n')).toEqual([
      'payee_ref,tax_id,tax_id_status,form_type,version,currency,gross,taxable,withheld',
      'P1,FX111111,present,FX-ANNUAL,2,EUR,340.00,340.00,6.80',
      'P2,,erased,FX-ANNUAL,1,EUR,23.00,23.00,0.00',
      'P4,FX444444,present,FX-ANNUAL,1,EUR,50.00,50.00,1.00',
    ])
    const audits = await ownerRows<{ action: string; after_ref: string }>(
      `SELECT action, after_ref FROM audit.audit_event WHERE tenant_id = $1 AND action IN ('TAX_FORMS.EXPORTED', 'EXPORT.CREATED') ORDER BY seq`, [tenantId])
    expect(audits.map((a) => a.action)).toEqual(['EXPORT.CREATED', 'TAX_FORMS.EXPORTED'])
    expect(JSON.parse(audits[0]!.after_ref)).toMatchObject({ after: { kind: 'tax_forms', filters: { market_id: at.marketId, tax_year: 2025 }, row_count: 3 } })
    expect(JSON.parse(audits[1]!.after_ref)).toMatchObject({ after: { market_id: at.marketId, tax_year: 2025, rows: 3 } })
    expect(audits.some((a) => /FX[0-9]{6}/.test(a.after_ref))).toBe(false)
  })

  test('refusals: no forms, the row cap, tax.read only, no step-up, scope, another tenant, the portal', async () => {
    const capped = await buildTestApp({ modules: [taxModule], env: { EXPORT_ROW_CAP: '2' } })
    try {
      const refused = await exportForms(finance, undefined, capped)
      expect([refused.statusCode, refused.json().error.code, refused.json().error.details]).toEqual([422, 'EXPORT_ROW_CAP_EXCEEDED', { row_count: 3, row_cap: 2 }])
    } finally {
      await capped.close()
    }
    const portal = p1Portal
    expect((await exportForms(finance, { market_id: at.marketId, tax_year: 2023 })).json().error.code).toBe('NO_FORMS')
    expect((await exportForms(compliance)).json().error.code).toBe('PERMISSION_DENIED')
    expect((await exportForms(staleFinance)).json().error.code).toBe('STEP_UP_REQUIRED')
    expect((await exportForms(scopedFinance)).statusCode).toBe(404)
    expect((await exportForms(otherFinance)).statusCode).toBe(404)
    expect((await exportForms(finance, { market_id: at.marketId })).json().error.code).toBe('VALIDATION_FAILED')
    expect((await exportForms(portal)).json().error.code).toBe('REALM_FORBIDDEN')
  })
})

describe('portal forms (T-BM-13, AC-TAX3-4)', () => {
  test('the payee lists its latest forms and downloads any own version; another payee\'s form is 404; staff sessions are refused', async () => {
    const own = p1Portal
    const list = await call(app, { method: 'GET', url: '/v1/me/tax-forms', as: own })
    const [v1] = await ownerRows<{ id: string }>('SELECT id FROM tax_form WHERE participant_id = $1 AND version = 1', [p.p1])
    const [p2Form] = await ownerRows<{ id: string }>('SELECT id FROM tax_form WHERE participant_id = $1', [p.p2])
    const file = await call(app, { method: 'GET', url: `/v1/me/tax-forms/${v1!.id}/download`, as: own })

    expect(list.json().data).toEqual([{
      id: expect.any(String), tax_year: 2025, form_type: 'FX-ANNUAL', title: FIXTURE_FORM.title, version: 2, currency: 'EUR',
      totals: { gross_minor: '34000', taxable_minor: '34000', withheld_minor: '680' }, created_at: expect.any(String),
    }])
    expect(file.statusCode).toBe(200)
    expect(file.body).toContain('version,1\r\n')
    expect(file.body).toContain('withheld,4.80\r\n')
    const [audit] = await ownerRows(
      `SELECT 1 FROM audit.audit_event WHERE tenant_id = $1 AND action = 'TAX_FORM.DOWNLOADED' AND object_id = $2`, [tenantId, v1!.id])
    expect(audit).toBeDefined()
    expect((await call(app, { method: 'GET', url: `/v1/me/tax-forms/${p2Form!.id}/download`, as: own })).statusCode).toBe(404)
    const stranger = await createPortalUser({ tenantId, participantId: p.p3 })
    expect((await call(app, { method: 'GET', url: '/v1/me/tax-forms', as: stranger })).json().data).toEqual([])
    expect((await call(app, { method: 'GET', url: '/v1/me/tax-forms', as: finance })).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await call(app, { method: 'GET', url: `/v1/me/tax-forms/${v1!.id}/download`, as: finance })).json().error.code).toBe('REALM_FORBIDDEN')
    expect((await call(app, { method: 'GET', url: '/v1/me/tax-forms/not-a-uuid/download', as: own })).json().error.code).toBe('VALIDATION_FAILED')
  })

  test('every new version notifies its payee in-app (tax_form.available) in the market language', async () => {
    const notices = await ownerRows<{ recipient_participant_id: string; locale: string; params: Record<string, unknown> }>(
      `SELECT recipient_participant_id, locale, params FROM notification WHERE tenant_id = $1 AND template = 'tax_form.available' AND channel = 'in_app'`, [tenantId])
    const forms = await ownerRows<{ id: string; participant_id: string }>('SELECT id, participant_id FROM tax_form WHERE tenant_id = $1', [tenantId])

    expect(notices).toHaveLength(forms.length)
    expect(notices.every((n) => n.locale === 'de')).toBe(true)
    expect(notices.map((n) => n.params.form_id).sort()).toEqual(forms.map((f) => f.id).sort())
    expect(notices.find((n) => n.recipient_participant_id === p.p4)!.params).toMatchObject({ tax_year: 2025, form_type: 'FX-ANNUAL' })
  })
})
