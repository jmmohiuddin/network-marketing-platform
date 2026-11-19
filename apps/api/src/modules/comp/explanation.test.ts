import { randomUUID } from 'node:crypto'
import { RAW_SCALE, type Trace, type TraceSource, type TraceStep } from '@nmp/engine'
import { describe, expect, test } from 'vitest'
import { explainLine, traceFromJson } from './explanation.js'
import { jsonText } from './results.js'
import { buildStatement, originKind, type StatementLine } from './statements.js'

// T-B5-12 explanation templates (D-B5-08, AC-12.1, AC-DIST2-1/2) and T-B5-10 / TS-22 statement builder (D-B5-07, AC-04.1/04.2).

const PAYEE = randomUUID()
const raw = (minor: bigint) => minor * RAW_SCALE

function source(positionId: string | null, level: number | null, baseMinor: bigint, rate: string | null, contributionMinor: bigint): TraceSource {
  return {
    positionId, level, measure: rate === null ? null : 'gv', ruleKey: null, base: baseMinor, baseScale: 'minor', rate, share: null, capMinor: null,
    raw: raw(contributionMinor), orders: [{ orderId: randomUUID(), raw: raw(contributionMinor) }], compressedOver: [randomUUID()],
  }
}

function traceOf(kind: string, sources: readonly TraceSource[], omitted = { count: 0, raw: 0n }, steps: readonly TraceStep[] = []): Trace {
  const total = sources.reduce((a, s) => a + s.raw, 0n) + omitted.raw
  return {
    rule: 'rule_x', kind: kind as Trace['kind'], pass: 4, planVersionId: randomUUID(), engineVersion: '0.2.0', payeePositionId: PAYEE,
    rankEvaluated: [{ ladder: 'main', rank: 'R2' }], tree: null, sources, omitted, raw: total, steps,
  }
}

const input = (trace: Trace, amountMinor: string) => ({
  line: { id: randomUUID(), run_id: randomUUID(), amount_minor: amountMinor, currency: 'EUR' }, trace,
  rule: { key: 'rule_x', name: 'Pays 10% of level 1' }, period: { starts_at: new Date('2026-09-30T22:00:00Z'), ends_at: new Date('2026-10-31T23:00:00Z') },
  origin: null, minorDigits: 2,
})

const KINDS = [
  'pay.retail_margin', 'pay.percent_by_level', 'pay.generations', 'pay.percent_of_measure', 'pay.differential', 'pay.override', 'pay.matching',
  'pay.fast_start', 'pay.flat', 'pay.one_time', 'pay.pool', 'adjustment',
]

describe('T-B5-12 explanation templates', () => {
  test.each(KINDS)('%s has its own template and reconciles with the line amount', (kind) => {
    const body = explainLine(input(traceOf(kind, [source(randomUUID(), 1, 10_000n, '0.10', 1_000n)]), '1000'))
    expect(body.template).toBe(kind.replace('pay.', ''))
    expect(body.reconciles).toBe(true)
    expect(body.text[0]).not.toMatch(/inputs below/)
  })

  test('AC-12.1: per-level aggregates, own volume, rates vary, omitted sources; no other position or order id anywhere', () => {
    const [x, y, z] = [randomUUID(), randomUUID(), randomUUID()]
    const sources = [
      source(PAYEE, 0, 5_000n, '0.10', 500n), source(x, 1, 10_000n, '0.10', 1_000n), source(y, 1, 20_000n, '0.10', 2_000n),
      source(z, 2, 10_000n, '0.05', 500n), source(randomUUID(), 2, 10_000n, '0.03', 300n),
    ]
    const trace = traceOf('pay.percent_by_level', sources, { count: 3, raw: raw(200n) }, [
      { step: 'cap', key: 'company_cap', method: 'proportional', beforeRaw: raw(4_500n), afterMinor: 4_400n },
    ])
    const body = explainLine({ ...input(trace, '4400'), origin: { kind: 'late_order', original_period: { id: randomUUID(), starts_at: new Date('2026-08-31T22:00:00Z'), ends_at: new Date('2026-09-30T22:00:00Z') } } })
    expect(body.parts).toEqual([
      { level: 0, label: 'your own volume', count: 1, base: '50.00', base_unit: 'volume', rate: '0.10', contribution: '5.00' },
      { level: 1, label: 'level 1', count: 2, base: '300.00', base_unit: 'volume', rate: '0.10', contribution: '30.00' },
      { level: 2, label: 'level 2', count: 2, base: '200.00', base_unit: 'volume', rate: 'rates vary', contribution: '8.00' },
      { level: null, label: '3 further sources', count: 3, base: null, base_unit: null, rate: null, contribution: '2.00' },
    ])
    expect(body.steps).toEqual([{ kind: 'cap', text: 'Cap company_cap (proportional): 45.00 capped to 44.00.' }])
    expect(body).toMatchObject({ template: 'percent_by_level', rank_used: [{ ladder: 'main', rank: 'R2' }], rounding: null, reconciles: true })
    const uuids = JSON.stringify(body).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
    const allowed = new Set([body.line_id, body.run_id, body.origin!.original_period!.id])
    expect(uuids.filter((id) => !allowed.has(id))).toEqual([])
    expect(body.text.at(-1)).toBe('Amount: 44.00 EUR.')
  })

  test('rounding step and a mismatching amount', () => {
    const trace = { ...traceOf('pay.override', [source(randomUUID(), 1, 333n, '0.10', 0n)]), raw: 3_330_000_000_000n }
    const rounded = { ...trace, sources: [{ ...trace.sources[0]!, raw: 3_330_000_000_000n }], steps: [{ step: 'rounding' as const, mode: 'half_up' as const, raw: 3_330_000_000_000n, minor: 3n }] }
    const body = explainLine(input(rounded, '3'))
    expect(body.rounding).toEqual({ mode: 'half_up', before: '0.0333', after: '0.03' })
    expect(body.reconciles).toBe(true)
    expect(explainLine(input(rounded, '4')).reconciles).toBe(false)
  })

  test('AC-DIST2-2: an extension kind is explained by the generic template', () => {
    const body = explainLine(input(traceOf('pay.extension_kind', [source(randomUUID(), 1, 10_000n, '0.10', 1_000n)]), '1000'))
    expect(body.template).toBe('generic')
    expect(body.text[0]).toBe('This bonus (pay.extension_kind) was calculated from the inputs below.')
    expect(body.parts).toHaveLength(1)
  })

  test('the stored trace text (bigints as strings) reads back as the engine trace', () => {
    const trace = traceOf('pay.flat', [source(PAYEE, 0, 1n, null, 1_000n)], { count: 0, raw: 0n }, [
      { step: 'allocation', key: 'pool', weight: 2n, totalMinor: 3_000n, afterMinor: 1_000n },
    ])
    expect(traceFromJson(jsonText(trace))).toEqual(trace)
  })
})

