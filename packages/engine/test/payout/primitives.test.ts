// TS-43/TS-44 single-source values plus hand-derived cases for generations, differential, flat/one-time,
// pool variants and the compact trace bound.
import { describe, expect, test } from 'vitest'
import { formatRate, roundRaw } from '../../src/money.js'
import { TRACE_SOURCE_LIMIT } from '../../src/pipeline.js'
import { differential } from '../../src/primitives/differential.js'
import { generations } from '../../src/primitives/generations.js'
import { matching } from '../../src/primitives/matching.js'
import { flat, oneTime } from '../../src/primitives/one-time.js'
import { override } from '../../src/primitives/override.js'
import { pool } from '../../src/primitives/pools.js'
import { percentByLevel } from '../../src/primitives/unilevel.js'
import type { BonusRule, Ladder, QualificationStateRow, RawLine } from '../../src/types.js'
import { loadFixture } from '../fixtures/load.js'
import { contextOf, doneOf, individualLine, rawOf, smallInput } from './context.js'

interface PrimitiveCase { readonly name: string; readonly measureMinor?: bigint; readonly matchedMinor?: bigint; readonly rate?: string; readonly ownRate?: string; readonly downlineRate?: string; readonly expected: { readonly amountMinor: bigint } }
const fixture = loadFixture<{ cases: readonly PrimitiveCase[] }>('payout-primitives.json').cases
const caseOf = (name: string): PrimitiveCase => fixture.find((c) => c.name === name)!
const common = { sourceKind: 'downline_volume', reversalPolicy: 'restatement', eligibleIf: null } as const
const amounts = (lines: readonly RawLine[]) => lines.map((l) => [l.payeePositionId, l.allocatedMinor ?? roundRaw(l.raw, 'half_up')])
const ladder = (...ranks: string[]): Ladder => ({ key: 'main', ranks: ranks.map((key) => ({ key, requires: [], maintenance: null })) })
const run = (volumes: Record<string, bigint>, edges: [string, string][], rule: BonusRule, ladders: Ladder[] = [], paidAs?: Record<string, string>) => {
  const ctx = contextOf(smallInput(volumes, edges, [rule], ladders))
  return { ctx, done: doneOf(ctx, paidAs ? { main: paidAs } : undefined) }
}

describe('TS-43 override and differential', () => {
  test('override 3% x 6,000.00 = 180.00', () => {
    const c = caseOf('ts43-override')
    const rule = { ...common, key: 'ovr', kind: 'pay.override', tree: 'sponsor', measure: 'v', rate: c.rate!, levels: 1 } as const
    const { ctx, done } = run({ D: c.measureMinor! }, [['P', 'D']], rule)
    expect(amounts(override(rule, ctx, done))).toEqual([['P', c.expected.amountMinor]])
  })

  test('override pays up to `levels` and a non-earner consumes its level', () => {
    const rule = { ...common, key: 'ovr', kind: 'pay.override', tree: 'sponsor', measure: 'v', rate: '0.1', levels: 2 } as const
    const { ctx, done } = run({ C: 1000n }, [['A', 'B'], ['B', 'X'], ['X', 'C']], rule)
    const xIndex = ctx.trees.sponsor.index.get('X')!
    const noX = { ...ctx, earner: ctx.earner.map((e, k) => (k === xIndex ? 0 : e)) }
    expect(amounts(override(rule, noX, done))).toEqual([['B', 100n]])
  })

  test('differential (21% - 15%) x 6,000.00 = 360.00; the source keeps its own rate', () => {
    const c = caseOf('ts43-differential')
    const rule = { ...common, key: 'diff', kind: 'pay.differential', tree: 'sponsor', measure: 'v', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: c.downlineRate! }, { rank: 'R2', rate: c.ownRate! }] } } as const
    const { ctx, done } = run({ D: c.measureMinor! }, [['P', 'D']], rule, [ladder('R1', 'R2')], { P: 'R2', D: 'R1' })
    const lines = differential(rule, ctx, done)
    expect(amounts(lines)).toEqual([['P', c.expected.amountMinor]])
    expect(lines[0]!.trace.sources[0]).toMatchObject({ positionId: 'D', level: 1, rate: '0.06' })
  })

  test('differential stairstep: each higher rank up the line earns only its gap; equal ranks earn nothing', () => {
    const rule = { ...common, key: 'diff', kind: 'pay.differential', tree: 'sponsor', measure: 'v', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.05' }, { rank: 'R3', rate: '0.12' }] } } as const
    // S (none) -> A (R1) -> B (R2: inherits R1's 5%) -> C (R3) -> D (R3)
    const { ctx, done } = run({ S: 10000n }, [['D', 'C'], ['C', 'B'], ['B', 'A'], ['A', 'S']], rule, [ladder('R1', 'R2', 'R3')], { A: 'R1', B: 'R2', C: 'R3', D: 'R3' })
    expect(amounts(differential(rule, ctx, done))).toEqual([['A', 500n], ['C', 700n]])
  })

  test('formatRate prints canonical decimals', () => {
    expect([60000n, 1000000n, 1500000n, 1n].map(formatRate)).toEqual(['0.06', '1', '1.5', '0.000001'])
  })
})

