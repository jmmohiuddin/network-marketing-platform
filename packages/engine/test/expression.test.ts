// T-B3-08: tier-2 expression type checker, bounds and exact evaluation (E-ADR-41/42, FR-PLN-003); AC-PLN3-1/3;
// AC-COMP12-1 half_even rounding in a run (FR-COMP-012).
import { describe, expect, test } from 'vitest'
import { EngineError } from '../src/errors.js'
import { checkExpression, renderExpression } from '../src/expression.js'
import { roundRaw, RAW_SCALE } from '../src/money.js'
import { run } from '../src/run.js'
import type { Expr, PlanVersion, RunInput } from '../src/types.js'
import { loadFixture, type RunFixture } from './fixtures/load.js'

const ts01 = (): RunInput => loadFixture<RunFixture>('ts01-unilevel.json').cases[0]!.input
const codes = (value: unknown, want: 'num' | 'bool' = 'num'): string[] => checkExpression(value, want, 'expr').map((i) => i.code)

/** A left-leaning add chain with n leaves: 2n - 1 nodes, depth n. */
const chain = (n: number): unknown => (n === 1 ? { const: '1' } : { op: 'add', args: [chain(n - 1), { const: '1' }] })
/** A wide add with n leaves: n + 1 nodes, depth 2. */
const wide = (n: number): unknown => ({ op: 'add', args: Array.from({ length: n }, () => ({ measure: 'pv' })) })

describe('expression checker (AC-PLN3-1)', () => {
  test('a condition inside arithmetic is a type error; the fact leaf is refused while no fact store exists', () => {
    expect(codes({ op: 'add', args: [{ measure: 'pv' }, { fact: 'x', equals: 'y' }] })).toEqual(['PROFILE_FACTS_UNAVAILABLE', 'EXPRESSION_TYPE'])
  })

  test('65 nodes or depth 17 exceed the evaluation bound; 64 nodes and depth 16 pass', () => {
    expect(codes(wide(63))).toEqual([])
    expect(codes(wide(64))).toEqual(['EXPRESSION_TOO_LARGE'])
    expect(codes(chain(16))).toEqual([])
    expect(codes(chain(17))).toEqual(['EXPRESSION_TOO_LARGE'])
  })

  test('shapes, arity and result types', () => {
    expect(codes({ measure: 'pv' }, 'bool')).toEqual(['EXPRESSION_TYPE'])
    expect(codes({ op: 'gte', args: [{ measure: 'pv' }, { const: '100' }] }, 'bool')).toEqual([])
    expect(codes({ op: 'not', args: [{ measure: 'pv' }] }, 'bool')).toEqual(['EXPRESSION_TYPE'])
    expect(codes({ op: 'if', args: [{ measure: 'pv' }, { const: '1' }, { const: '2' }] })).toEqual(['EXPRESSION_TYPE'])
    expect(codes({ op: 'sub', args: [{ const: '1' }] })).toEqual(['EXPRESSION_INVALID'])
    expect(codes({ const: 1 })).toEqual(['EXPRESSION_INVALID'])
    expect(codes({ const: '-1' })).toEqual(['EXPRESSION_INVALID'])
    expect(codes({ state: 'banked.x' })).toEqual(['EXPRESSION_INVALID'])
    expect(codes({ measure: 'pv', extra: 1 })).toEqual(['EXPRESSION_INVALID'])
    expect(codes({ agg: 'sum', of: 'pv', tree: 'sponsor', atLeastMinor: '1' })).toEqual(['EXPRESSION_INVALID'])
    expect(codes({ agg: 'count', of: 'pv', tree: 'sponsor', atLeastMinor: '1' })).toEqual([])
  })

  test('renders verbatim plain text', () => {
    const e: Expr = { op: 'min', args: [{ measure: 'pv' }, { const: '50000' }] }
    expect(renderExpression(e)).toBe('min(pv, 50000)')
    expect(renderExpression({ op: 'add', args: [{ state: 'carry.k' }, { const: '1' }] })).toBe('(prior-period carry.k + 1)')
  })
})

function derivedPlan(base: PlanVersion, extra: Partial<PlanVersion>): PlanVersion {
  return { ...base, ...extra }
}

