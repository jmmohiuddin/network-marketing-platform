// T-B6-60 (D-B6-12, AC-S1-1): runIncremental streams exactly run()'s output, and both equal the engine before the
// streaming change (hashes in results/s1-bench.json B6.byteIdentical, measured with the B4 engine): goldens and the
// four bench shapes at 50k.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { OUTPUT_CHUNK_LINES, run, runIncremental, type RunChunk, type RunSummary } from '../../src/run.js'
import type { RunInput, RunOutput } from '../../src/types.js'
import { loadFixture, RUN_FIXTURES, type RunFixture } from '../fixtures/load.js'
import { generate } from './bench-input.js'
import { fullHashOf, linesHashOf } from './output-hash.js'

interface Hashes { readonly resultHash: string; readonly inputsHash: string; readonly linesHash: string; readonly fullHash: string }
const recorded = (JSON.parse(readFileSync(join(import.meta.dirname, '../../results/s1-bench.json'), 'utf8')) as { B6: { byteIdentical: { hashes: Record<string, Hashes> } } }).B6.byteIdentical.hashes

function drain(input: RunInput): { chunks: RunChunk[]; summary: RunSummary } {
  const chunks: RunChunk[] = []
  const stream = runIncremental(input)
  for (let next = stream.next(); ; next = stream.next()) {
    if (next.done === true) return { chunks, summary: next.value }
    chunks.push(next.value)
  }
}

const hashesOf = (o: RunOutput): Hashes => ({ resultHash: o.resultHash, inputsHash: o.inputsHash, linesHash: linesHashOf(o.lines), fullHash: fullHashOf(o) })
const KIND_ORDER: readonly RunChunk['kind'][] = ['lines', 'qualification', 'summaries', 'payees']

function expectStreamOf(input: RunInput, output: RunOutput): void {
  const { chunks, summary } = drain(input)
  const rowsOf = (kind: RunChunk['kind']): unknown[] => chunks.flatMap((c): readonly unknown[] => (c.kind !== kind ? [] : c.kind === 'lines' ? c.lines : c.rows))
  expect(rowsOf('lines')).toEqual(output.lines)
  expect(rowsOf('qualification')).toEqual(output.qualification)
  expect(rowsOf('summaries')).toEqual(output.volumeSummaries)
  expect(rowsOf('payees')).toEqual(output.payees)
  const { lines, qualification, volumeSummaries, payees, ...rest } = output
  expect(summary).toEqual(rest)
  // Kinds in order, every chunk non-empty and at most OUTPUT_CHUNK_LINES rows.
  const kinds = chunks.map((c) => KIND_ORDER.indexOf(c.kind))
  expect(kinds).toEqual([...kinds].sort((a, b) => a - b))
  for (const c of chunks) {
    const size = c.kind === 'lines' ? c.lines.length : c.rows.length
    expect(size).toBeGreaterThan(0)
    expect(size).toBeLessThanOrEqual(OUTPUT_CHUNK_LINES)
  }
}

describe('T-B6-60 runIncremental: same output as run() and as the engine before streaming', () => {
  const cases = RUN_FIXTURES.flatMap((file) => loadFixture<RunFixture>(file).cases.map((c) => ({ id: `${file}:${c.name}`, input: c.input })))

  test.each(cases)('$id', ({ id, input }) => {
    const output = run(input)
    expect(hashesOf(output)).toEqual(recorded[id])
    expectStreamOf(input, output)
  })

  test.each(['random', 'binary', 'wide', 'deep'] as const)('%s 50k (AC-S1-1): lines leave in chunks of OUTPUT_CHUNK_LINES, hashes as before', (shape) => {
    const input = generate(shape, 50_000, 20261113)
    const output = run(input)
    expect(hashesOf(output)).toEqual(recorded[`${shape}:50000`])
    expect(output.lines.length).toBeGreaterThan(OUTPUT_CHUNK_LINES * 2)
    expectStreamOf(input, output)
  }, 60_000)
})
