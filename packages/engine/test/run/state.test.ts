// Pass 0 transitions (FR-PLN-008, TS-24) and the one-time key reaching the committed state (TS-25), end to end on G-E2E-01.
import { describe, expect, test } from 'vitest'
import { run } from '../../src/run.js'
import type { BonusRule, PlanVersion, QualificationStateRow, RunInput, TransitionRule } from '../../src/types.js'
import { loadFixture, type RunFixture } from '../fixtures/load.js'

const base = loadFixture<RunFixture>('g-e2e-01.json').cases[0]!.input
const row = (positionId: string, over: Partial<QualificationStateRow> = {}): QualificationStateRow => ({
  positionId, paidAs: [], titles: [], graceUsed: [], counters: [], carry: [], oneTimeFlags: [], banked: [], ...over,
})
function withState(plan: Partial<PlanVersion>, priorPlanVersionId: string, rows: readonly QualificationStateRow[]): RunInput {
  return {
    ...base,
    plan: { ...base.plan, ...plan },
    snapshot: { ...base.snapshot, priorState: { planVersionId: priorPlanVersionId, periodId: '2027-02', positions: rows } },
  }
}
const streak = { counters: [{ key: 'streak', incrementIf: { ladder: 'main', rank: 'R1' } }] }
const reset = (stateItem: string): TransitionRule => ({ stateItem, rule: 'reset', map: [], reason: 'new plan' })

describe('pass 0: transitions on the first run of a new plan version', () => {
  test('TS-24: streak 24 with rule carry is 25 after the first period; an unchanged value is not reported', () => {
    const out = run(withState({ ...streak, transitions: [{ stateItem: 'counter.*', rule: 'carry', map: [], reason: null }] }, 'plan-old', [row('A', { counters: [{ key: 'streak', value: 24 }] })]))
    expect(out.qualification.find((r) => r.positionId === 'A')!.counters).toEqual([{ key: 'streak', value: 25 }])
    expect(out.transitionReport).toEqual([])
  })

  test('map renames a title, reset clears an item; the report lists before and after', () => {
    const transitions: TransitionRule[] = [{ stateItem: 'title.main', rule: 'map', map: [{ from: 'Leader', to: 'R2' }], reason: null }, reset('counter.streak')]
    const out = run(withState({ ...streak, transitions }, 'plan-old', [row('C', { titles: [{ ladder: 'main', rank: 'Leader' }], counters: [{ key: 'streak', value: 7 }] })]))
    const c = out.qualification.find((r) => r.positionId === 'C')!
    expect(c.titles).toEqual([{ ladder: 'main', rank: 'R2' }]) // C is paid as R1 now; title keeps the mapped R2
    expect(c.counters).toEqual([{ key: 'streak', value: 1 }])
    expect(out.transitionReport).toEqual([
      { positionId: 'C', stateItem: 'title.main', rule: 'map', before: 'Leader', after: 'R2' },
      { positionId: 'C', stateItem: 'counter.streak', rule: 'reset', before: '7', after: '0' },
    ])
  })

  test('same plan version: no transition applies; an undeclared item on a version change is refused', () => {
    const prior = [row('A', { counters: [{ key: 'streak', value: 3 }] })]
    expect(run(withState({ ...streak, transitions: [reset('counter.streak')] }, base.plan.planVersionId, prior)).qualification.find((r) => r.positionId === 'A')!.counters).toEqual([{ key: 'streak', value: 4 }])
    expect(() => run(withState(streak, 'plan-old', prior))).toThrow(/no transition rule/)
    expect(() => run(withState({ transitions: [{ ...reset('counter.*'), reason: null }] }, 'plan-old', prior))).toThrow(/needs a reason/)
    expect(() => run(withState({}, 'plan-old', [row('Z')]))).toThrow(/not in the snapshot/)
  })
})

describe('TS-25: a one-time bonus is paid once per position ever', () => {
  const once: BonusRule = { key: 'welcome', kind: 'pay.one_time', sourceKind: 'other', reversalPolicy: 'restatement', eligibleIf: { ladder: 'main', rank: 'R2' }, amountMinor: 5000n, onceKey: 'welcome-r2' }
  const input: RunInput = { ...base, plan: { ...base.plan, bonuses: [...base.plan.bonuses, once] } }

  test('the paid key is in the committed state, and the next period does not pay it again', () => {
    const first = run(input)
    expect(first.lines.filter((l) => l.ruleKey === 'welcome').map((l) => l.payeePositionId)).toEqual(['A', 'B'])
    expect(first.qualification.filter((r) => r.oneTimeFlags.includes('welcome-r2')).map((r) => r.positionId)).toEqual(['A', 'B'])
    const next = run({ ...input, snapshot: { ...input.snapshot, priorState: { planVersionId: input.plan.planVersionId, periodId: '2027-03', positions: first.qualification } } })
    expect(next.lines.some((l) => l.ruleKey === 'welcome')).toBe(false)
    expect(next.qualification.filter((r) => r.oneTimeFlags.includes('welcome-r2')).map((r) => r.positionId)).toEqual(['A', 'B'])
  })
})
