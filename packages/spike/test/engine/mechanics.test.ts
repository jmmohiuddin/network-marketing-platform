import { describe, expect, it } from 'vitest'
import { BENCH_PLAN, generate, shuffle } from '../../src/engine/generate.js'
import { runEngine } from '../../src/engine/run.js'
import type { Plan } from '../../src/engine/types.js'
import { byId, snap, type Line } from './helpers.js'

// Mechanisms without an oracle value; expected numbers are derived by hand in the comments.

describe('generations with dynamic compression', () => {
  // Chain P(1) -> x(2) -> L1(3) -> y(4) -> L2(5) -> z(6). Leaders (R2) have PV 300, others 100.
  // Generation volume: L1 = 300 + y 100 = 400; L2 = 300 + z 100 = 400 (L2 not part of L1's).
  // P: gen 1 = L1 400 x 10% = 40.00, gen 2 = L2 400 x 5% = 20.00 -> 60.00. L1: gen 1 = L2 -> 40.00.
  const pv = [300, 100, 300, 100, 300, 100]
  const s = snap(pv.map((_, i): [number, number] => [i + 1, i]), pv.map((x, i): Line => ({ pos: i + 1, qv: x })))
  const plan: Plan = { ranks: [{ key: 'R1', pvGte: 10000n }, { key: 'R2', pvGte: 30000n }], generation: { leaderRank: 2, rates: ['0.10', '0.05'] } }

  it('non-leaders do not consume a generation', () => {
    expect(byId(runEngine(s, plan), 'generation')).toEqual({ 1: '60.00', 3: '40.00' })
  })
})

describe('rank qualification with leg rules', () => {
  // R2: GV >= 1000 with each leg counted at most 50% of 1000; R3: R2 in 2 different legs.
  const ranks: Plan['ranks'] = [
    { key: 'R1', pvGte: 10000n },
    { key: 'R2', pvGte: 10000n, gvGte: 100000n, maxLegPct: '0.5' },
    { key: 'R3', pvGte: 10000n, legs: { rank: 2, count: 2 } },
  ]
  // 10: three legs of 400 -> 100 + 3 x 400 = 1300 -> R2.  20: legs 900 and 100 -> 100 + 500 + 100 = 700 -> R1 (1100 uncapped).
  // 30 -> 31 -> 10-subtree and 30 -> 32 -> 40 (copy of 10): R2 in 2 legs -> R3.
  // 50 -> 51 -> 20-subtree and 50 -> 52 -> 60 (copy of 10): one R2 leg -> not R3; GV 100 + 500 + 500 = 1100 -> R2.
  const tree: [number, number][] = [
    [30, 0], [31, 30], [32, 30], [10, 31], [11, 10], [12, 10], [13, 10], [40, 32], [41, 40], [42, 40], [43, 40],
    [50, 0], [51, 50], [52, 50], [20, 51], [21, 20], [22, 20], [60, 52], [61, 60], [62, 60], [63, 60],
  ]
  const pv: Record<number, number> = { 11: 400, 12: 400, 13: 400, 41: 400, 42: 400, 43: 400, 61: 400, 62: 400, 63: 400, 21: 900 }
  const s = snap(tree, tree.map(([id]): Line => ({ pos: id, qv: pv[id] ?? 100 })))
  const rankOf = (r: ReturnType<typeof runEngine>, id: number): number => r.rank[r.positionId.indexOf(id)]!

  it('caps each leg, counts qualified legs', () => {
    const r = runEngine(s, { ranks })
    expect([10, 20, 30, 50].map((id) => rankOf(r, id))).toEqual([2, 1, 3, 2])
  })

  it('without the leg cap the strong-leg position qualifies', () => {
    const r = runEngine(s, { ranks: ranks.map((x) => ({ ...x, maxLegPct: undefined })) })
    expect(rankOf(r, 20)).toBe(2)
  })
})

describe('per-payee cap (pass 7)', () => {
  it('limits one bonus per payee before rounding', () => {
    // E2E unilevel A 78.50, B 36.00; cap 50.00 -> A 50.00, B unchanged.
    const own = (pos: number, x: number): Line => ({ pos, qv: x, cv: x, price: x })
    const s = snap([[1, 0], [2, 1], [3, 1], [4, 2]], [own(1, 100), own(2, 600), own(3, 100), own(4, 450)])
    const plan: Plan = { ranks: [{ key: 'R1', pvGte: 10000n }], unilevel: { measure: 'pv', rates: ['0.08', '0.05'], compression: 'dynamic', requiresRank: 1 }, perPayeeCap: { unilevel: 5000n } }
    expect(byId(runEngine(s, plan), 'unilevel')).toEqual({ 1: '50.00', 2: '36.00' })
  })
})

describe('determinism', () => {
  for (const shape of ['random', 'deepleg'] as const) {
    it(`${shape}: shuffled input gives byte-identical hashes; the cap binds`, () => {
      const s = generate(6000, 7, shape)
      const a = runEngine(s, BENCH_PLAN)
      const b = runEngine(shuffle(s, 99), BENCH_PLAN)
      expect(a.capMinor).not.toBeNull()
      expect(b.linesHash).toBe(a.linesHash)
      expect(b.summaryHash).toBe(a.summaryHash)
      expect(b.totalMinor).toBe(a.totalMinor)
      expect(runEngine(generate(6000, 8, shape), BENCH_PLAN).linesHash).not.toBe(a.linesHash)
    })
  }

  it('rejects a cycle and an unknown sponsor', () => {
    expect(() => runEngine(snap([[1, 2], [2, 1]], []), BENCH_PLAN)).toThrow(/cycle/)
    expect(() => runEngine(snap([[1, 0], [2, 9]], []), BENCH_PLAN)).toThrow(/unknown sponsor/)
  })
})