const line = (positionRef: string, amount: string, rule = 'rank_bonus', origin: string | null = null): StatementLine => ({
  id: randomUUID(), position_id: `pos-${positionRef}`, position_ref: positionRef, rule_key: rule, amount_minor: amount, origin_type: origin, original_period_id: null,
})

describe('T-B5-10 statement builder', () => {
  test('TS-22 / AC-04.1: lines grouped per position with totals 100.10, 250.25, 49.65 and person total 400.00', () => {
    const lines = [line('A', '10000'), line('A', '10', 'match'), line('B', '25025'), line('C', '4965')]
    const statement = buildStatement(lines, { gross_minor: '40000', netted_minor: '0', withheld_minor: '0', net_payable_minor: '40000' }, new Map([['rank_bonus', 'Rank bonus']]), new Map())
    expect(statement.positions.map((p) => [p.position_ref, p.total_minor])).toEqual([['A', '10010'], ['B', '25025'], ['C', '4965']])
    expect(statement.positions[0]!.bonuses.map((b) => [b.rule_key, b.rule_name, b.total_minor])).toEqual([['match', null, '10'], ['rank_bonus', 'Rank bonus', '10000']])
    expect(statement).toMatchObject({ person_total_minor: '40000', invariant: true })
  })

  test('AC-04.2: gross, withholding, clawback, adjustment and net are separate and net = gross - withheld - clawback + adjustment', () => {
    const lines = [line('A', '10000'), line('A', '-500', 'rank_bonus', 'late_transaction'), line('A', '300', 'manual_adjustment', 'manual')]
    const settlement = { gross_minor: '9800', netted_minor: '1500', withheld_minor: '200', net_payable_minor: '8100' }
    const statement = buildStatement(lines, settlement, new Map(), new Map())
    expect(statement.summary).toEqual({ gross_minor: '10000', adjustment_minor: '-200', clawback_minor: '1500', withheld_minor: '200', net_minor: '8100' })
    expect(statement.invariant).toBe(true)
    expect(statement.positions[0]!.bonuses[1]!.lines.map((l) => l.origin_kind)).toEqual(['none', 'refund'])
    expect(buildStatement(lines, { ...settlement, net_payable_minor: '8000' }, new Map(), new Map()).invariant).toBe(false)
    expect(buildStatement(lines, null, new Map(), new Map()).invariant).toBe(false)
  })

  test('origin kinds', () => {
    expect([originKind(null, 1n), originKind('late_transaction', 5n), originKind('late_transaction', -5n), originKind('clawback', -5n),
      originKind('manual', -5n), originKind('restatement', 5n)]).toEqual(['none', 'late_order', 'refund', 'refund', 'manual', 'restatement'])
  })
})
