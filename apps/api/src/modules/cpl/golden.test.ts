import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  buildTestApp, closePoolsAfterAll, createMarket, createSignedInUser, createTenant, resetApiDb, runQueuedJobs, type TestUser,
} from '../../../test/helpers/index.js'
import { cplModule, computeSnapshotJob } from './index.js'
import {
  getRows, getSnapshot, loadBatch, PROTOTYPE_SETTINGS, requestSnapshot, saveSettings, type FactsInput, type LineInput,
  type OrderInput, type ParticipantInput,
} from './test-fixtures.js'

// End to end on the full synthetic export: SQL load into cpl_fact_*, POST, job, GET equal the prototype report.json.
const PROTOTYPE = join(import.meta.dirname, '../../../../../engineering/reference/phase_a/prototype')

type Row = Record<string, string>
type Json = Record<string, any>

function readCsv(name: string): Row[] {
  const [header = '', ...lines] = readFileSync(join(PROTOTYPE, 'data_synthetic', name), 'utf8').trim().split(/\r?\n/)
  const columns = header.split(',')
  return lines.map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? '']))
  })
}

const minor = (value: string | undefined): string => value || '0'
const orNull = (value: string | undefined): string | null => value || null

function syntheticFacts(): FactsInput {
  return {
    participants: readCsv('participants.csv').map((r): ParticipantInput => [r.participant_id!, r.type!, r.enrolled_month!, orNull(r.sponsor_id)]),
    orders: readCsv('orders.csv').map((r): OrderInput => [
      r.order_id!, `${r.month}-${r.day!.padStart(2, '0')}`, r.buyer_id!, minor(r.amount_cents), minor(r.volume_cents), r.purpose!,
      r.is_starter_kit === '1', minor(r.refunded_cents), orNull(r.refund_month),
    ]),
    lines: readCsv('payout_lines.csv').map((r): LineInput => [
      r.line_id!, r.month!, r.payee_id!, r.bonus_type!, r.source_kind!, orNull(r.source_order_id), r.amount_cents!,
    ]),
  }
}

const golden: Json = JSON.parse(readFileSync(join(PROTOTYPE, 'report.json'), 'utf8'))
const months: string[] = golden.months

let app: FastifyInstance
let officer: TestUser
let snapshot: Json

closePoolsAfterAll()

beforeAll(async () => {
  await resetApiDb()
  const tenant = await createTenant()
  const market = await createMarket(tenant.id, 'DEMO')
  officer = await createSignedInUser({ tenantId: tenant.id, roles: ['Compliance officer'] })
  await saveSettings(officer, PROTOTYPE_SETTINGS)
  await loadBatch(officer, market, ['2025-01-01', '2025-12-31'], syntheticFacts())
  app = await buildTestApp({ modules: [cplModule] })
  const created = await requestSnapshot(app, officer, { market: 'DEMO', period_from: '2025-01', period_to: '2025-12' })
  await runQueuedJobs(computeSnapshotJob)
  snapshot = (await getSnapshot(app, officer, created.json().data.id)).json().data
})

afterAll(async () => {
  await app.close()
})

/** Stored values are decimal strings ("56.60"); report.json holds JSON numbers (56.6). */
function stated(report: string, period: string): Record<string, number | null> {
  const result = snapshot.results.find((r: Json) => r.report === report && r.period === period)
  return Object.fromEntries(result.figures.map((f: Json) => [f.key, f.value === null ? null : Number(f.value)]))
}

const prefixed = (prefix: string, values: Json): Json =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [`${prefix}.${key}`, value]))

describe('golden: the synthetic export end to end equals report.json', () => {
  test('the snapshot is ready over twelve months and the year is complete', () => {
    expect(snapshot.state).toBe('ready')
    expect(snapshot.results.filter((r: Json) => r.report === 'R1').map((r: Json) => r.period)).toEqual(months)
    expect(snapshot.results.find((r: Json) => r.report === 'R5').partial).toBe(false)
  })

  test.each(months)('R1 to R4 for %s', (month) => {
    const { flagged_payees_sample: _sample, ...r2 } = golden.R2[month]
    const { share_pct: shares, ...r3 } = golden.R3[month]
    const { note: _note, ...r4 } = golden.R4[month]
    expect(stated('R1', month)).toMatchObject(golden.R1[month])
    expect(stated('R2', month)).toMatchObject(r2)
    expect(stated('R3', month)).toMatchObject({ ...r3, ...prefixed('share_pct', shares) })
    expect(stated('R4', month)).toMatchObject(r4)
  })

  test('R3 year and R5', () => {
    const { share_pct: shares, ...r3 } = golden.R3.year
    const { population: _population, basis: _basis, bands, ...r5 } = golden.R5
    expect(stated('R3', '2025')).toMatchObject({ ...r3, ...prefixed('share_pct', shares) })
    expect(stated('R5', '2025')).toMatchObject({ ...r5, ...prefixed('bands', bands) })
  })

  test('drill-down of the R2 flag lists the prototype\'s flagged payees first', async () => {
    const rows = await getRows(app, officer, snapshot.id, 'R2.2025-12.payees_above_flag', '?limit=10')

    expect(rows.json().data.map((r: Json) => r.participant_ref)).toEqual(golden.R2['2025-12'].flagged_payees_sample)
    expect(rows.json().meta.row_count).toBe(golden.R2['2025-12'].payees_above_flag)
  })
})
