import { describe, expect, test } from 'vitest'
import { buildTree, evaluationInstant, nearestAncestor, positionOrder, rollUp } from '../src/tree.js'
import type { Relationship } from '../src/types.js'

const D = (day: number): bigint => BigInt(day) * 86_400_000_000n // days as µs
const rel = (parent: string, child: string, over: Partial<Relationship> = {}): Relationship => ({
  kind: 'sponsor', parentPositionId: parent, childPositionId: child, leg: null,
  validFromUs: D(1), validToUs: null, recordedAtUs: D(1), supersededAtUs: null, ...over,
})
const parentOf = (ids: readonly string[], rows: readonly Relationship[], validAt: bigint, knownAt: bigint, child: string): string | null => {
  const t = buildTree(ids, rows, 'sponsor', { validAtUs: validAt, knownAtUs: knownAt })
  const p = t.parent[t.index.get(child)!]!
  return p < 0 ? null : t.ids[p]!
}

describe('buildTree as of (valid D, known T) — FR-GEN-003', () => {
  const ids = positionOrder(['S1', 'S2', 'S3', 'B', 'C'])
  // ENGINE_GENEALOGY §2.3: B moves S1 -> S2 effective day 201 (change); C corrected S1 -> S3 from day 10, recorded day 300.
  const rows = [
    rel('S1', 'B', { validToUs: D(201) }), rel('S2', 'B', { validFromUs: D(201), recordedAtUs: D(200) }),
    rel('S1', 'C', { validFromUs: D(10), recordedAtUs: D(10), supersededAtUs: D(300) }), rel('S3', 'C', { validFromUs: D(10), recordedAtUs: D(300) }),
  ]

  test('a change applies from its effective date only (TS-61)', () => {
    expect(parentOf(ids, rows, D(200), D(400), 'B')).toBe('S1')
    expect(parentOf(ids, rows, D(201), D(400), 'B')).toBe('S2')
  })

  test('a correction is invisible to a run known before it was recorded (AC-01.1, TS-03)', () => {
    expect(parentOf(ids, rows, D(50), D(299), 'C')).toBe('S1')
    expect(parentOf(ids, rows, D(50), D(300), 'C')).toBe('S3')
  })

  test('the run evaluates at end - 1 µs, so a change effective at the next period start does not apply (C4)', () => {
    const at = evaluationInstant({ endsAtUs: D(201) })
    expect(parentOf(ids, rows, at, D(400), 'B')).toBe('S1')
  })

  test('placement rows do not leak into the sponsor tree; ids and index are shared and sorted', () => {
    const t = buildTree(ids, [...rows, rel('S3', 'S1', { kind: 'placement', leg: 'L' })], 'sponsor', { validAtUs: D(250), knownAtUs: D(400) })
    expect(t.ids).toEqual(['B', 'C', 'S1', 'S2', 'S3'])
    expect(t.parent[t.index.get('S1')!]).toBe(-1)
    const placement = buildTree(ids, [rel('S3', 'S1', { kind: 'placement', leg: 'L' })], 'placement', { validAtUs: D(250), knownAtUs: D(400) })
    expect(placement.leg[placement.index.get('S1')!]).toBe('L')
  })
})

describe('buildTree refuses what is not a forest (FR-GEN-002)', () => {
  const ids = positionOrder(['A', 'B', 'C'])
  const at = { validAtUs: D(5), knownAtUs: D(5) }
  test('two parents at the instant', () => expect(() => buildTree(ids, [rel('A', 'C'), rel('B', 'C')], 'sponsor', at)).toThrow('TREE'))
  test('cycle', () => expect(() => buildTree(ids, [rel('A', 'B'), rel('B', 'C'), rel('C', 'A')], 'sponsor', at)).toThrow('cycle'))
  test('self loop', () => expect(() => buildTree(ids, [rel('A', 'A')], 'sponsor', at)).toThrow('cycle'))
  test('unknown position', () => expect(() => buildTree(ids, [rel('A', 'Z')], 'sponsor', at)).toThrow('unknown child'))
  test('duplicate or unsorted ids', () => {
    expect(() => positionOrder(['A', 'A'])).toThrow('duplicate')
    expect(() => buildTree(['B', 'A'], [], 'sponsor', at)).toThrow('positionOrder')
  })
})

describe('O(N) helpers', () => {
  // G-E2E-01 tree: A -> B, A -> C, B -> D; PV 100, 600, 100, 450 (whole units).
  const ids = positionOrder(['D', 'C', 'B', 'A'])
  const t = buildTree(ids, [rel('A', 'B'), rel('A', 'C'), rel('B', 'D')], 'sponsor', { validAtUs: D(5), knownAtUs: D(5) })
  const pv = BigInt64Array.from([100n, 600n, 100n, 450n]) // index order A, B, C, D

  test('rollUp gives group volume (E2E GV 1250, 1050, 100, 450)', () => {
    expect([...rollUp(t, pv)]).toEqual([1250n, 1050n, 100n, 450n])
    expect([...t.depth]).toEqual([0, 1, 1, 2])
  })

  test('rollUp with passUp stops at the given children (generation volume)', () => {
    const isB = (k: number): boolean => t.ids[k] === 'B'
    expect([...rollUp(t, pv, (k) => !isB(k))]).toEqual([200n, 1050n, 100n, 450n])
  })

  test('rollUp refuses sums past int64 instead of wrapping', () => {
    expect(() => rollUp(t, BigInt64Array.from([1n << 62n, 1n << 62n, 0n, 0n]))).toThrow('OVERFLOW')
  })

  test('nearestAncestor skips positions that fail the predicate (dynamic compression)', () => {
    const notB = nearestAncestor(t, (k) => t.ids[k] !== 'B')
    expect([...notB].map((p) => (p < 0 ? null : t.ids[p]))).toEqual([null, 'A', 'A', 'A'])
  })
})
