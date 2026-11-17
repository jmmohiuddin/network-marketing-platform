import { describe, expect, test } from 'vitest'
import { parseEngineJson, stringifyEngineJson } from '../src/json.js'
import { run } from '../src/run.js'
import type { PlanVersion, Snapshot } from '../src/types.js'
import { loadFixture, type RunFixture } from './fixtures/load.js'

const [g] = loadFixture<RunFixture>('g-e2e-01.json').cases

describe('engine JSON codec (PLAN B3 1.5)', () => {
  test('a snapshot and a plan version round-trip with every bigint restored', () => {
    const snapshot = parseEngineJson<Snapshot>(stringifyEngineJson(g!.input.snapshot))
    const plan = parseEngineJson<PlanVersion>(stringifyEngineJson(g!.input.plan))

    expect(snapshot).toEqual(g!.input.snapshot)
    expect(plan).toEqual(g!.input.plan)
    expect(run({ ...g!.input, snapshot, plan }).resultHash).toBe(run(g!.input).resultHash)
  })

  test('writes object keys in sorted order and bigint as decimal strings', () => {
    expect(stringifyEngineJson({ b: 1n, a: [{ d: -20n, c: null }] })).toBe('{"a":[{"c":null,"d":"-20"}],"b":"1"}')
  })

  test('a numeric object key is still sorted, and a large array stays linear (array indices are not collected as keys)', () => {
    const rows = Array.from({ length: 40_000 }, (_, i) => ({ id: `p${i}`, '0': i, amountMinor: BigInt(i) }))

    const text = stringifyEngineJson(rows)

    expect(text.startsWith('[{"0":0,"amountMinor":"0","id":"p0"},')).toBe(true)
    expect(parseEngineJson<typeof rows>(text)).toEqual(rows)
  }, 20_000)

  test('a full trace and the cap applications are written with every bigint as a decimal string', () => {
    const first = run(g!.input).lines[0]!
    const out = run(g!.input, { fullTraceFor: [{ payeePositionId: first.payeePositionId, ruleKey: first.ruleKey }] })
    const line = out.lines.find((l) => l.payeePositionId === first.payeePositionId && l.ruleKey === first.ruleKey)!
    const trace = JSON.parse(stringifyEngineJson(line.trace)) as { raw: unknown; sources: { raw: unknown; base: unknown }[] }
    const caps = JSON.parse(stringifyEngineJson(out.capApplications)) as { proposedRaw: unknown; capMinor: unknown }[]

    expect(out.capApplications.length).toBeGreaterThan(0)
    expect(trace.raw).toBe(line.trace.raw.toString())
    expect(trace.sources.map((s) => [s.raw, s.base])).toEqual(line.trace.sources.map((s) => [s.raw.toString(), s.base.toString()]))
    expect(caps.map((c) => [c.proposedRaw, c.capMinor])).toEqual(
      out.capApplications.map((c) => [c.proposedRaw.toString(), c.capMinor.toString()]),
    )
    expect(stringifyEngineJson(out.capApplications)).not.toMatch(/:-?\d/) // no JSON number anywhere a bigint was
  })
})
