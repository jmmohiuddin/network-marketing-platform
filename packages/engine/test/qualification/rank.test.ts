// Pass 3 (qualificationPass): paid-as vs title, windows, leg rules, qualified legs, profile facts, other ladders,
// maintenance + grace, counters, carry (BR-RNK-05..09, TS-05, TS-24, TS-63).
import { describe, expect, test } from 'vitest'
import { EngineError } from '../../src/errors.js'
import { holdsRank } from '../../src/pipeline.js'
import { carryForward, qualificationPass } from '../../src/primitives/rank.js'
import type { Ladder, Requirement, RunInput } from '../../src/types.js'
import { loadFixture, type RunFixture } from '../fixtures/load.js'
import { contextOf, doneOf, golden, inputOf, type RankCase } from './harness.js'

const runCase = (c: RankCase, input: RunInput = inputOf(c)) => {
  const ctx = contextOf(input)
  return { ctx, out: qualificationPass(ctx, doneOf(ctx, c)) }
}
const caseNamed = (name: string): RankCase => golden.find((c) => c.name === name)!
const req = (measure: string, atLeast: bigint, over: Partial<Extract<Requirement, { kind: 'measure' }>> = {}): Requirement =>
  ({ kind: 'measure', measure, atLeastMinor: atLeast, window: { type: 'period' }, maxPerLegShare: null, ...over })
const ladder = (key: string, ...requires: Requirement[][]): Ladder => ({ key, ranks: requires.map((r, i) => ({ key: `R${i + 1}`, requires: r, maintenance: null })) })
const withLadders = (c: RankCase, ladders: readonly Ladder[]): RankCase => ({ ...c, ladders })
const failure = (f: () => unknown): string => {
  try {
    f()
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError)
    return (e as EngineError).message
  }
  throw new Error('expected an EngineError')
}

describe('qualificationPass: golden rank cases (test/qualification/rank-golden.json)', () => {
  test.each(golden.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const { out } = runCase(c)
    for (const row of c.expected.state) expect(out.state.find((s) => s.positionId === row.positionId), row.positionId).toMatchObject(row)
    for (const ev of c.expected.evaluations ?? []) {
      expect(out.evaluations.find((e) => e.positionId === ev.positionId && e.ladder === ev.ladder), `${ev.positionId}/${ev.ladder}`).toMatchObject(ev)
    }
    expect(out.warnings).toEqual([])
  })

  test('paid-as and titles are rank indexes per ladder (-1 = none) and feed holdsRank', () => {
    const { ctx, out } = runCase(caseNamed('ts63-two-ladders-rolling-title'))
    expect([...out.paidAs.get('main')!]).toEqual([1, 0]) // A R2, B R1
    expect([...out.titles.get('main')!]).toEqual([1, 1]) // B title R2 above its paid-as
    expect([...out.paidAs.get('leader')!]).toEqual([0, -1])
    const r2 = holdsRank(ctx, out, { ladder: 'main', rank: 'R2' })
    expect([r2(0), r2(1)]).toEqual([true, false])
  })

  test('one state row per position (position index order) and one evaluation per position and ladder', () => {
    const { out } = runCase(caseNamed('qualified-legs-bottom-up'))
    expect(out.state.map((s) => s.positionId)).toEqual(['P', 'Q', 'S', 'T', 'T2', 'U', 'U1', 'V'])
    expect(out.evaluations.map((e) => `${e.positionId}/${e.ladder}`).slice(0, 4)).toEqual(['P/main', 'P/exec', 'Q/main', 'Q/exec'])
    expect(out.evaluations).toHaveLength(16)
  })

  test('deterministic: shuffled snapshot arrays give the same state and evaluations', () => {
    const c = caseNamed('qualified-legs-bottom-up')
    const input = inputOf(c)
    const shuffled: RunInput = {
      ...input,
      snapshot: { ...input.snapshot, positions: [...input.snapshot.positions].reverse(), relationships: [...input.snapshot.relationships].reverse(), participants: [...input.snapshot.participants].reverse() },
    }
    const a = runCase(c).out
    const b = runCase(c, shuffled).out
    expect(b.state).toEqual(a.state)
    expect(b.evaluations).toEqual(a.evaluations)
  })
})

