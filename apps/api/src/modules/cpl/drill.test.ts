import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  baseRoleId, buildTestApp, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, ownerRows, resetApiDb, runQueuedJobs,
  type TestUser,
} from '../../../test/helpers/index.js'
import { audModule } from '../aud/index.js'
import { iamModule } from '../iam/index.js'
import { tenModule } from '../ten/index.js'
import { cplModule, computeSnapshotJob } from './index.js'
import { getRows, getSnapshot, loadBatch, PROTOTYPE_SETTINGS, requestSnapshot, saveSettings, supersede, TS31, type FactsInput } from './test-fixtures.js'

const JAN_FEB = { market: 'GB', period_from: '2025-01', period_to: '2025-02' }
const JAN_FEB_DATES = ['2025-01-01', '2025-02-28'] as const
// The same period re-imported with O1 doubled.
const REIMPORT: FactsInput = {
  ...TS31, orders: [['O1', '2025-01-03', 'C1', '20000', '20000', 'customer', false, '0', null], ...TS31.orders.slice(1)],
}

let app: FastifyInstance
let market: string
let officer: TestUser
let executive: TestUser
let payoutOfficer: TestUser
let globexOfficer: TestUser
let batchId: string
let snapshotId: string

type Row = Record<string, string | number | boolean | null>

closePoolsAfterAll()

async function readySnapshot(as: TestUser): Promise<string> {
  const id = (await requestSnapshot(app, as, JAN_FEB)).json().data.id as string
  await runQueuedJobs(computeSnapshotJob)
  return id
}

beforeAll(async () => {
  await resetApiDb()
  const acme = await createTenant()
  const globex = await createTenant()
  market = await createMarket(acme.id, 'GB')
  officer = await createSignedInUser({ tenantId: acme.id, roles: ['Compliance officer'] })
  executive = await createSignedInUser({ tenantId: acme.id, roles: ['Executive read-only'] })
  payoutOfficer = await createSignedInUser({ tenantId: acme.id, roles: ['Payout officer'] })
  globexOfficer = await createSignedInUser({ tenantId: globex.id, roles: ['Compliance officer'] })
  await saveSettings(officer, PROTOTYPE_SETTINGS)
  batchId = await loadBatch(officer, market, JAN_FEB_DATES, TS31)
  app = await buildTestApp({ modules: [iamModule, tenModule, audModule, cplModule] })
  snapshotId = await readySnapshot(officer)
})

afterAll(async () => {
  await app.close()
})

const sum = (rows: Row[], value: (row: Row) => bigint): bigint => rows.reduce((total, row) => total + value(row), 0n)
const net = (row: Row): bigint => BigInt(row.amount_minor as string) - BigInt(row.refunded_minor as string)
const amount = (row: Row): bigint => BigInt(row.amount_minor as string)
const volume = (row: Row): bigint => BigInt(row.volume_minor as string)
const earnings = (row: Row): bigint => BigInt(row.earnings_minor as string)
const one = (): bigint => 1n

// What each figure's rows add up (MVP_A_SPEC section 5): net sales, volume, pay or earnings, else a row count.
const VOLUME_FIGURES = new Set(['rewarded_volume_cents', 'personal_use_share_pct', 'unknown_purpose_share_pct'])
function measureOf(figureId: string): (row: Row) => bigint {
  const [report, , ...rest] = figureId.split('.')
  const key = rest.join('.')
  if (report === 'R1') return key === 'participant_orders_purpose_unknown_pct' ? one : net
  if (report === 'R2') return VOLUME_FIGURES.has(key) ? volume : key === 'unattributable_amount_cents' ? amount : one
  if (report === 'R3') return amount
  return key === 'mean' ? earnings : one
}

interface FigureView { id: string; numerator: string | null; denominator: string | null }