describe('TS-44 matching', () => {
  test.each(['ts44-matching-small', 'ts44-matching-large'])('%s', (name) => {
    const c = caseOf(name)
    const rule = { ...common, sourceKind: 'match', key: 'match', kind: 'pay.matching', tree: 'sponsor', of: ['rb'], rates: [c.rate!] } as const
    const rb = { ...common, key: 'rb', kind: 'pay.flat', amountMinor: 1n } as const
    const ctx = contextOf(smallInput({}, [['P', 'D']], [rb, rule]))
    expect(amounts(matching(rule, ctx, { ...doneOf(ctx), individual: [individualLine('D', 'rb', c.matchedMinor!)] }))).toEqual([['P', c.expected.amountMinor]])
  })

  test('never matches a reversed (non-positive) line; refuses to match a non-pass-4 bonus', () => {
    const rule = { ...common, sourceKind: 'match', key: 'match', kind: 'pay.matching', tree: 'sponsor', of: ['rb'], rates: ['0.5'] } as const
    const rb = { ...common, key: 'rb', kind: 'pay.flat', amountMinor: 1n } as const
    const ctx = contextOf(smallInput({}, [['P', 'D']], [rb, rule]))
    expect(matching(rule, ctx, { ...doneOf(ctx), individual: [individualLine('D', 'rb', -500n)] })).toEqual([])
    expect(() => matching({ ...rule, of: ['match'] }, ctx, doneOf(ctx))).toThrow('INVALID_INPUT')
  })
})

describe('pay.generations', () => {
  test('generation volume stops at the next leader; non-leaders never consume a generation', () => {
    // A(L) -> b -> C(L) -> d -> E(L); generation volume C = C + d = 300, E = 400
    const rule = { ...common, key: 'gen', kind: 'pay.generations', tree: 'sponsor', measure: 'v', leader: { ladder: 'main', rank: 'L' }, rates: ['0.1', '0.05'] } as const
    const { ctx, done } = run({ A: 100n, b: 50n, C: 100n, d: 200n, E: 400n }, [['A', 'b'], ['b', 'C'], ['C', 'd'], ['d', 'E']], rule, [ladder('L')], { A: 'L', C: 'L', E: 'L' })
    const lines = generations(rule, ctx, done)
    expect(lines.map((l) => [l.payeePositionId, l.raw])).toEqual([['A', rawOf(300n, '0.1') + rawOf(400n, '0.05')], ['C', rawOf(400n, '0.1')]])
    expect(lines[0]!.trace.sources.map((s) => [s.positionId, s.level, s.base, s.orders])).toEqual([['C', 1, 300n, []], ['E', 2, 400n, []]])
    expect(lines[0]!.trace.rankEvaluated).toEqual([{ ladder: 'main', rank: 'L' }])
  })
})

describe('pay.flat and pay.one_time', () => {
  test('flat pays every eligible earner; one_time skips positions whose prior state holds the once key (TS-25)', () => {
    const fl = { ...common, key: 'flat', kind: 'pay.flat', amountMinor: 2500n, eligibleIf: { ladder: 'main', rank: 'R1' } } as const
    const once = { ...common, key: 'once', kind: 'pay.one_time', amountMinor: 10000n, onceKey: 'rank-R1' } as const
    const { ctx, done } = run({}, [['A', 'B'], ['A', 'C']], fl, [ladder('R1')], { A: 'R1', B: 'R1' })
    expect(amounts(flat(fl, ctx, done))).toEqual([['A', 2500n], ['B', 2500n]])
    const row = (positionId: string, flags: string[]): QualificationStateRow => ({ positionId, paidAs: [], titles: [], graceUsed: [], counters: [], carry: [], oneTimeFlags: flags, banked: [] })
    const prior = [row('A', ['rank-R1']), null, row('C', ['other'])]
    expect(amounts(oneTime(once, ctx, { ...done, transition: { prior, report: [] } }))).toEqual([['B', 10000n], ['C', 10000n]])
    expect(flat(fl, ctx, done)[0]!.trace).toMatchObject({ tree: null, sources: [{ positionId: null, level: null, rate: null, raw: 2500n * 10n ** 12n }] })
  })
})