describe('qualificationPass: G-E2E-01 ranks', () => {
  test('A R2, B R2, C R1, D R1 from the expected PV/GV', () => {
    const c = loadFixture<RunFixture>('g-e2e-01.json').cases[0]!
    const ctx = contextOf(c.input)
    const values = c.expected.positions!.flatMap((p) => p.measures.map((m) => ({ measure: m.measure, positionId: p.positionId, valueMinor: m.valueMinor })))
    const out = qualificationPass(ctx, doneOf(ctx, { values }))
    expect(out.state.map((s) => ({ positionId: s.positionId, paidAs: s.paidAs }))).toEqual(c.expected.positions!.map((p) => ({ positionId: p.positionId, paidAs: p.paidAs })))
  })
})

describe('qualificationPass: windows and leg rule edges', () => {
  test('rolling window longer than the history: sums what exists and warns', () => {
    const c = caseNamed('ts63-two-ladders-rolling-title')
    const { out } = runCase({ ...c, history: c.history!.slice(0, 1) })
    expect(out.evaluations.find((e) => e.positionId === 'A' && e.ladder === 'main')!.checked[0]!.valueMinor).toBe(50000n)
    expect(out.warnings).toEqual([expect.objectContaining({ code: 'ROLLING_WINDOW_SHORT', ref: 'pv' })])
  })

  test('history out of order or overlapping the period is refused', () => {
    const c = caseNamed('ts63-two-ladders-rolling-title')
    const h = c.history!
    expect(failure(() => runCase({ ...c, history: [h[1]!, h[0]!, h[2]!] }))).toMatch(/most recent first/)
    expect(failure(() => runCase({ ...c, history: [{ ...h[0]!, endsAtUs: h[0]!.endsAtUs + 1n }] }))).toMatch(/most recent first/)
  })

  test('leg cap is exact: three legs of 0.40 under a 33.3333% cap of 1.00 reach 0.999999, not 1.00', () => {
    const c: RankCase = {
      ...caseNamed('leg-rule'),
      ladders: [ladder('main', [req('gv', 100n, { maxPerLegShare: '0.333333' })])],
      positions: [{ positionId: 'R', sponsor: null }, { positionId: 'a', sponsor: 'R' }, { positionId: 'b', sponsor: 'R' }, { positionId: 'c', sponsor: 'R' }],
      values: [{ measure: 'pv', positionId: 'a', valueMinor: 40n }, { measure: 'pv', positionId: 'b', valueMinor: 40n }, { measure: 'pv', positionId: 'c', valueMinor: 40n }],
    }
    const { out } = runCase(c)
    expect(out.evaluations[0]).toMatchObject({ positionId: 'R', paidAs: null, checked: [{ valueMinor: 99n, met: false }] })
  })

  test('volume.enrolled_group leg rule counts each sponsored position once', () => {
    const base = caseNamed('leg-rule')
    const c: RankCase = {
      ...base,
      measures: [base.measures[0]!, { kind: 'volume.enrolled_group', key: 'eg', of: 'pv', includeSelf: true }],
      ladders: [ladder('main', [req('eg', 60000n, { maxPerLegShare: '0.5' })])],
      values: base.values.filter((v) => v.measure === 'pv'),
    }
    // W: 100 + min(450, 300) x 2 = 700.00; X: 100 + min(800, 300) + 200 = 600.00; Y: 800 own, no legs; U, V, Z below 600.00
    const { out } = runCase(c)
    expect(out.state.filter((s) => s.paidAs[0]!.rank === 'R1').map((s) => s.positionId)).toEqual(['W', 'X', 'Y'])
  })
})

