import { createHash } from 'node:crypto'
import { allocateCap } from './cap.js'
import { halfUpDiv, parseRate, RATE_SCALE } from './money.js'
import { buildTree, type Tree } from './tree.js'
import { BONUSES, type BonusKey, type Plan, type RankRule, type RunResult, type Snapshot } from './types.js'

// Spike calculation core, NOT the product engine. Passes follow SDD-07 §4 (subset):
// 1 line volume, 2 position volume, 3 qualification, 4 individual bonuses, 5 matching,
// 7 per-payee caps, 8 company cap, 10 rounding once per line, 12 totals + ordered hash.
// No clock in the calculation; performance.now only feeds timingsMs, which is outside both hashes.

const MAX_TOTAL_VOLUME = 1n << 62n // keeps every BigInt64Array sum far from wrap-around

type Raw = Record<BonusKey, bigint[]> // minor * RATE_SCALE, per position index

interface Volumes { pv: BigInt64Array; cv: BigInt64Array; gv: BigInt64Array; retailBase: BigInt64Array; netSales: bigint }

function lineVolumes(s: Snapshot, t: Tree): Volumes {
  const n = t.ids.length
  const pv = new BigInt64Array(n), cv = new BigInt64Array(n), retailBase = new BigInt64Array(n)
  let netSales = 0n, total = 0n
  for (let l = 0; l < t.lineIndex.length; l++) {
    const k = t.lineIndex[l]!, qv = s.lineQv[l]!, c = s.lineCv[l]!, price = s.linePrice[l]!
    if (qv < 0n || c < 0n || price < 0n) throw new Error(`order line ${l} has a negative amount`)
    pv[k]! += qv
    cv[k]! += c
    if (s.lineCustomer[l] === 1) retailBase[k]! += price
    netSales += price
    total += qv + c + price
  }
  if (total >= MAX_TOTAL_VOLUME) throw new Error('total volume exceeds 2^62 minor units')
  const gv = pv.slice()
  for (let i = t.bfs.length - 1; i > 0; i--) {
    const k = t.bfs[i]!, p = t.parent[k]!
    if (p >= 0) gv[p]! += gv[k]!
  }
  return { pv, cv, gv, retailBase, netSales }
}

function qualifies(rule: RankRule, k: number, t: Tree, v: Volumes, maxRankSub: Uint8Array): boolean {
  if (rule.pvGte !== undefined && v.pv[k]! < rule.pvGte) return false
  if (rule.gvGte !== undefined) {
    let gv = v.gv[k]!
    if (rule.maxLegPct !== undefined) {
      const legCap = (rule.gvGte * parseRate(rule.maxLegPct)) / RATE_SCALE
      gv = v.pv[k]!
      for (let c = t.childStart[k]!; c < t.childStart[k + 1]!; c++) {
        const leg = v.gv[t.childList[c]!]!
        gv += leg < legCap ? leg : legCap
      }
    }
    if (gv < rule.gvGte) return false
  }
  if (rule.legs) {
    let legs = 0
    for (let c = t.childStart[k]!; c < t.childStart[k + 1]!; c++) if (maxRankSub[t.childList[c]!]! >= rule.legs.rank) legs++
    if (legs < rule.legs.count) return false
  }
  return true
}

/** Pass 3: paid-as rank, bottom-up so leg rules see the downline's ranks. */
function qualify(plan: Plan, t: Tree, v: Volumes): Uint8Array {
  const n = t.ids.length
  const rank = new Uint8Array(n), maxRankSub = new Uint8Array(n)
  for (let i = n - 1; i >= 0; i--) {
    const k = t.bfs[i]!
    for (let r = plan.ranks.length; r >= 1; r--) {
      if (qualifies(plan.ranks[r - 1]!, k, t, v, maxRankSub)) { rank[k] = r; break }
    }
    let m = rank[k]!
    for (let c = t.childStart[k]!; c < t.childStart[k + 1]!; c++) m = Math.max(m, maxRankSub[t.childList[c]!]!)
    maxRankSub[k] = m
  }
  return rank
}

