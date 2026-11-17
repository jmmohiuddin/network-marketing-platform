// Benchmark of run() with the G-E2E-01 plan (retail, unilevel, rank bonus, matching, priority cap, withholding) plus one
// measure.derived expression measure (PLAN B3 S-1, TS-29 shapes). Always through the heavy-slot wrapper:
//   scripts/heavy.sh node --max-old-space-size=4096 --import tsx packages/engine/test/run/bench.ts [shape] [positions] [seed]
// shape: random (1 in 50 extends a chain, the rest attach anywhere above), binary (balanced binary tree), wide (the
// root has 50,000 direct children, the rest attach anywhere), deep (one leg 5,000 deep, the rest attach anywhere).
// The second run gets the same input shuffled; its result hash must equal the first. Prints one JSON line; every number
// in it is measured.
import { run } from '../../src/run.js'
import type { Order, Participant, Position, Relationship, RunInput } from '../../src/types.js'
import { loadFixture, type RunFixture } from '../fixtures/load.js'

const SHAPES = ['random', 'binary', 'wide', 'deep'] as const
type Shape = (typeof SHAPES)[number]
const WIDE_CHILDREN = 50_000
const DEEP_LEG = 5_000
const shape = (process.argv[2] ?? 'random') as Shape
const positions = Number(process.argv[3] ?? 100_000)
const seed = Number(process.argv[4] ?? 20261113)
if (!SHAPES.includes(shape) || !Number.isInteger(positions) || positions < 2) throw new Error(`usage: bench.ts [${SHAPES.join('|')}] [positions] [seed]`)

/** mulberry32: deterministic test data, never used by the engine. */
function rng(s: number): () => number {
  let a = s >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Sponsor of position i (> 0) for the shape. */
function parentOf(shape: Shape, i: number, rand: () => number): number {
  const anywhere = Math.floor(rand() * i)
  switch (shape) {
    case 'random':
      return i % 50 === 0 ? i - 1 : anywhere
    case 'binary':
      return Math.floor((i - 1) / 2)
    case 'wide':
      return i <= WIDE_CHILDREN ? 0 : anywhere
    case 'deep':
      return i <= DEEP_LEG ? i - 1 : anywhere
  }
}

/** Fisher-Yates with the test rng: the same rows in another order. */
function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function generate(n: number, s: number): RunInput {
  const base = loadFixture<RunFixture>('g-e2e-01.json').cases[0]!.input
  const { period, knownAtUs } = base.snapshot
  const rand = rng(s)
  const id = (i: number): string => `P${String(i).padStart(7, '0')}`
  const since = period.startsAtUs - 86_400_000_000n * 400n
  const participants: Participant[] = [{ participantId: 'K', typeCode: 'customer', enrolledAtUs: since, facts: [] }]
  const positionsOut: Position[] = []
  const relationships: Relationship[] = []
  const orders: Order[] = []
  const line = (amountMinor: bigint): Order['lines'] => [{ lineId: '1', productId: 'SKU', itemClass: 'product', category: 'general', quantity: 1, amountMinor, taxMinor: 0n, volumes: [] }]
  for (let i = 0; i < n; i++) {
    participants.push({ participantId: `p${id(i)}`, typeCode: 'distributor', enrolledAtUs: since, facts: [] })
    positionsOut.push({ positionId: id(i), ownerParticipantId: `p${id(i)}`, status: 'active', statusFromUs: since })
    if (i > 0) relationships.push({ kind: 'sponsor', parentPositionId: id(parentOf(shape, i, rand)), childPositionId: id(i), leg: null, validFromUs: since, validToUs: null, recordedAtUs: since, supersededAtUs: null })
    const at = period.startsAtUs + 86_400_000_000n
    orders.push({ orderId: `o${id(i)}`, buyerParticipantId: `p${id(i)}`, buyerTypeCode: 'distributor', purpose: 'personal', creditPositionId: id(i), creditedAtUs: at, lines: line(BigInt(Math.floor(rand() * 60_000)) + 1n) })
    if (i % 3 === 0) orders.push({ orderId: `c${id(i)}`, buyerParticipantId: 'K', buyerTypeCode: 'customer', purpose: 'customer', creditPositionId: id(i), creditedAtUs: at, lines: line(BigInt(Math.floor(rand() * 30_000)) + 1n) })
  }
  const withholding = participants.slice(1).map((p) => ({ participantId: p.participantId, ruleId: 'bench-wh', rate: '0.02', rounding: 'half_up' as const }))
  const derived = { kind: 'measure.derived' as const, key: 'capped_pv', expr: { op: 'min' as const, args: [{ measure: 'pv' }, { const: '50000' }] } }
  const plan = { ...base.plan, measures: [...base.plan.measures, derived] }
  return { ...base, plan, snapshot: { ...base.snapshot, snapshotId: `bench-${shape}-${n}`, knownAtUs, participants, positions: positionsOut, relationships, orders, withholding } }
}

const mb = (bytes: number): number => Math.round(bytes / 1048576)
const rss = (): number => mb(process.memoryUsage().rss)
const timed = <T>(f: () => T): [T, number] => {
  const t = performance.now()
  const r = f()
  return [r, Math.round(performance.now() - t)]
}

const [input, generateMs] = timed(() => generate(positions, seed))
const rssAfterGenerate = rss()
const [first, run1Ms] = timed(() => {
  const o = run(input)
  return { resultHash: o.resultHash, inputsHash: o.inputsHash, lines: o.lines.length, payees: o.payees.length, grossMinor: o.controlTotals.grossMinor.toString(), breakageMinor: o.controlTotals.breakageMinor.toString(), capBound: o.capApplications[0]?.bound ?? null }
})
const rssAfterRun1 = rss()
const mix = rng(seed + 1)
const shuffledInput = { ...input, snapshot: { ...input.snapshot, positions: shuffled(input.snapshot.positions, mix), relationships: shuffled(input.snapshot.relationships, mix), orders: shuffled(input.snapshot.orders, mix) } }
const [second, run2Ms] = timed(() => run(shuffledInput).resultHash)

process.stdout.write(`${JSON.stringify({
  shape, positions, seed, orders: input.snapshot.orders.length, generateMs, run1Ms, run2Ms,
  rssMb: { afterGenerate: rssAfterGenerate, afterRun1: rssAfterRun1, end: rss(), peak: Math.round(process.resourceUsage().maxRSS / 1024) },
  run1: first, deterministic: second === first.resultHash,
})}\n`)
