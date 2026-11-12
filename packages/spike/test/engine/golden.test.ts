import { describe, expect, it } from 'vitest'
import { allocateCap } from '../../src/engine/cap.js'
import { halfUpDiv, largestRemainder, parseRate, RATE_SCALE } from '../../src/engine/money.js'
import { runEngine } from '../../src/engine/run.js'
import type { Plan } from '../../src/engine/types.js'
import { byId, fmt, snap, type Line } from './helpers.js'

// Expected values are the oracle's: product-documentation/08-qa/verification/verification_output.txt (55/55 ok).

const UNILEVEL_RATES = ['0.08', '0.05', '0.04', '0.04', '0.04']
const R1_ONLY: Plan['ranks'] = [{ key: 'R1', pvGte: 10000n }]

/** Payee 1 with a chain of len(cv) positions below; level k = position k+1. */
function chain(cv: number[], active: boolean[]): { tree: [number, number][]; lines: Line[] } {
  const tree: [number, number][] = [[1, 0], ...cv.map((_, i): [number, number] => [i + 2, i + 1])]
  const lines: Line[] = [{ pos: 1, qv: 100 }, ...cv.map((c, i) => ({ pos: i + 2, cv: c, qv: active[i] ? 100 : 0 }))]
  return { tree, lines }
}

describe('unilevel (TS-01, TS-02)', () => {
  const plan = (compression: 'dynamic' | 'none'): Plan => ({ ranks: R1_ONLY, unilevel: { measure: 'cv', rates: UNILEVEL_RATES, compression, requiresRank: 1 } })

  it('TS-01 pays 80.00, 125.00, 160.00, 240.00, 320.00 by level, total 925.00', () => {
    const vols = [1000, 2500, 4000, 6000, 8000]
    const perLevel = vols.map((_, lvl) => {
      const { tree, lines } = chain(vols.map((v, i) => (i === lvl ? v : 0)), vols.map(() => true))
      return byId(runEngine(snap(tree, lines), plan('dynamic')), 'unilevel')[1]
    })
    expect(perLevel).toEqual(['80.00', '125.00', '160.00', '240.00', '320.00'])
    const { tree, lines } = chain(vols, vols.map(() => true))
    expect(byId(runEngine(snap(tree, lines), plan('dynamic')), 'unilevel')[1]).toBe('925.00')
  })

  it('TS-02 inactive 2nd level: 800.00 without compression, 1040.00 with', () => {
    const { tree, lines } = chain([1000, 2500, 4000, 6000, 8000, 5000], [true, false, true, true, true, true])
    expect(byId(runEngine(snap(tree, lines), plan('none')), 'unilevel')[1]).toBe('800.00')
    expect(byId(runEngine(snap(tree, lines), plan('dynamic')), 'unilevel')[1]).toBe('1040.00')
  })
})

describe('money primitives (TS-06, TS-07, TS-08, tie-break)', () => {
  const cents = (xs: string[]): bigint[] => xs.map((x) => BigInt(x.replace('.', '')))

  it('parses rates exactly and rounds half-up', () => {
    expect(parseRate('0.8856')).toBe(885600n)
    expect(() => parseRate('0.1234567')).toThrow()
    expect(halfUpDiv(5n, 10n)).toBe(1n)
    expect(halfUpDiv(4n, 10n)).toBe(0n)
  })

  it('tie-break: 100.00 over 3 equal shares gives the extra cent to the lowest key', () => {
    expect(largestRemainder(10000n, [1n, 1n, 1n]).map(fmt)).toEqual(['33.34', '33.33', '33.33'])
  })

  it('TS-06 pool 62,500.00 over 66 shares sums exactly', () => {
    const shares = [...Array(40).fill(1n), ...Array(10).fill(2n), ...Array(2).fill(3n)] as bigint[]
    expect(largestRemainder(6250000n, shares).reduce((a, b) => a + b)).toBe(6250000n)
  })

  it('TS-07 proportional cap 8,328.12 over 8 lines sums exactly to the cap', () => {
    const lines = cents(['1234.57', '987.65', '45.67', '0.37', '12.34', '6789.01', '333.33', '0.99'])
    const proposed = lines.reduce((a, b) => a + b)
    expect(fmt(proposed)).toBe('9403.93')
    const cap = halfUpDiv(proposed * parseRate('0.8856'), RATE_SCALE)
    expect(fmt(cap)).toBe('8328.12')
    const out = allocateCap(cap, lines.map((x) => x * RATE_SCALE), lines.map(() => 0))!
    expect(out.reduce((a, b) => a + b)).toBe(cap)
  })

  it('TS-08 cap 100,000: priority 70,000.00 / 30,000.00; proportional 60,869.57 / 39,130.43', () => {
    const raw = cents(['70000.00', '45000.00']).map((x) => x * RATE_SCALE)
    expect(allocateCap(10000000n, raw, [0, 1], [1])!.map(fmt)).toEqual(['70000.00', '30000.00'])
    expect(allocateCap(10000000n, raw, [0, 1])!.map(fmt)).toEqual(['60869.57', '39130.43'])
  })
})

