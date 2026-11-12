import type { Plan, Snapshot } from './types.js'

// Deterministic synthetic snapshots for the engine benchmark (local; the TS-29 shape generator is task 1).

/** mulberry32: small seeded PRNG, returns a function giving floats in [0, 1). Only used for shapes, never for money. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export type Shape = 'random' | 'deepleg'
export const DEEP_LEG_DEPTH = 5000

/**
 * `positions` positions, ids 1..n, sponsor drawn uniformly among earlier positions (random recursive tree);
 * 'deepleg' first builds a chain of DEEP_LEG_DEPTH (TS-29 deep leg). 0..6 orders per position (mean 3),
 * 1..2 lines each, 30% of orders from serviced customers; prices 10.00..200.00.
 */
export function generate(positions: number, seed: number, shape: Shape = 'random'): Snapshot {
  const rnd = prng(seed)
  const int = (n: number): number => Math.floor(rnd() * n)
  const positionId = new Int32Array(positions), sponsorId = new Int32Array(positions)
  const linesPer = new Uint8Array(positions)
  let lineCount = 0
  for (let i = 0; i < positions; i++) {
    positionId[i] = i + 1
    sponsorId[i] = i === 0 ? 0 : shape === 'deepleg' && i < DEEP_LEG_DEPTH ? i : 1 + int(i)
    const orders = int(7)
    let lines = 0
    for (let o = 0; o < orders; o++) lines += 1 + int(2)
    linesPer[i] = lines
    lineCount += lines
  }
  const linePositionId = new Int32Array(lineCount), lineCustomer = new Uint8Array(lineCount)
  const lineQv = new BigInt64Array(lineCount), lineCv = new BigInt64Array(lineCount), linePrice = new BigInt64Array(lineCount)
  let l = 0
  for (let i = 0; i < positions; i++) {
    for (let j = 0; j < linesPer[i]!; j++, l++) {
      const price = BigInt(1000 + int(19001))
      linePositionId[l] = i + 1
      lineCustomer[l] = rnd() < 0.3 ? 1 : 0
      linePrice[l] = price
      lineQv[l] = price
      lineCv[l] = (price * 8n) / 10n
    }
  }
  return { positionId, sponsorId, linePositionId, lineCustomer, lineQv, lineCv, linePrice }
}

/** Fisher-Yates permutation of positions and of lines: same facts, different input order. */
export function shuffle(s: Snapshot, seed: number): Snapshot {
  const rnd = prng(seed)
  const perm = (n: number): Uint32Array => {
    const p = new Uint32Array(n)
    for (let i = 0; i < n; i++) p[i] = i
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = p[i]!; p[i] = p[j]!; p[j] = x }
    return p
  }
  const pp = perm(s.positionId.length), lp = perm(s.linePositionId.length)
  const pick = <T extends Int32Array | Uint8Array | BigInt64Array>(a: T, p: Uint32Array): T => {
    const out = new (a.constructor as new (n: number) => T)(p.length)
    for (let i = 0; i < p.length; i++) out[i] = a[p[i]!]!
    return out
  }
  return {
    positionId: pick(s.positionId, pp), sponsorId: pick(s.sponsorId, pp),
    linePositionId: pick(s.linePositionId, lp), lineCustomer: pick(s.lineCustomer, lp),
    lineQv: pick(s.lineQv, lp), lineCv: pick(s.lineCv, lp), linePrice: pick(s.linePrice, lp),
  }
}

/** Every mechanism on, company cap set low so it binds and largest remainder runs over most payees. */
export const BENCH_PLAN: Plan = {
  ranks: [
    { key: 'R1', pvGte: 5000n },
    { key: 'R2', pvGte: 5000n, gvGte: 100000n, maxLegPct: '0.5' },
    { key: 'R3', pvGte: 5000n, gvGte: 500000n, maxLegPct: '0.4', legs: { rank: 2, count: 2 } },
    { key: 'R4', pvGte: 5000n, gvGte: 2000000n, maxLegPct: '0.4', legs: { rank: 3, count: 2 } },
  ],
  retail: { rate: '0.25' },
  unilevel: { measure: 'cv', rates: ['0.08', '0.05', '0.04', '0.04', '0.04'], compression: 'dynamic', requiresRank: 1 },
  rankBonus: { byRank: ['0', '0.02', '0.04', '0.06', '0.08'] },
  generation: { leaderRank: 3, rates: ['0.05', '0.03', '0.02'] },
  matching: { of: ['rank_bonus', 'generation'], rates: ['0.20', '0.10'] },
  perPayeeCap: { unilevel: 500000n },
  companyCap: { scope: ['rank_bonus', 'generation', 'matching'], rate: '0.15', priority: ['matching'] },
}
