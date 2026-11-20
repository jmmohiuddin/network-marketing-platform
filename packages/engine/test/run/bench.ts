// Benchmark of runIncremental() as COMP consumes it (every chunk read once, then dropped) with the bench inputs of
// bench-input.ts (PLAN B3 S-1, TS-29 shapes). Always through the heavy-slot wrapper:
//   scripts/heavy.sh node --max-old-space-size=4096 --import tsx packages/engine/test/run/bench.ts [shape] [positions] [seed]
// shape: random (1 in 50 extends a chain, the rest attach anywhere above), binary (balanced binary tree), wide (the
// root has 50,000 direct children, the rest attach anywhere), deep (one leg 5,000 deep, the rest attach anywhere).
// The second run gets the same input shuffled; its result hash must equal the first. Prints one JSON line; every number
// in it is measured.
import { createHash } from 'node:crypto'
import { runIncremental, type RunChunk, type RunSummary } from '../../src/run.js'
import type { RunInput } from '../../src/types.js'
import { generate, rng, SHAPES, shuffled, type Shape } from './bench-input.js'
import { lineHashText } from './output-hash.js'

const shape = (process.argv[2] ?? 'random') as Shape
const positions = Number(process.argv[3] ?? 100_000)
const seed = Number(process.argv[4] ?? 20261113)
if (!SHAPES.includes(shape) || !Number.isInteger(positions) || positions < 2) throw new Error(`usage: bench.ts [${SHAPES.join('|')}] [positions] [seed]`)

const mb = (bytes: number): number => Math.round(bytes / 1048576)
const rss = (): number => mb(process.memoryUsage().rss)
const timed = <T>(f: () => T): [T, number] => {
  const t = performance.now()
  const r = f()
  return [r, Math.round(performance.now() - t)]
}

/** Drains the stream like COMP: counts and hashes each chunk, keeps none of them. */
function consume(input: RunInput): { summary: RunSummary; linesHash: string; counts: Record<RunChunk['kind'], number> } {
  const counts = { lines: 0, qualification: 0, summaries: 0, payees: 0 }
  const h = createHash('sha256')
  const stream = runIncremental(input)
  for (let next = stream.next(); ; next = stream.next()) {
    if (next.done === true) return { summary: next.value, linesHash: h.digest('hex'), counts }
    const chunk = next.value
    if (chunk.kind !== 'lines') counts[chunk.kind] += chunk.rows.length
    else {
      counts.lines += chunk.lines.length
      for (const l of chunk.lines) h.update(lineHashText(l))
    }
  }
}

const [input, generateMs] = timed(() => generate(shape, positions, seed))
const rssAfterGenerate = rss()
const [first, run1Ms] = timed(() => {
  const { summary: o, linesHash, counts } = consume(input)
  return { resultHash: o.resultHash, inputsHash: o.inputsHash, linesHash, lines: counts.lines, payees: counts.payees, grossMinor: o.controlTotals.grossMinor.toString(), breakageMinor: o.controlTotals.breakageMinor.toString(), capBound: o.capApplications[0]?.bound ?? null }
})
const rssAfterRun1 = rss()
const mix = rng(seed + 1)
const shuffledInput = { ...input, snapshot: { ...input.snapshot, positions: shuffled(input.snapshot.positions, mix), relationships: shuffled(input.snapshot.relationships, mix), orders: shuffled(input.snapshot.orders, mix) } }
const [second, run2Ms] = timed(() => consume(shuffledInput).summary.resultHash)

process.stdout.write(`${JSON.stringify({
  shape, positions, seed, orders: input.snapshot.orders.length, generateMs, run1Ms, run2Ms,
  rssMb: { afterGenerate: rssAfterGenerate, afterRun1: rssAfterRun1, end: rss(), peak: Math.round(process.resourceUsage().maxRSS / 1024) },
  run1: first, deterministic: second === first.resultHash,
})}\n`)