describe('pay.pool allocations', () => {
  const plan = (allocation: Extract<BonusRule, { kind: 'pay.pool' }>['allocation']) => ({ ...common, sourceKind: 'pool', key: 'pool', kind: 'pay.pool', baseMeasure: 'v', rate: '0.1', allocation }) as const
  const volumes = { A: 400n, B: 300n, C: 200n, D: 100n }
  const edges: [string, string][] = [['A', 'B'], ['A', 'C'], ['A', 'D']]

  test('rank_order: each part split equally among holders of exactly that rank; a part without holders is not paid', () => {
    // pool = 10% x 1,000 = 100; R1 30% -> C, D (15 each); R2 50% -> A, B (25 each); R3 20% -> nobody
    const rule = plan({ type: 'rank_order', ladder: 'main', parts: [{ rank: 'R1', share: '0.3' }, { rank: 'R2', share: '0.5' }, { rank: 'R3', share: '0.2' }] })
    const { ctx, done } = run(volumes, edges, rule, [ladder('R1', 'R2', 'R3')], { A: 'R2', B: 'R2', C: 'R1', D: 'R1' })
    expect(amounts(pool(rule, ctx, done))).toEqual([['A', 25n], ['B', 25n], ['C', 15n], ['D', 15n]])
  })

  test('first_n: top n by measure desc, split by largest remainder (ties to the lower position id)', () => {
    const rule = plan({ type: 'first_n', n: 3, orderBy: 'v' })
    const { ctx, done } = run(volumes, edges, rule)
    const lines = pool(rule, ctx, done)
    expect(amounts(lines)).toEqual([['A', 34n], ['B', 33n], ['C', 33n]])
    expect(lines[0]!.trace.steps).toEqual([{ step: 'allocation', key: 'pool', weight: 1n, totalMinor: 100n, afterMinor: 34n }])
  })
})

describe('compact trace (FR-COMP-007)', () => {
  const wide = Array.from({ length: TRACE_SOURCE_LIMIT + 4 }, (_, i) => `C${String(i).padStart(2, '0')}`)
  const rule = { ...common, reversalPolicy: 'order_line', key: 'uni', kind: 'pay.percent_by_level', tree: 'sponsor', measure: 'v', levels: ['0.1'], compression: 'none' } as const
  const input = smallInput(Object.fromEntries(wide.map((id) => [id, 100n])), wide.map((id) => ['P', id] as [string, string]), [rule])

  test(`keeps the first ${TRACE_SOURCE_LIMIT} sources by position id and sums the rest into omitted`, () => {
    const ctx = contextOf(input)
    const [line] = percentByLevel(rule, ctx, doneOf(ctx))
    expect(line!.trace.sources.map((s) => s.positionId)).toEqual(wide.slice(0, TRACE_SOURCE_LIMIT))
    expect(line!.trace.omitted).toEqual({ count: 4, raw: 4n * rawOf(100n, '0.1') })
    expect(line!.trace.sources.reduce((a, s) => a + s.raw, line!.trace.omitted.raw)).toBe(line!.raw)
  })

  test('options.fullTraceFor keeps every source', () => {
    const ctx = contextOf(input, [{ payeePositionId: 'P', ruleKey: 'uni' }])
    const [line] = percentByLevel(rule, ctx, doneOf(ctx))
    expect(line!.trace.sources.map((s) => s.positionId)).toEqual(wide)
    expect(line!.trace.omitted).toEqual({ count: 0, raw: 0n })
  })

  test('results do not depend on the order of input rows (determinism)', () => {
    const shuffled = { ...input, snapshot: { ...input.snapshot, orders: input.snapshot.orders.toReversed(), relationships: input.snapshot.relationships.toReversed(), positions: input.snapshot.positions.toReversed() } }
    const a = contextOf(input)
    const b = contextOf(shuffled)
    expect(percentByLevel(rule, b, doneOf(b))).toEqual(percentByLevel(rule, a, doneOf(a)))
  })

  test('a non-earner is never a payee; an unknown measure fails loudly', () => {
    const ctx = contextOf(input)
    const noP = { ...ctx, earner: ctx.earner.map((e, k) => (ctx.trees.sponsor.ids[k] === 'P' ? 0 : e)) }
    expect(percentByLevel(rule, noP, doneOf(ctx))).toEqual([])
    expect(() => percentByLevel({ ...rule, measure: 'nope' }, ctx, doneOf(ctx))).toThrow('INVALID_INPUT')
  })
})
