import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { computeReports, METHOD_VERSION, type ComplianceFacts, type OrderFact, type PayoutLineFact } from '../src/index.js'
import { figure, FIXTURE_CONFIG, period, value } from './helpers.js'

const PROTOTYPE = join(import.meta.dirname, '../../../engineering/reference/phase_a/prototype')
const END_CUSTOMER_TYPES = new Set(['customer', 'preferred_customer'])

type Row = Record<string, string>
type Json = Record<string, any>

function readCsv(name: string): Row[] {
  const [header = '', ...rows] = readFileSync(join(PROTOTYPE, 'data_synthetic', name), 'utf8').trim().split(/\r?\n/)
  const columns = header.split(',')
  return rows.map((row) => {
    const cells = row.split(',')
    return Object.fromEntries(columns.map((column, i) => [column, cells[i] ?? '']))
  })
}

const text = (row: Row, column: string): string => row[column] ?? ''
const minor = (row: Row, column: string): bigint => BigInt(text(row, column) || '0')

function loadFacts(): ComplianceFacts {
  return {
    participants: readCsv('participants.csv').map((r) => ({
      participantRef: text(r, 'participant_id'), typeCode: text(r, 'type'),
      countsAsEndCustomer: END_CUSTOMER_TYPES.has(text(r, 'type')), canEarn: !END_CUSTOMER_TYPES.has(text(r, 'type')),
      enrolledMonth: text(r, 'enrolled_month'), servicingRef: text(r, 'sponsor_id') || null,
    })),
    orders: readCsv('orders.csv').map((r) => ({
      orderRef: text(r, 'order_id'), orderMonth: text(r, 'month'), orderDay: text(r, 'day') === '' ? null : parseInt(text(r, 'day'), 10),
      buyerRef: text(r, 'buyer_id'), amountMinor: minor(r, 'amount_cents'), volumeMinor: minor(r, 'volume_cents'),
      purpose: text(r, 'purpose') as OrderFact['purpose'], isStarterKit: text(r, 'is_starter_kit') === '1',
      refundedMinor: minor(r, 'refunded_cents'), refundMonth: text(r, 'refund_month') || null,
    })),
    payoutLines: readCsv('payout_lines.csv').map((r) => ({
      lineRef: text(r, 'line_id'), payMonth: text(r, 'month'), payeeRef: text(r, 'payee_id'), bonusType: text(r, 'bonus_type'),
      sourceKind: text(r, 'source_kind') as PayoutLineFact['sourceKind'], sourceOrderRef: text(r, 'source_order_id') || null,
      amountMinor: minor(r, 'amount_cents'),
    })),
  }
}

const golden: Json = JSON.parse(readFileSync(join(PROTOTYPE, 'report.json'), 'utf8'))
const reports = computeReports(loadFacts(), FIXTURE_CONFIG)
const months: string[] = golden.months

/** report.json holds JSON numbers (62.5); figures hold decimal strings ("62.50"). */
const asNumber = (v: string | null): number | null => (v === null ? null : parseFloat(v))

function expectFigures(report: 'R1' | 'R2' | 'R3' | 'R4' | 'R5', periodKey: string, expected: Json): void {
  for (const [key, want] of Object.entries(expected)) {
    expect(asNumber(value(reports, report, periodKey, key)), `${report} ${periodKey} ${key}`).toBe(want)
  }
}

describe('golden: synthetic export equals the prototype report.json', () => {
  test('covers the same twelve months and one year', () => {
    expect(reports.months).toEqual(months)
    expect(months).toHaveLength(12)
    expect(reports.years).toEqual(['2025'])
    expect(reports.methodVersion).toBe(METHOD_VERSION)
  })

  test.each(months)('R1 %s', (month) => {
    expectFigures('R1', month, golden.R1[month])
    expect(period(reports, 'R1', month).figures).toHaveLength(Object.keys(golden.R1[month]).length)
  })

  test.each(months)('R2 %s', (month) => {
    const { flagged_payees_sample: sample, ...numbers } = golden.R2[month]
    expectFigures('R2', month, numbers)
    expect(figure(reports, 'R2', month, 'payees_above_flag').drill.numeratorIds.slice(0, sample.length)).toEqual(sample)
    expect(value(reports, 'R2', month, 'unattributable_lines')).toBe('0')
    expect(value(reports, 'R2', month, 'unattributable_amount_cents')).toBe('0')
    expect(period(reports, 'R2', month).omitted).toEqual([])
  })

  test.each([...months, 'year'])('R3 %s', (key) => {
    const { share_pct: shares, ...totals } = golden.R3[key]
    const periodKey = key === 'year' ? '2025' : key
    expectFigures('R3', periodKey, totals)
    expectFigures('R3', periodKey, Object.fromEntries(Object.entries(shares).map(([kind, pct]) => [`share_pct.${kind}`, pct])))
    const shareKeys = period(reports, 'R3', periodKey).figures.map((f) => f.key).filter((k) => k.startsWith('share_pct.'))
    expect(shareKeys).toEqual(Object.keys(shares).map((kind) => `share_pct.${kind}`))
    expect(period(reports, 'R3', periodKey).partial).toBe(false)
  })

  test.each(months)('R4 %s', (month) => {
    const { note, ...numbers } = golden.R4[month]
    expectFigures('R4', month, numbers)
    expect(period(reports, 'R4', month).notes).toEqual([note])
    expect(period(reports, 'R4', month).omitted).toEqual([])
    expect(period(reports, 'R4', month).figures).toHaveLength(Object.keys(numbers).length)
  })

  test('R5 2025', () => {
    const { population, basis, bands, ...numbers } = golden.R5
    expectFigures('R5', '2025', numbers)
    expectFigures('R5', '2025', Object.fromEntries(Object.entries(bands).map(([name, n]) => [`bands.${name}`, n])))
    const r5 = period(reports, 'R5', '2025')
    expect(r5.partial).toBe(false)
    expect(r5.figures).toHaveLength(Object.keys(numbers).length + Object.keys(bands).length)
    expect(figure(reports, 'R5', '2025', 'mean').method).toContain(basis)
    expect(typeof population).toBe('string')
  })

  test('every figure carries population, method, method version and a drill-down', () => {
    for (const f of reports.reports.flatMap((r) => r.figures)) {
      expect(f.population.length, f.key).toBeGreaterThan(0)
      expect(f.method.length, f.key).toBeGreaterThan(0)
      expect(f.methodVersion).toBe(METHOD_VERSION)
      expect(f.drill.numeratorIds.length).toBeLessThanOrEqual(f.drill.numeratorCount)
    }
  })

  test('recomputation gives identical figures and does not depend on fact order', () => {
    const facts = loadFacts()
    const shuffled = { participants: [...facts.participants].reverse(), orders: [...facts.orders].reverse(), payoutLines: [...facts.payoutLines].reverse() }
    const withoutDrill = (r: typeof reports) => r.reports.map((p) => p.figures.map((f) => [p.report, p.period, f.key, f.value, f.numerator, f.denominator]))
    expect(withoutDrill(computeReports(shuffled, FIXTURE_CONFIG))).toEqual(withoutDrill(reports))
  })
})