describe('worked end-to-end G-E2E-01', () => {
  // A=1 -> B=2, C=3; B -> D=4. Own orders A 100, B 200, C 100, D 300; customers K1 (by B) 400, K2 (by D) 150.
  const own = (pos: number, x: number): Line => ({ pos, qv: x, cv: x, price: x })
  const s = snap([[1, 0], [2, 1], [3, 1], [4, 2]], [own(1, 100), own(2, 200), own(3, 100), own(4, 300), { ...own(2, 400), customer: true }, { ...own(4, 150), customer: true }])
  const plan: Plan = {
    ranks: [{ key: 'R1', pvGte: 10000n }, { key: 'R2', pvGte: 10000n, gvGte: 70000n }],
    retail: { rate: '0.25' },
    unilevel: { measure: 'pv', rates: ['0.08', '0.05'], compression: 'dynamic', requiresRank: 1 },
    rankBonus: { byRank: ['0', '0.05', '0.10'] },
    matching: { of: ['rank_bonus'], rates: ['0.20'] },
    companyCap: { scope: ['rank_bonus', 'matching'], rate: '0.20', priority: ['matching'] },
  }

  it('volumes, ranks, retail, unilevel', () => {
    const r = runEngine(s, plan)
    expect([...r.pv].map(fmt)).toEqual(['100.00', '600.00', '100.00', '450.00'])
    expect([...r.gv].map(fmt)).toEqual(['1250.00', '1050.00', '100.00', '450.00'])
    expect([...r.rank]).toEqual([2, 2, 1, 1])
    expect(byId(r, 'retail')).toEqual({ 2: '100.00', 4: '37.50' })
    expect(byId(r, 'unilevel')).toEqual({ 1: '78.50', 2: '36.00' })
  })

  it('rank bonus and matching before cap', () => {
    const r = runEngine(s, { ...plan, companyCap: undefined })
    expect(byId(r, 'rank_bonus')).toEqual({ 1: '125.00', 2: '105.00', 3: '5.00', 4: '22.50' })
    expect(byId(r, 'matching')).toEqual({ 1: '22.00', 2: '4.50' })
  })

  it('cap 250.00: matching removed, rank bonus by largest remainder, gross per payee, run total 502.00', () => {
    const r = runEngine(s, plan)
    expect(fmt(r.netSalesMinor)).toBe('1250.00')
    expect(fmt(r.capMinor!)).toBe('250.00')
    expect(byId(r, 'matching')).toEqual({})
    expect(byId(r, 'rank_bonus')).toEqual({ 1: '121.36', 2: '101.94', 3: '4.85', 4: '21.85' })
    const gross = [...r.positionId].map((_, k) => fmt(Object.values(r.amounts).reduce((a, arr) => a + arr[k]!, 0n)))
    expect(gross).toEqual(['199.86', '237.94', '4.85', '59.35'])
    expect(fmt(r.totalMinor)).toBe('502.00')
  })
})