describe('GET /v1/compliance/snapshots/:id/figures/:figure/rows', () => {
  test('numerator and denominator rows of a figure sum to its components (AC-41.1, TS-34)', async () => {
    const numerator = await getRows(app, executive, snapshotId, 'R1.2025-01.customer_share_pct')
    const denominator = await getRows(app, executive, snapshotId, 'R1.2025-01.customer_share_pct', '?set=denominator')

    expect(numerator.statusCode).toBe(200)
    expect(numerator.json().data.map((r: Row) => r.order_ref)).toEqual(['O1'])
    expect(sum(numerator.json().data, net)).toBe(10000n)
    expect(sum(denominator.json().data, net)).toBe(16000n)
    expect(denominator.json().meta).toMatchObject({
      set: 'denominator', entity: 'order', row_count: 3, next_cursor: null,
      figure: { id: 'R1.2025-01.customer_share_pct', value: '62.50', numerator: '10000', denominator: '16000' },
    })
    expect(denominator.json().meta).toMatchObject({
      sums: { net_minor: '16000' }, component: { key: 'net_minor', expected_minor: '16000' },
    })
    expect(Object.keys(denominator.json().meta.sums)).toEqual(['amount_minor', 'volume_minor', 'refunded_minor', 'net_minor'])
    expect(numerator.json().meta.component).toEqual({ key: 'net_minor', expected_minor: '10000' })
    expect(numerator.json().meta.notice).toContain('not income projections')
  })

  test('AC-41.1: meta.sums cover the whole set, not the page, and meta.component names the sum equal to the component', async () => {
    const results = (await getSnapshot(app, officer, snapshotId)).json().data.results as { figures: FigureView[] }[]
    const figures = results.flatMap((r) => r.figures).filter((f) => !f.id.endsWith('.flag_threshold') && f.numerator !== null)
    const mismatches: string[] = []
    let compared = 0
    for (const figure of figures) {
      for (const set of ['numerator', 'denominator'] as const) {
        const page = (await getRows(app, officer, snapshotId, figure.id, `?set=${set}&limit=1`)).json()
        const all: Row[] = (await getRows(app, officer, snapshotId, figure.id, `?set=${set}&limit=200`)).json().data
        const { sums, component } = page.meta as { sums: Record<string, string>; component: { key: string; expected_minor: string } | null }
        const whole = Object.fromEntries(Object.keys(sums).map((key) => [key, sum(all, (row) => BigInt(row[key] as string)).toString()]))
        if (JSON.stringify(sums) !== JSON.stringify(whole)) mismatches.push(`${figure.id} ${set}: sums ${JSON.stringify(sums)}`)
        if (component === null) continue
        compared += 1
        if (sums[component.key] !== component.expected_minor || component.expected_minor !== figure[set]) {
          mismatches.push(`${figure.id} ${set}: ${JSON.stringify(component)}`)
        }
      }
    }

    expect(mismatches).toEqual([])
    expect(compared).toBeGreaterThan(10)
    expect((await getRows(app, officer, snapshotId, 'R4.2025-01.active_distributors')).json().meta.component).toBeNull()
  })

  test('payout-line and participant figures drill to their rows, with no genealogy or other personal data', async () => {
    const retail = await getRows(app, officer, snapshotId, 'R3.2025-01.share_pct.retail_sale')
    const gross = await getRows(app, officer, snapshotId, 'R3.2025-01.share_pct.retail_sale', '?set=denominator')
    const population = await getRows(app, officer, snapshotId, 'R5.2025.count')

    expect(sum(retail.json().data, amount)).toBe(2500n)
    expect(sum(gross.json().data, amount)).toBe(3100n)
    expect(population.json().data).toEqual([
      {
        participant_ref: 'D1', type_code: 'distributor', counts_as_end_customer: false, can_earn: true, enrolled_month: '2024-12',
        earnings_minor: '2860',
      },
      {
        participant_ref: 'D2', type_code: 'distributor', counts_as_end_customer: false, can_earn: true, enrolled_month: '2025-01',
        earnings_minor: '0',
      },
    ])
  })

  test('pages by reference with an opaque cursor', async () => {
    const figure = 'R1.2025-01.customer_share_pct'
    const first = await getRows(app, officer, snapshotId, figure, '?set=denominator&limit=1')
    const second = await getRows(app, officer, snapshotId, figure, `?set=denominator&limit=2&cursor=${first.json().meta.next_cursor}`)

    expect(first.json().data.map((r: Row) => r.order_ref)).toEqual(['O1'])
    expect(second.json().data.map((r: Row) => r.order_ref)).toEqual(['O2', 'O3'])
    expect(second.json().meta.next_cursor).toBeNull()
    expect((await getRows(app, officer, snapshotId, figure, '?cursor=%%%')).json().error.code).toBe('INVALID_CURSOR')
    expect((await getRows(app, officer, snapshotId, figure, '?set=both')).statusCode).toBe(400)
  })

  test('export=true returns both row sets as CSV, watermarked and logged with the row count (FR-AUD-002)', async () => {
    const exported = await getRows(app, officer, snapshotId, 'R1.2025-01.customer_share_pct', '?export=true')
    const [job] = await ownerRows<{ id: string; kind: string; row_count: string; filters: unknown }>(
      `SELECT id, kind, row_count, filters FROM export_job WHERE requested_by = $1`, [officer.id],
    )
    const [event] = await ownerRows<{ after_ref: string }>(
      `SELECT after_ref FROM audit.audit_event WHERE action = 'EXPORT.CREATED' AND object_id = $1`, [job!.id],
    )
    const lines = exported.body.trim().split('\r\n')

    expect(exported.statusCode).toBe(200)
    expect(exported.headers['content-type']).toContain('text/csv')
    expect(lines[0]).toBe('set,order_ref,order_month,order_day,buyer_ref,amount_minor,volume_minor,refunded_minor,net_minor,refund_month,purpose,is_starter_kit,watermark')
    expect(lines.slice(1).map((line) => line.split(',').slice(0, 2).join(','))).toEqual([
      'numerator,O1', 'denominator,O1', 'denominator,O2', 'denominator,O3',
    ])
    expect(lines.slice(1).every((line) => line.endsWith(`export ${job!.id} for user ${officer.id}`))).toBe(true)
    expect(job).toMatchObject({ kind: 'compliance_rows', row_count: '4', filters: { snapshot_id: snapshotId, figure: 'R1.2025-01.customer_share_pct' } })
    expect(JSON.parse(event!.after_ref).after).toMatchObject({ kind: 'compliance_rows', row_count: 4 })
  })

  test('exported amounts stay numbers: a negative amount is not written as text (AC-41.1)', async () => {
    const exported = await getRows(app, officer, snapshotId, 'R3.2025.clawback_cents', '?export=true')

    expect(exported.body.split('\r\n')[1]).toMatch(/^numerator,L4,2025-02,D1,clawback,clawback,O3,-240,export /)
  })

  test('TS-34: the rows of every R1 to R5 figure sum to its numerator and denominator', async () => {
    const results = (await getSnapshot(app, officer, snapshotId)).json().data.results as { report: string; figures: FigureView[] }[]
    // flag_threshold is the tenant setting itself, not a population; R5 statistics other than the mean have no components.
    const figures = results.flatMap((r) => r.figures).filter((f) => !f.id.endsWith('.flag_threshold') && f.numerator !== null)
    const checked: (string | null)[][] = []
    for (const figure of figures) {
      const rowsOf = async (set: string): Promise<Row[]> =>
        (await getRows(app, officer, snapshotId, figure.id, `?set=${set}&limit=200`)).json().data
      const [numerator, denominator] = [await rowsOf('numerator'), await rowsOf('denominator')]
      const measure = measureOf(figure.id)
      // A figure without denominator rows divides by its numerator row count (R5 mean).
      const denominatorSum = denominator.length === 0 ? BigInt(numerator.length) : sum(denominator, measure)
      checked.push([figure.id, sum(numerator, measure).toString(), figure.denominator === null ? null : denominatorSum.toString()])
    }

    expect(checked).toEqual(figures.map((f) => [f.id, f.numerator, f.denominator]))
    expect([...new Set(results.map((r) => r.report))]).toEqual(['R1', 'R2', 'R3', 'R4', 'R5'])
  })

  test('participant rows carry the amounts their figure ranks and flags by (R2, R4, R5)', async () => {
    const flagged = (await getRows(app, officer, snapshotId, 'R2.2025-01.payees_above_flag')).json().data
    const active = (await getRows(app, officer, snapshotId, 'R4.2025-01.active_distributors', '?set=denominator')).json().data
    const population = (await getRows(app, officer, snapshotId, 'R5.2025.median')).json().data

    expect(flagged).toEqual([expect.objectContaining({ participant_ref: 'D1', multilevel_pay_minor: '600', personal_use_pay_minor: '360' })])
    expect(active).toEqual([expect.objectContaining({ participant_ref: 'D2', personal_volume_minor: '10000' })])
    // Median 14.30 and max 28.60 of the yearly earnings 0 and 2860 minor units.
    expect(population.map((row: Row) => [row.participant_ref, row.earnings_minor])).toEqual([['D1', '2860'], ['D2', '0']])
  })

  test('an export above the row cap is refused with 422 and logged as refused', async () => {
    const capped = await buildTestApp({ modules: [cplModule], env: { EXPORT_ROW_CAP: '1' } })
    const refused = await getRows(capped, officer, snapshotId, 'R1.2025-01.customer_share_pct', '?export=true')
    await capped.close()
    const events = await ownerRows(`SELECT 1 FROM audit.audit_event WHERE tenant_id = $1 AND action = 'EXPORT.REFUSED'`, [officer.tenantId])

    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({ code: 'EXPORT_ROW_CAP_EXCEEDED', details: { row_count: 4, row_cap: 1 } })
    expect(events).toHaveLength(1)
  })

  test('reading rows needs compliance.read, exporting them also needs export; another tenant gets 404', async () => {
    const figure = 'R1.2025-01.customer_share_pct'

    expect((await getRows(app, executive, snapshotId, figure, '?export=true')).statusCode).toBe(403)
    expect((await getRows(app, payoutOfficer, snapshotId, figure)).json().error.code).toBe('PERMISSION_DENIED')
    expect((await getRows(app, globexOfficer, snapshotId, figure)).statusCode).toBe(404)
    expect((await getRows(app, globexOfficer, snapshotId, figure, '?export=true')).statusCode).toBe(404)
  })

  test('SEC-26: exporting needs the snapshot\'s market in the export grant itself; a read grant for all markets does not widen it', async () => {
    const ie = await createMarket(officer.tenantId!, 'IE')
    const mixed = await createSignedInUser({ tenantId: officer.tenantId, roles: ['Executive read-only'] })
    await ownerRows(
      'INSERT INTO role_assignment (tenant_id, user_id, role_id, market_ids, valid_from) VALUES ($1, $2, $3, $4, now())',
      [officer.tenantId, mixed.id, await baseRoleId('Compliance officer'), [ie]],
    )
    const figure = 'R1.2025-01.customer_share_pct'

    expect((await getRows(app, mixed, snapshotId, figure)).statusCode).toBe(200)
    expect((await getRows(app, mixed, snapshotId, figure, '?export=true')).statusCode).toBe(404)
    expect(await ownerRows('SELECT 1 FROM export_job WHERE requested_by = $1', [mixed.id])).toEqual([])
  })

  test('unknown figures are 404; omitted indicators 422; snapshots still computing 409', async () => {
    const tenant = await createTenant()
    const tenantMarket = await createMarket(tenant.id, 'GB')
    const user = await createSignedInUser({ tenantId: tenant.id, roles: ['Compliance officer'] })
    await loadBatch(user, tenantMarket, JAN_FEB_DATES, TS31)
    const withoutSettings = await readySnapshot(user)
    const computing = (await requestSnapshot(app, user, JAN_FEB)).json().data.id

    expect((await getRows(app, officer, snapshotId, 'R1.2025-01.no_such_figure')).statusCode).toBe(404)
    expect((await getRows(app, officer, snapshotId, 'not-a-figure')).statusCode).toBe(404)
    const omitted = await getRows(app, user, withoutSettings, 'R4.2025-01.active_distributors')
    expect(omitted.statusCode).toBe(422)
    expect(omitted.json().error).toMatchObject({ code: 'FIGURE_OMITTED', details: { reason: expect.stringContaining('no default') } })
    expect((await getRows(app, user, computing, 'R1.2025-01.customer_share_pct')).json().error.code).toBe('SNAPSHOT_NOT_READY')
  })

  test('TS-33: after a re-import the old snapshot is outdated, keeps its figures and still drills to its own batch', async () => {
    const before = (await getSnapshot(app, officer, snapshotId)).json().data.results
    const reload = await loadBatch(officer, market, JAN_FEB_DATES, REIMPORT)
    await supersede(officer, batchId, reload)
    const after = (await getSnapshot(app, officer, snapshotId)).json().data
    const rows = await getRows(app, officer, snapshotId, 'R1.2025-01.customer_share_pct', '?set=denominator')
    const renewed = await readySnapshot(officer)
    const renewedRows = await getRows(app, officer, renewed, 'R1.2025-01.customer_share_pct', '?set=denominator')

    expect(after.state).toBe('outdated')
    expect(after.results).toEqual(before)
    expect(sum(rows.json().data, net)).toBe(16000n)
    expect(sum(renewedRows.json().data, net)).toBe(26000n)
  })
})
