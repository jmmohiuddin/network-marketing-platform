// Golden values of the payout primitives (ENGINE_GENEALOGY §8): TS-01, TS-02, TS-06, TS-12, G-E2E-01 (retail, unilevel, rank bonus and matching pre-cap).
import { describe, expect, test } from 'vitest'
import { roundRaw } from '../../src/money.js'
import type { BonusOf } from '../../src/pipeline.js'
import { fastStart } from '../../src/primitives/fast-start.js'
import { matching } from '../../src/primitives/matching.js'
import { percentOfMeasure } from '../../src/primitives/percent-of-measure.js'
import { pool } from '../../src/primitives/pools.js'
import { retailMargin } from '../../src/primitives/retail.js'
import { percentByLevel } from '../../src/primitives/unilevel.js'
import type { BonusKind, RawLine } from '../../src/types.js'
import { loadFixture, type RunCase, type RunFixture } from '../fixtures/load.js'
import { contextOf, doneOf, individualLine } from './context.js'

const cases = (file: string): readonly RunCase[] => loadFixture<RunFixture>(file).cases
const rule = <K extends BonusKind>(c: RunCase, key: string): BonusOf<K> => c.input.plan.bonuses.find((b) => b.key === key) as BonusOf<K>
const amounts = (lines: readonly RawLine[]) =>
  lines.map((l) => ({ payeePositionId: l.payeePositionId, ruleKey: l.ruleKey, amountMinor: l.allocatedMinor ?? roundRaw(l.raw, 'half_up') })).filter((l) => l.amountMinor !== 0n)
/** Expected lines of one rule in output order (payee position id asc). */
const expectedFor = (c: RunCase, key: string) => (c.expected.lines ?? []).filter((l) => l.ruleKey === key).toSorted((a, b) => (a.payeePositionId < b.payeePositionId ? -1 : 1))
const lineOf = (lines: readonly RawLine[], id: string): RawLine => lines.find((l) => l.payeePositionId === id)!

describe('pay.percent_by_level', () => {
  test('TS-01: unilevel 8/5/4/4/4 over a 5-level chain; P0 = 925.00', () => {
    const [c] = cases('ts01-unilevel.json')
    const ctx = contextOf(c!.input)
    const lines = percentByLevel(rule(c!, 'unilevel'), ctx, doneOf(ctx))
    expect(amounts(lines)).toEqual(expectedFor(c!, 'unilevel'))
    expect(lineOf(lines, 'P0')).toMatchObject({ pass: 4, unit: 'currency', reversalPolicy: 'order_line', allocatedMinor: null })
    expect(roundRaw(lineOf(lines, 'P0').raw, 'half_up')).toBe(92500n)
    expect(lineOf(lines, 'P0').trace.sources.map((s) => roundRaw(s.raw, 'half_up'))).toEqual([8000n, 12500n, 16000n, 24000n, 32000n]) // per level 80, 125, 160, 240, 320
  })

  test.each(cases('ts02-compression.json'))('TS-02 $name: P0 800.00 without compression, 1,040.00 dynamic', (c) => {
    const ctx = contextOf(c.input)
    const lines = percentByLevel(rule(c, 'unilevel'), ctx, doneOf(ctx))
    expect(amounts(lines)).toEqual(expectedFor(c, 'unilevel'))
    const p0 = lineOf(lines, 'P0')
    expect(p0.trace.sources.map((s) => [s.positionId, s.level])).toEqual(
      c.name === 'ts02-dynamic' ? [['L1', 1], ['L3', 2], ['L4', 3], ['L5', 4], ['L6', 5]] : [['L1', 1], ['L3', 3], ['L4', 4], ['L5', 5]],
    )
    expect(p0.trace.sources.find((s) => s.positionId === 'L3')!.compressedOver).toEqual(c.name === 'ts02-dynamic' ? ['L2'] : [])
  })

  test('TS-01/02: order_line sources cite their order ids; the trace reconciles to raw', () => {
    const [c] = cases('ts01-unilevel.json')
    const ctx = contextOf(c!.input)
    const p0 = lineOf(percentByLevel(rule(c!, 'unilevel'), ctx, doneOf(ctx)), 'P0')
    expect(p0.trace.sources.map((s) => s.orders.map((o) => o.orderId))).toEqual([['o-L1'], ['o-L2'], ['o-L3'], ['o-L4'], ['o-L5']])
    expect(p0.trace.sources.every((s) => s.orders.reduce((a, o) => a + o.raw, 0n) === s.raw)).toBe(true)
    expect(p0.trace.sources.reduce((a, s) => a + s.raw, p0.trace.omitted.raw)).toBe(p0.raw)
    expect(p0.trace).toMatchObject({ rule: 'unilevel', pass: 4, planVersionId: 'plan-ts01', tree: { kind: 'sponsor' }, rankEvaluated: [] })
  })

  test('G-E2E-01: unilevel 8% L1 / 5% L2 on PV: A 78.50, B 36.00', () => {
    const [c] = cases('g-e2e-01.json')
    const ctx = contextOf(c!.input)
    expect(amounts(percentByLevel(rule(c!, 'unilevel'), ctx, doneOf(ctx)))).toEqual(expectedFor(c!, 'unilevel'))
  })
})

