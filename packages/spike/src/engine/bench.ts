// Engine benchmark: node --max-old-space-size=<MB> --import tsx packages/spike/src/engine/bench.ts <positions> [random|deepleg] [seed]
// Always launch through scripts/heavy.sh. Prints one JSON line; every number in it is measured.
import { BENCH_PLAN, generate, shuffle, type Shape } from './generate.js'
import { runEngine } from './run.js'

const positions = Number(process.argv[2])
const shape = (process.argv[3] ?? 'random') as Shape
const seed = Number(process.argv[4] ?? 20261112)
if (!Number.isInteger(positions) || positions < 1) throw new Error('usage: bench.ts <positions> [random|deepleg] [seed]')
if (shape !== 'random' && shape !== 'deepleg') throw new Error(`unknown shape ${shape}`)

const mb = (bytes: number): number => Math.round(bytes / 1048576)
const rss = (): number => mb(process.memoryUsage().rss)
const timed = <T>(f: () => T): [T, number] => { const t = performance.now(); const r = f(); return [r, Math.round(performance.now() - t)] }

const [snapshot, generateMs] = timed(() => generate(positions, seed, shape))
const rssAfterGenerate = rss()
// Keep only the run-1 summary so its result arrays can be collected before run 2.
const [run1, run1Ms] = timed(() => {
  const r = runEngine(snapshot, BENCH_PLAN)
  return { linesHash: r.linesHash, summaryHash: r.summaryHash, totalMinor: r.totalMinor.toString(), lineCount: r.lineCount, capMinor: r.capMinor?.toString() ?? null, netSalesMinor: r.netSalesMinor.toString(), timingsMs: r.timingsMs, maxRank: r.rank.reduce((a, b) => Math.max(a, b), 0) }
})
const rssAfterRun1 = rss()
const [shuffled, shuffleMs] = timed(() => shuffle(snapshot, seed + 1))
const [second, run2Ms] = timed(() => runEngine(shuffled, BENCH_PLAN))

process.stdout.write(JSON.stringify({
  positions, shape, seed, orderLines: snapshot.linePositionId.length,
  generateMs, run1Ms, shuffleMs, run2Ms,
  rssMb: { afterGenerate: rssAfterGenerate, afterRun1: rssAfterRun1, end: rss(), peak: Math.round(process.resourceUsage().maxRSS / 1024) },
  heapLimitMb: mb((await import('node:v8')).getHeapStatistics().heap_size_limit),
  run1,
  deterministic: second.linesHash === run1.linesHash && second.summaryHash === run1.summaryHash && second.totalMinor.toString() === run1.totalMinor,
}) + '\n')
