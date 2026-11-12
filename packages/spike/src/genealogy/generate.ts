/** Seeded sponsor-tree generator for the genealogy spike (TS-29, OQ-29). Deterministic: same spec -> same arrays. */

/** mulberry32: small seeded PRNG; integer-only maths, so identical on every platform. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const randInt = (rand: () => number, n: number): number => Math.floor(rand() * n)

export interface TreeSpec {
  size: number // positions, root included
  seed: number
  deepChain: number // positions 1..deepChain form one chain under the root (OQ-29 deep leg)
  changeRate: number // share of positions that get a dated sponsor change (closes old row, BR-GEN-03)
  correctionRate: number // share that get a correction (supersedes old row, BR-GEN-04)
  days: number // history length; "now" = day `days`
}

export const EVENT_NAMES = ['enrolment', 'change', 'correction'] as const

/** relationship rows as struct-of-arrays. Times are day offsets; -1 = NULL. */
export interface Rows {
  count: number
  parent: Int32Array
  child: Int32Array
  validFrom: Int32Array
  validTo: Int32Array
  recordedAt: Int32Array
  supersededAt: Int32Array
  event: Uint8Array // index into EVENT_NAMES
}

export interface GeneratedTree {
  spec: TreeSpec
  parent: Int32Array // current knowledge, valid now; -1 for the root
  rows: Rows
}

export const enrolDay = (i: number, spec: TreeSpec): number => Math.floor((i * spec.days) / spec.size)

/**
 * Preferential attachment (each new position picks a sponsor with probability ~ degree) gives the long-tailed
 * branching of real sponsor trees: most positions sponsor nobody, a few sponsor thousands.
 * Every parent index is lower than its child index, before and after changes, so no slice of history has a cycle.
 * The chain nodes are never sponsors or movers apart from the chain itself, which keeps path volume bounded.
 */
export function generateTree(spec: TreeSpec): GeneratedTree {
  const n = spec.size
  if (!Number.isInteger(n) || n < spec.deepChain + 2) throw new Error(`size ${n} must exceed deepChain + 1`)
  if (spec.days < 2) throw new Error('days must be >= 2')
  const rand = prng(spec.seed)
  const parent = new Int32Array(n)
  parent[0] = -1
  const pool = new Int32Array(2 * n)
  let poolLen = 0
  pool[poolLen++] = 0
  for (let i = 1; i < n; i++) {
    if (i <= spec.deepChain) { parent[i] = i - 1; continue }
    const p = pool[randInt(rand, poolLen)]!
    parent[i] = p
    pool[poolLen++] = p
    pool[poolLen++] = i
  }

  const cap = n + Math.ceil(n * (spec.changeRate + spec.correctionRate)) + 1
  const rows: Rows = {
    count: 0, parent: new Int32Array(cap), child: new Int32Array(cap), validFrom: new Int32Array(cap),
    validTo: new Int32Array(cap), recordedAt: new Int32Array(cap), supersededAt: new Int32Array(cap), event: new Uint8Array(cap),
  }
  const push = (p: number, c: number, vf: number, rec: number, ev: number): number => {
    const r = rows.count++
    rows.parent[r] = p; rows.child[r] = c; rows.validFrom[r] = vf; rows.validTo[r] = -1
    rows.recordedAt[r] = rec; rows.supersededAt[r] = -1; rows.event[r] = ev
    return r
  }
  const rowOf = new Int32Array(n).fill(-1)
  for (let i = 1; i < n; i++) rowOf[i] = push(parent[i]!, i, enrolDay(i, spec), enrolDay(i, spec), 0)

  const touched = new Uint8Array(n)
  const movable = n - 1 - spec.deepChain
  const move = (count: number, ev: 1 | 2): void => {
    for (let k = 0; k < count; k++) {
      const c = 1 + spec.deepChain + randInt(rand, movable)
      let p = randInt(rand, c)
      if (p >= 1 && p <= spec.deepChain) p = 0
      if (touched[c] || p === parent[c]) continue
      touched[c] = 1
      const day = enrolDay(c, spec) + 1 + randInt(rand, spec.days - enrolDay(c, spec)) // in (enrolment, now]
      const old = rowOf[c]!
      if (ev === 1) { rows.validTo[old] = day; rowOf[c] = push(p, c, day, day, 1) } // change: close in place (C5)
      else { rows.supersededAt[old] = day; rowOf[c] = push(p, c, rows.validFrom[old]!, day, 2) } // correction
      parent[c] = p
    }
  }
  move(Math.round(n * spec.changeRate), 1)
  move(Math.round(n * spec.correctionRate), 2)
  return { spec, parent, rows }
}

/** "Tree as of D, as known at T" (FR-GEN-003): the same predicate as the SQL in db.ts. -1 = root or not enrolled. */
export function asOfParents(rows: Rows, size: number, d: number, t: number): Int32Array {
  const parent = new Int32Array(size).fill(-1)
  for (let r = 0; r < rows.count; r++) {
    const live = rows.validFrom[r]! <= d && (rows.validTo[r]! < 0 || rows.validTo[r]! > d)
      && rows.recordedAt[r]! <= t && (rows.supersededAt[r]! < 0 || rows.supersededAt[r]! > t)
    if (!live) continue
    const c = rows.child[r]!
    if (parent[c] !== -1) throw new Error(`position ${c} has two parents as of ${d} known at ${t}`)
    parent[c] = rows.parent[r]!
  }
  return parent
}