describe('pay.retail_margin and pay.percent_of_measure', () => {
  test('G-E2E-01: retail 25% of customer orders: B 100.00, D 37.50; order_line cites the orders', () => {
    const [c] = cases('g-e2e-01.json')
    const ctx = contextOf(c!.input)
    const lines = retailMargin(rule(c!, 'retail'), ctx, doneOf(ctx))
    expect(amounts(lines)).toEqual(expectedFor(c!, 'retail'))
    expect(lines.every((l) => l.trace.sources.length === 1 && l.trace.sources[0]!.orders.length > 0)).toBe(true)
  })

  test('G-E2E-01: rank bonus 10% (R2) / 5% (R1) of GV before the cap: A 125.00, B 105.00, C 5.00, D 22.50', () => {
    const [c] = cases('g-e2e-01.json')
    const ctx = contextOf(c!.input)
    const lines = percentOfMeasure(rule(c!, 'rank_bonus'), ctx, doneOf(ctx))
    expect(amounts(lines).map((l) => [l.payeePositionId, l.amountMinor])).toEqual([['A', 12500n], ['B', 10500n], ['C', 500n], ['D', 2250n]])
    expect(lines.map((l) => l.trace.sources[0]!.rate)).toEqual(['0.1', '0.1', '0.05', '0.05'])
    expect(lines[0]!.trace.rankEvaluated).toEqual([{ ladder: 'main', rank: 'R2' }])
  })
})

describe('pay.matching', () => {
  test('G-E2E-01: 20% of personally sponsored rank bonus before the cap: A 22.00, B 4.50', () => {
    const [c] = cases('g-e2e-01.json')
    const ctx = contextOf(c!.input)
    const rankBonus = [individualLine('A', 'rank_bonus', 12500n), individualLine('B', 'rank_bonus', 10500n), individualLine('C', 'rank_bonus', 500n), individualLine('D', 'rank_bonus', 2250n)]
    const lines = matching(rule(c!, 'match'), ctx, { ...doneOf(ctx), individual: rankBonus })
    expect(amounts(lines)).toEqual([
      { payeePositionId: 'A', ruleKey: 'match', amountMinor: 2200n },
      { payeePositionId: 'B', ruleKey: 'match', amountMinor: 450n },
    ])
    expect(lines[0]!.trace.sources.map((s) => [s.positionId, s.ruleKey, s.baseScale])).toEqual([['B', 'rank_bonus', 'raw'], ['C', 'rank_bonus', 'raw']])
    expect(lines[0]!.pass).toBe(5)
  })
})

describe('pay.pool', () => {
  test('TS-06: 6.25% of 1,000,000.00 over 66 shares by largest remainder sums to exactly 62,500.00', () => {
    const [c] = cases('ts06-pool.json')
    const ctx = contextOf(c!.input)
    const lines = pool(rule(c!, 'pool'), ctx, doneOf(ctx))
    expect(amounts(lines)).toEqual(expectedFor(c!, 'pool'))
    expect(lines.reduce((a, l) => a + l.allocatedMinor!, 0n)).toBe(6250000n)
    const weights = lines.map((l) => (l.trace.steps[0]!.step === 'allocation' ? l.trace.steps[0]!.weight : 0n))
    const shares = weights.reduce((a, w) => a + w, 0n)
    expect(weights.reduce((a, w) => a + roundRaw((6250000n * w * 10n ** 12n) / shares, 'half_up'), 0n)).toBe(6250002n) // naive per-line rounding: 62,500.02
    expect(lines.every((l) => l.pass === 6 && l.trace.steps.length === 1 && l.trace.steps[0]!.step === 'allocation')).toBe(true)
  })
})

describe('pay.fast_start', () => {
  test('TS-12: order 1,200.00 of a new enrollee: sponsor 240 -> 200.00, upline 120 -> 80.00', () => {
    const [c] = cases('ts12-fast-start.json')
    const ctx = contextOf(c!.input)
    const lines = fastStart(rule(c!, 'fast_start'), ctx, doneOf(ctx))
    expect(amounts(lines)).toEqual(expectedFor(c!, 'fast_start'))
    expect(lines.map((l) => l.trace.sources.map((s) => [s.positionId, s.level, s.orders.map((o) => o.orderId), s.capMinor]))).toEqual([[['X', 1, ['o-X'], 20000n]], [['X', 2, ['o-X'], 8000n]]])
  })

  test('TS-12: an order credited after the enrolment window pays nothing', () => {
    const [c] = cases('ts12-fast-start.json')
    const r = rule<'pay.fast_start'>(c!, 'fast_start')
    const ctx = contextOf(c!.input)
    expect(fastStart({ ...r, buyerEnrolledWithinUs: 86_400_000_000n }, ctx, doneOf(ctx))).toEqual([])
  })
})