describe('derived measures and expression requirements in a run (AC-PLN3-3, E-ADR-42)', () => {
  const input = ts01()
  const cv = input.plan.measures[0]!
  const plan = derivedPlan(input.plan, {
    measures: [
      cv,
      { kind: 'measure.derived', key: 'capped', expr: { op: 'min', args: [{ measure: 'cv' }, { const: '50000' }] } },
      { kind: 'measure.derived', key: 'prior_k', expr: { op: 'add', args: [{ state: 'carry.k' }, { const: '0.5' }] } },
      { kind: 'measure.derived', key: 'third', expr: { op: 'mul', args: [{ op: 'div', args: [{ measure: 'cv' }, { const: '3' }] }, { const: '3' }] } },
    ],
    ladders: [{ key: 'main', ranks: [{ key: 'R1', requires: [{ kind: 'expression', expr: { op: 'gte', args: [{ measure: 'capped' }, { const: '10000' }] } }], maintenance: null }] }],
    carries: [{ key: 'k', measure: 'cv', capMinor: null, keepIf: null, expiresAfterPeriods: null }],
  })
  const priorRow = { positionId: 'L1', paidAs: [{ ladder: 'main', rank: null }], titles: [{ ladder: 'main', rank: null }], graceUsed: [{ ladder: 'main', periods: 0 }], counters: [], carry: [{ key: 'k', amountMinor: 777n, periodsHeld: 1 }], oneTimeFlags: [], banked: [] }
  const out = run({ ...input, plan, snapshot: { ...input.snapshot, priorState: { planVersionId: plan.planVersionId, periodId: '2027-02', positions: [priorRow] } } })
  const value = (pos: string, m: string): bigint | undefined => out.volumeSummaries.find((s) => s.positionId === pos)?.measures.find((x) => x.measure === m)?.valueMinor

  test('capped = min(cv, 500.00): exact per position', () => {
    expect([value('P0', 'capped'), value('L1', 'capped'), value('L5', 'capped')]).toEqual([0n, 50000n, 50000n])
  })

  test('requirement capped >= 100.00 holds for every position with volume', () => {
    expect(Object.fromEntries(out.volumeSummaries.map((s) => [s.positionId, s.paidAs[0]!.rank]))).toEqual({ P0: null, L1: 'R1', L2: 'R1', L3: 'R1', L4: 'R1', L5: 'R1' })
  })

  test('the state leaf reads the prior carry; one half-up rounding per derived value', () => {
    expect(value('L1', 'prior_k')).toBe(778n) // 777 + 0.5 -> 778
    expect(value('L2', 'prior_k')).toBe(1n) // no prior row: 0 + 0.5 -> 1
  })

  test('arithmetic is exact rational: (cv / 3) x 3 = cv', () => {
    expect(value('L2', 'third')).toBe(250000n)
  })

  test('division by zero fails the run naming the rule and the position', () => {
    const zero = derivedPlan(input.plan, { measures: [cv, { kind: 'measure.derived', key: 'ratio', expr: { op: 'div', args: [{ const: '1' }, { measure: 'cv' }] } }] })
    let error: unknown = null
    try {
      run({ ...input, plan: zero })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(EngineError)
    expect(error).toMatchObject({ code: 'INVALID_INPUT', details: { rule: 'ratio', positionId: 'P0' } })
  })
})

describe('half_even (AC-COMP12-1, FR-COMP-012)', () => {
  test('roundRaw: ties to even, both signs; other values as half_up', () => {
    const half = RAW_SCALE / 2n
    expect(roundRaw(12n * RAW_SCALE + half, 'half_even')).toBe(12n)
    expect(roundRaw(13n * RAW_SCALE + half, 'half_even')).toBe(14n)
    expect(roundRaw(-(12n * RAW_SCALE + half), 'half_even')).toBe(-12n)
    expect(roundRaw(-(13n * RAW_SCALE + half), 'half_even')).toBe(-14n)
    expect(roundRaw(12n * RAW_SCALE + half + 1n, 'half_even')).toBe(13n)
    expect(roundRaw(12n * RAW_SCALE + half, 'half_up')).toBe(13n)
  })

  test('a run under half_even pays 0.125 as 0.12 and 0.135 as 0.14', () => {
    const input = ts01()
    const at = (cvMinor: bigint, mode: 'half_up' | 'half_even'): bigint => {
      const order = input.snapshot.orders.find((o) => o.orderId === 'o-L1')!
      const line = { ...order.lines[0]!, volumes: [{ name: 'cv', perUnitMinor: cvMinor }] }
      const bonus = { ...input.plan.bonuses[0]!, levels: ['0.5'] } as PlanVersion['bonuses'][number]
      const out = run({
        ...input,
        settings: { ...input.settings, roundingMode: mode },
        plan: { ...input.plan, bonuses: [bonus] },
        snapshot: { ...input.snapshot, orders: [{ ...order, lines: [line] }] },
      })
      return out.lines.find((l) => l.payeePositionId === 'P0')!.amountMinor
    }
    expect([at(25n, 'half_even'), at(27n, 'half_even'), at(25n, 'half_up')]).toEqual([12n, 14n, 13n])
  })
})