/** Nearest ancestor satisfying `keep`, computed top-down so upline walks skip non-qualifying chains in O(1). */
function nearestAncestor(t: Tree, keep: (k: number) => boolean): Int32Array {
  const out = new Int32Array(t.ids.length)
  for (const k of t.bfs) {
    const p = t.parent[k]!
    out[k] = p < 0 ? -1 : keep(p) ? p : out[p]!
  }
  return out
}

function unilevel(plan: NonNullable<Plan['unilevel']>, t: Tree, v: Volumes, rank: Uint8Array, out: bigint[]): void {
  const rates = plan.rates.map(parseRate)
  const measure = plan.measure === 'pv' ? v.pv : v.cv
  const active = (k: number): boolean => rank[k]! >= plan.requiresRank
  // dynamic: inactive positions do not consume a level; none: they consume it and that level pays 0 (TS-02)
  const up = plan.compression === 'dynamic' ? nearestAncestor(t, active) : t.parent
  for (let k = 0; k < t.ids.length; k++) {
    const m = measure[k]!
    if (m === 0n || !active(k)) continue // an inactive position's own volume is never paid
    let a = up[k]!
    for (let lvl = 0; lvl < rates.length && a >= 0; lvl++, a = up[a]!) if (active(a)) out[a]! += m * rates[lvl]!
  }
}

function generation(plan: NonNullable<Plan['generation']>, t: Tree, v: Volumes, rank: Uint8Array, out: bigint[]): void {
  const rates = plan.rates.map(parseRate)
  const leader = (k: number): boolean => rank[k]! >= plan.leaderRank
  const genVol = v.pv.slice() // own PV + non-leader downline down to (excluding) the next leaders
  for (let i = t.bfs.length - 1; i > 0; i--) {
    const k = t.bfs[i]!, p = t.parent[k]!
    if (p >= 0 && !leader(k)) genVol[p]! += genVol[k]!
  }
  const up = nearestAncestor(t, leader) // non-leaders never consume a generation (dynamic compression)
  for (let k = 0; k < t.ids.length; k++) {
    if (!leader(k) || genVol[k] === 0n) continue
    let a = up[k]!
    for (let g = 0; g < rates.length && a >= 0; g++, a = up[a]!) out[a]! += genVol[k]! * rates[g]!
  }
}

function matching(plan: NonNullable<Plan['matching']>, t: Tree, raw: Raw): bigint[] {
  const rates = plan.rates.map(parseRate)
  const acc = new Array<bigint>(t.ids.length).fill(0n) // minor * RATE_SCALE^2
  for (let k = 0; k < t.ids.length; k++) {
    let base = 0n
    for (const b of plan.of) base += raw[b][k]!
    if (base === 0n) continue
    let a = t.parent[k]!
    for (let g = 0; g < rates.length && a >= 0; g++, a = t.parent[a]!) acc[a]! += base * rates[g]!
  }
  return acc.map((x) => (x === 0n ? 0n : halfUpDiv(x, RATE_SCALE)))
}

function hashLines(ids: Int32Array, amounts: Record<BonusKey, BigInt64Array>): { hash: string; lines: number; total: bigint } {
  const h = createHash('sha256'), buf = Buffer.alloc(13 * 4096)
  let off = 0, lines = 0, total = 0n
  for (let k = 0; k < ids.length; k++) {
    BONUSES.forEach((b, bi) => {
      const amt = amounts[b][k]!
      if (amt === 0n) return
      buf.writeInt32LE(ids[k]!, off); buf.writeUInt8(bi, off + 4); buf.writeBigInt64LE(amt, off + 5)
      off += 13; lines++; total += amt
      if (off === buf.length) { h.update(buf); off = 0 }
    })
  }
  h.update(buf.subarray(0, off))
  return { hash: h.digest('hex'), lines, total }
}

function hashSummary(ids: Int32Array, v: Volumes, rank: Uint8Array): string {
  const h = createHash('sha256'), buf = Buffer.alloc(21 * 4096)
  let off = 0
  for (let k = 0; k < ids.length; k++) {
    buf.writeInt32LE(ids[k]!, off); buf.writeBigInt64LE(v.pv[k]!, off + 4); buf.writeBigInt64LE(v.gv[k]!, off + 12); buf.writeUInt8(rank[k]!, off + 20)
    off += 21
    if (off === buf.length) { h.update(buf); off = 0 }
  }
  h.update(buf.subarray(0, off))
  return h.digest('hex')
}