describe('qualificationPass: refused plans and state', () => {
  const c = caseNamed('ts63-two-ladders-rolling-title')
  const main = c.ladders[0]!
  test.each([
    ['a requirement on a later ladder', [{ ...main, ranks: [{ key: 'R1', requires: [{ kind: 'rank', rank: { ladder: 'leader', rank: 'L1' } }], maintenance: null }] }, c.ladders[1]!], /earlier ladder/],
    ['a rank requirement on its own ladder', [ladder('main', [], [{ kind: 'rank', rank: { ladder: 'main', rank: 'R1' } }])], /earlier ladder/],
    ['an unknown rank', [ladder('main', [{ kind: 'legs', tree: 'sponsor', count: 1, rank: { ladder: 'main', rank: 'R9' } }])], /unknown rank/],
    ['own legs in two trees', [ladder('main', [], [{ kind: 'legs', tree: 'sponsor', count: 1, rank: { ladder: 'main', rank: 'R1' } }, { kind: 'legs', tree: 'placement', count: 1, rank: { ladder: 'main', rank: 'R1' } }])], /one tree/],
    ['a leg rule on a personal measure', [ladder('main', [req('pv', 1n, { maxPerLegShare: '0.5' })])], /leg rule needs/],
    ['an unknown measure', [ladder('main', [req('nope', 1n)])], /unknown measure/],
    ['a zero-period rolling window', [ladder('main', [req('pv', 1n, { window: { type: 'rolling', periods: 0 } })])], /whole number/],
    ['duplicate ladders', [main, main], /duplicate ladder/],
    ['duplicate ranks', [{ key: 'main', ranks: [main.ranks[0]!, main.ranks[0]!] }], /duplicate rank/],
  ] as const)('%s', (_, ladders, message) => {
    expect(failure(() => runCase(withLadders(c, ladders as readonly Ladder[])))).toMatch(message)
  })

  test('a leg rule on a rolling window and a per_order window on a group measure are refused', () => {
    const legs = caseNamed('leg-rule')
    expect(failure(() => runCase(withLadders(legs, [ladder('main', [req('gv', 1n, { maxPerLegShare: '0.5', window: { type: 'rolling', periods: 2 } })])])))).toMatch(/period window only/)
    expect(failure(() => runCase(withLadders(legs, [ladder('main', [req('gv', 1n, { window: { type: 'per_order' } })])])))).toMatch(/per_order/)
  })

  test('a prior rank the plan version does not define needs a transition map', () => {
    const msg = failure(() => runCase({ ...c, prior: [{ positionId: 'A', paidAs: [{ ladder: 'main', rank: 'Gold' }] }] }))
    expect(msg).toMatch(/transition map missing/)
  })
})

describe('carryForward (TS-05, state-primitives.json)', () => {
  const fixture = loadFixture<{ cases: readonly { name: string; capMinor?: bigint; steps?: readonly { prevMinor: bigint; newMinor: bigint; qualified: boolean; expectedMinor: bigint }[] }[] }>('state-primitives.json')
  const ts05 = fixture.cases.find((x) => x.name === 'ts05-carry')!

  test.each(ts05.steps!.map((s, i) => [i, s] as const))('step %i', (_, step) => {
    const out = carryForward({ capMinor: ts05.capMinor!, expiresAfterPeriods: null }, { amountMinor: step.prevMinor, periodsHeld: 1 }, step.newMinor, step.qualified)
    expect(out.amountMinor).toBe(step.expectedMinor)
  })

  test('never below zero, and no balance means periodsHeld 0', () => {
    expect(carryForward({ capMinor: null, expiresAfterPeriods: null }, { amountMinor: 100n, periodsHeld: 1 }, -500n, true)).toEqual({ amountMinor: 0n, periodsHeld: 0 })
    expect(carryForward({ capMinor: null, expiresAfterPeriods: null }, null, 0n, true)).toEqual({ amountMinor: 0n, periodsHeld: 0 })
  })
})
