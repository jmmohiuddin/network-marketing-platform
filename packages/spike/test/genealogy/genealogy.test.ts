import { describe, expect, it } from 'vitest'
import { asOfParents, generateTree, prng, randInt, type TreeSpec } from '../../src/genealogy/generate.js'
import { buildTree, isAncestor, rollUp, subtreeSizes, upline } from '../../src/genealogy/tree.js'

const SPEC: TreeSpec = { size: 600, seed: 7, deepChain: 60, changeRate: 0.05, correctionRate: 0.05, days: 100 }
const g = generateTree(SPEC)
const tree = buildTree(g.parent)

// Naive oracles: recursion over a children map, built from parent[] without any of the typed-array tricks.
const childrenOf = (parent: Int32Array): Map<number, number[]> => {
  const m = new Map<number, number[]>()
  parent.forEach((p, i) => { if (p >= 0) m.set(p, [...(m.get(p) ?? []), i]) })
  return m
}
const kids = childrenOf(g.parent)
const naiveGroup = (i: number, v: BigInt64Array): bigint => (kids.get(i) ?? []).reduce((s, c) => s + naiveGroup(c, v), v[i]!)
const naiveUpline = (i: number): number[] => (g.parent[i]! < 0 ? [] : [g.parent[i]!, ...naiveUpline(g.parent[i]!)])

describe('genealogy generator', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const again = generateTree(SPEC)
    expect(again.parent).toEqual(g.parent)
    expect(again.rows.child.subarray(0, again.rows.count)).toEqual(g.rows.child.subarray(0, g.rows.count))
    expect(generateTree({ ...SPEC, seed: 8 }).parent).not.toEqual(g.parent)
  })

  it('has the deep chain, a long tail and some changes and corrections', () => {
    expect(tree.depth[SPEC.deepChain]).toBe(SPEC.deepChain)
    const degrees = [...kids.values()].map((c) => c.length)
    expect(Math.max(...degrees)).toBeGreaterThan(20)
    expect(SPEC.size - kids.size).toBeGreaterThan(SPEC.size / 3) // many leaves
    const ev = Array.from(g.rows.event.subarray(0, g.rows.count))
    expect(ev.filter((e) => e === 1).length).toBeGreaterThan(5)
    expect(ev.filter((e) => e === 2).length).toBeGreaterThan(5)
  })

  it('as of now, known now, reproduces the current tree', () => {
    expect(asOfParents(g.rows, SPEC.size, SPEC.days, SPEC.days)).toEqual(g.parent)
  })

  it('a correction is invisible before it was recorded and visible after (AC-01.1)', () => {
    const r = Array.from({ length: g.rows.count }, (_, k) => k).find((k) => g.rows.event[k] === 2)!
    const child = g.rows.child[r]!
    const at = g.rows.validFrom[r]!
    const recorded = g.rows.recordedAt[r]!
    const old = Array.from({ length: g.rows.count }, (_, k) => k).find((k) => g.rows.child[k] === child && g.rows.supersededAt[k] === recorded)!
    expect(asOfParents(g.rows, SPEC.size, at, recorded - 1)[child]).toBe(g.rows.parent[old])
    expect(asOfParents(g.rows, SPEC.size, at, recorded)[child]).toBe(g.rows.parent[r])
  })
})

describe('in-memory tree', () => {
  it('orders every parent before its children and matches naive depth', () => {
    const pos = new Int32Array(tree.n)
    tree.order.forEach((node, k) => { pos[node] = k })
    for (let i = 0; i < tree.n; i++) {
      if (g.parent[i]! >= 0) expect(pos[g.parent[i]!]).toBeLessThan(pos[i]!)
      expect(tree.depth[i]).toBe(naiveUpline(i).length)
    }
  })

  it('roll-up equals the naive recursive sum for every position (bigint minor units)', () => {
    const rand = prng(1)
    const v = new BigInt64Array(tree.n).map(() => BigInt(randInt(rand, 1_000_000)) * 1_000_000_000n) // beyond 2^53
    const got = rollUp(tree, v)
    for (let i = 0; i < tree.n; i++) expect(got[i]).toBe(naiveGroup(i, v))
    expect(v[0]).not.toBe(got[0]) // input not mutated
    const sizes = subtreeSizes(tree)
    for (let i = 0; i < tree.n; i++) expect(BigInt(sizes[i]!)).toBe(naiveGroup(i, new BigInt64Array(tree.n).fill(1n)))
  })

  it('upline walk equals the naive walk, full and capped', () => {
    const buf = new Int32Array(tree.n)
    for (let i = 0; i < tree.n; i++) {
      const want = naiveUpline(i)
      expect(Array.from(buf.subarray(0, upline(tree, i, buf)))).toEqual(want)
      expect(Array.from(buf.subarray(0, upline(tree, i, buf, 3)))).toEqual(want.slice(0, 3))
      if (want.length) expect(isAncestor(tree, want[want.length - 1]!, i)).toBe(true)
    }
  })

  it('rejects cycles, orphans and two roots', () => {
    expect(() => buildTree(Int32Array.from([-1, 2, 1]))).toThrow(/unreachable/)
    expect(() => buildTree(Int32Array.from([-1, 0, -1]))).toThrow(/two roots/)
    expect(() => buildTree(Int32Array.from([1, 0]))).toThrow(/no root/)
  })
})