function capPass(plan: Plan, t: Tree, netSales: bigint, raw: Raw, final: Record<BonusKey, BigInt64Array>, capped: Set<BonusKey>): bigint | null {
  const cap = plan.companyCap
  if (!cap) return null
  const capMinor = halfUpDiv(netSales * parseRate(cap.rate), RATE_SCALE)
  const scope = BONUSES.filter((b) => cap.scope.includes(b)) // canonical bonus order
  const lineRaw: bigint[] = [], lineGroup: number[] = [], lineAt: number[] = []
  for (let k = 0; k < t.ids.length; k++) {
    scope.forEach((b, g) => {
      if (raw[b][k] === 0n) return
      lineRaw.push(raw[b][k]!); lineGroup.push(g); lineAt.push(k)
    })
  }
  const priority = (cap.priority ?? []).map((b) => scope.indexOf(b)).filter((g) => g >= 0)
  const alloc = allocateCap(capMinor, lineRaw, lineGroup, priority)
  if (!alloc) return null
  for (const b of scope) capped.add(b)
  alloc.forEach((amt, i) => { final[scope[lineGroup[i]!]!][lineAt[i]!] = amt })
  return capMinor
}

export function runEngine(snapshot: Snapshot, plan: Plan): RunResult {
  const timingsMs: Record<string, number> = {}
  let t0 = performance.now()
  const lap = (name: string): void => { const now = performance.now(); timingsMs[name] = Math.round(now - t0); t0 = now }

  const t = buildTree(snapshot); lap('tree')
  const n = t.ids.length
  const v = lineVolumes(snapshot, t); lap('volumes')
  const rank = qualify(plan, t, v); lap('qualification')

  const zero = (): bigint[] => new Array<bigint>(n).fill(0n)
  const raw: Raw = { retail: zero(), unilevel: zero(), rank_bonus: zero(), generation: zero(), matching: zero() }
  if (plan.retail) { const r = parseRate(plan.retail.rate); for (let k = 0; k < n; k++) raw.retail[k] = v.retailBase[k]! * r }
  if (plan.unilevel) unilevel(plan.unilevel, t, v, rank, raw.unilevel)
  if (plan.rankBonus) { const r = plan.rankBonus.byRank.map(parseRate); for (let k = 0; k < n; k++) raw.rank_bonus[k] = v.gv[k]! * (r[rank[k]!] ?? 0n) }
  if (plan.generation) generation(plan.generation, t, v, rank, raw.generation)
  lap('individual')
  if (plan.matching) raw.matching = matching(plan.matching, t, raw)
  lap('matching')

  for (const [b, maxMinor] of Object.entries(plan.perPayeeCap ?? {}) as [BonusKey, bigint][]) {
    const max = maxMinor * RATE_SCALE
    raw[b] = raw[b].map((x) => (x > max ? max : x))
  }
  const final = {} as Record<BonusKey, BigInt64Array>
  for (const b of BONUSES) final[b] = new BigInt64Array(n)
  const capped = new Set<BonusKey>()
  const capMinor = capPass(plan, t, v.netSales, raw, final, capped); lap('caps')
  for (const b of BONUSES) {
    if (capped.has(b)) continue
    for (let k = 0; k < n; k++) if (raw[b][k] !== 0n) final[b][k] = halfUpDiv(raw[b][k]!, RATE_SCALE) // round once per line
  }
  lap('rounding')

  const { hash, lines, total } = hashLines(t.ids, final)
  if (capMinor !== null) {
    let inScope = 0n
    for (const b of capped) for (const x of final[b]) inScope += x
    if (inScope !== capMinor) throw new Error(`invariant: capped scope ${inScope} != cap ${capMinor}`)
  }
  const summaryHash = hashSummary(t.ids, v, rank); lap('hash')
  return { positionId: t.ids, pv: v.pv, gv: v.gv, rank, amounts: final, netSalesMinor: v.netSales, capMinor, totalMinor: total, lineCount: lines, linesHash: hash, summaryHash, timingsMs }
}
