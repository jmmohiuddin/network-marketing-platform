import { describe, expect, test } from 'vitest'
import { explain, traceAmountMinor } from '../../src/explain.js'
import { mulRate, parseDecimal, roundRaw, toRaw } from '../../src/money.js'
import { replay } from '../../src/replay.js'
import { inputsHash, run } from '../../src/run.js'
import type { AdjustmentOrigin, RunInput, RunOutput, Snapshot } from '../../src/types.js'
import { loadFixture, RUN_FIXTURES, type RunCase, type RunFixture } from '../fixtures/load.js'

const cases = RUN_FIXTURES.flatMap((file) => loadFixture<RunFixture>(file).cases.map((c) => ({ file, name: c.name, c })))
const byName = (name: string): RunCase => cases.find((x) => x.name === name)!.c
const key = (l: { payeePositionId: string; ruleKey: string; amountMinor: bigint }): string => `${l.payeePositionId}/${l.ruleKey}/${l.amountMinor}`

/** Deterministic reordering of every snapshot array whose order carries no meaning (plan arrays keep theirs). */
function shuffled(input: RunInput): RunInput {
  const mix = <T>(a: readonly T[]): T[] => {
    const r = [...a].reverse()
    return [...r.slice(1), ...r.slice(0, 1)]
  }
  const s = input.snapshot
  const snapshot: Snapshot = {
    ...s, participantTypes: mix(s.participantTypes), participants: mix(s.participants), positions: mix(s.positions), relationships: mix(s.relationships),
    orders: mix(s.orders).map((o) => ({ ...o, lines: mix(o.lines) })), orderEvents: mix(s.orderEvents), adjustments: mix(s.adjustments),
    receivables: mix(s.receivables), withholding: mix(s.withholding),
  }
  return { ...input, snapshot }
}

/** Same values, every object's keys in reverse order (test code may read keys; src may not). */
function reversedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reversedKeys) as T
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversedKeys(v)])) as T
}

function checkExpected(out: RunOutput, { name, expected }: RunCase): void {
  if (expected.lines) expect(out.lines.filter((l) => l.origin === null).map(key).sort(), name).toEqual(expected.lines.map(key).sort())
  for (const p of expected.positions ?? []) {
    const got = out.volumeSummaries.find((s) => s.positionId === p.positionId)!
    expect(got.measures, `${name} ${p.positionId}`).toEqual(expect.arrayContaining([...p.measures]))
    expect(got.paidAs, `${name} ${p.positionId}`).toEqual(expect.arrayContaining([...p.paidAs]))
  }
  for (const cap of expected.caps ?? []) {
    const got = out.capApplications.find((a) => a.capKey === cap.capKey)!
    expect({ capKey: got.capKey, bound: got.bound, baseMinor: got.baseMinor, capMinor: got.capMinor, proposedMinor: roundRaw(got.proposedRaw, 'half_up') }, name).toEqual(cap)
  }
  for (const p of expected.payees ?? []) expect(out.payees.find((x) => x.participantId === p.participantId), name).toMatchObject(p)
  if (expected.controlTotals) expect(out.controlTotals, name).toMatchObject(expected.controlTotals)
}

describe('run(): every golden run fixture end to end', () => {
  test.each(cases)('$file $name', ({ c }) => {
    const out = run(c.input)
    checkExpected(out, c)
    expect(out.controlTotals.grossMinor).toBe(out.lines.reduce((a, l) => a + l.amountMinor, 0n))
    expect(out.controlTotals.lineCount).toBe(out.lines.length)
    expect(out.lines.every((l) => l.amountMinor !== 0n)).toBe(true)
    for (const l of out.lines) {
      const e = explain(l, c.input.snapshot.market.minorDigits)
      expect(e.reconciles, `${c.name} ${key(l)}`).toBe(true)
      expect(e.lines.at(-1)).toContain(c.input.snapshot.market.currency)
    }
  })

  test.each(cases)('$file $name: result hash equal across runs and with shuffled input order', ({ c }) => {
    const first = run(c.input)
    expect(run(c.input).resultHash).toBe(first.resultHash)
    const again = run(shuffled(c.input))
    expect(again.resultHash).toBe(first.resultHash)
    expect(again.lines).toEqual(first.lines)
    expect(first.resultHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test.each(cases)('$file $name: inputs hash does not depend on snapshot row order (TS-03 replay after a reload)', ({ c }) => {
    expect(inputsHash(shuffled(c.input))).toBe(inputsHash(c.input))
  })

  test.each(cases)('$file $name: every trace source states arithmetic that holds (statement text)', ({ c }) => {
    for (const l of run(c.input).lines) {
      for (const s of l.trace.sources) {
        if (s.rate === null) continue
        let v = mulRate(s.baseScale === 'minor' ? toRaw(s.base) : s.base, parseDecimal(s.rate))
        if (s.share !== null) v = (v * s.share.num) / s.share.den
        if (s.capMinor !== null && v > toRaw(s.capMinor)) v = toRaw(s.capMinor)
        expect(v, `${c.name} ${key(l)} ${s.positionId}`).toBe(s.raw)
        if (s.orders.length > 0) expect(s.orders.reduce((a, o) => a + o.raw, 0n)).toBe(s.raw)
      }
    }
  })
})

describe('G-E2E-01 detail', () => {
  const c = byName('g-e2e-01')
  const out = run(c.input)

  test('the priority cap removes matching first, then rank bonus; breakage = removed amount', () => {
    const cap = out.capApplications[0]!
    const removed = cap.affected.reduce((a, x) => a + roundRaw(x.beforeRaw, 'half_up') - x.afterMinor, 0n)
    expect(removed).toBe(out.controlTotals.breakageMinor)
    expect(cap.affected.filter((x) => x.ruleKey === 'match').every((x) => x.afterMinor === 0n)).toBe(true)
    expect(out.lines.some((l) => l.ruleKey === 'match')).toBe(false)
    const removedBy = (ruleKey: string): bigint => cap.affected.filter((x) => x.ruleKey === ruleKey).reduce((a, x) => a + roundRaw(x.beforeRaw, 'half_up') - x.afterMinor, 0n)
    expect([removedBy('match'), removedBy('rank_bonus')]).toEqual([2650n, 750n]) // matching 26.50, rank bonus 7.50
  })

  test('control totals by rule, by source kind; withholding becomes one tax line per payee', () => {
    expect(out.controlTotals.byRule).toEqual([
      { ruleKey: 'rank_bonus', amountMinor: 25000n }, { ruleKey: 'retail', amountMinor: 13750n }, { ruleKey: 'unilevel', amountMinor: 11450n },
    ])
    expect(out.controlTotals.bySourceKind).toEqual([{ sourceKind: 'downline_volume', amountMinor: 36450n }, { sourceKind: 'retail_sale', amountMinor: 13750n }])
    expect(out.taxLines.map((t) => [t.participantId, t.ruleId, t.withheldMinor])).toEqual([['pA', 'fixture-wh-0.02', 400n], ['pB', 'fixture-wh-0.02', 476n], ['pC', 'fixture-wh-0.02', 10n], ['pD', 'fixture-wh-0.02', 119n]])
    expect(out.controlTotals).toMatchObject({ residueMinor: 0n, adjustmentsByOrigin: [], payeeCount: 4 })
    expect(out.warnings.filter((w) => w.code === 'NO_WITHHOLDING_RULE')).toEqual([])
  })

  test('lines are sorted by payee position id, pass, rule key', () => {
    expect(out.lines.map((l) => `${l.payeePositionId}/${l.pass}/${l.ruleKey}`)).toEqual(['A/4/rank_bonus', 'A/4/unilevel', 'B/4/rank_bonus', 'B/4/retail', 'B/4/unilevel', 'C/4/rank_bonus', 'D/4/rank_bonus', 'D/4/retail'])
  })

  test('a capped line explains every step down to its amount', () => {
    const line = out.lines.find((l) => l.payeePositionId === 'A' && l.ruleKey === 'rank_bonus')!
    const e = explain(line, 2)
    expect(e.reconciles).toBe(true)
    expect(e.lines.some((t) => t.startsWith('cap cap_leaders (priority)'))).toBe(true)
    expect(e.lines.at(-1)).toBe('amount 121.36 XXX')
  })

  test('BUG-092: the tree instant prints as an ISO-8601 UTC instant with microseconds', () => {
    const line = out.lines.find((l) => l.trace.tree !== null)!
    const at = (knownAtUs: bigint): string => explain({ ...line, trace: { ...line.trace, tree: { kind: 'sponsor', knownAtUs } } }, 2).lines[0]!
    expect(at(1_700_000_000_123_456n)).toContain('sponsor tree known at 2023-11-14T22:13:20.123456Z')
    expect(at(0n)).toContain('known at 1970-01-01T00:00:00.000000Z')
    expect(at(951_782_400_000_001n)).toContain('known at 2000-02-29T00:00:00.000001Z')
    expect(at(-1n)).toContain('known at 1969-12-31T23:59:59.999999Z')
  })
})

describe('pass 9 adjustments and pass 11 settlement', () => {
  const restated = byName('restated')
  const adjustment = (payee: string, ruleKey: string, amountMinor: bigint, originId: string): AdjustmentOrigin => ({ originType: 'restatement', originId, payeePositionId: payee, ruleKey, sourceKind: ruleKey === 'match' ? 'match' : 'downline_volume', amountMinor, originalPeriodId: '2027-02', reasonCode: 'TS-10' })
  // TS-10 restatement diff (restated - paid): A rank bonus 15.00 - 80.00, C match 3.00 - 16.00.
  const input: RunInput = { ...restated.input, snapshot: { ...restated.input.snapshot, adjustments: [adjustment('A', 'rank_bonus', -6500n, 'rs-A'), adjustment('C', 'match', -1300n, 'rs-C')] } }
  const out = run(input)

  test('TS-10 restatement diff = restated run - paid run: A -65.00, C -13.00 (the pass-9 origins above)', () => {
    const paid = run(byName('paid').input)
    const restatedOut = run(restated.input)
    const amount = (o: RunOutput, payee: string): bigint => o.lines.find((l) => l.payeePositionId === payee)!.amountMinor
    expect([amount(restatedOut, 'A') - amount(paid, 'A'), amount(restatedOut, 'C') - amount(paid, 'C')]).toEqual([-6500n, -1300n])
  })

  test('each origin becomes one line in pass 9, linked to its origin, counted by origin type', () => {
    expect(out.lines.map((l) => [l.payeePositionId, l.pass, l.ruleKey, l.amountMinor, l.origin?.originId ?? null])).toEqual([
      ['A', 4, 'rank_bonus', 1500n, null], ['A', 9, 'rank_bonus', -6500n, 'rs-A'], ['C', 5, 'match', 300n, null], ['C', 9, 'match', -1300n, 'rs-C'],
    ])
    expect(out.controlTotals.adjustmentsByOrigin).toEqual([{ originType: 'restatement', amountMinor: -7800n }])
    expect(out.controlTotals.grossMinor).toBe(-6000n)
    expect(out.lines.every((l) => explain(l, 2).reconciles)).toBe(true)
  })

  test('a negative gross is never a negative payable: it becomes receivable (BR-REV-09)', () => {
    expect(out.payees.find((p) => p.participantId === 'pA')).toMatchObject({ grossMinor: -5000n, nettedMinor: -5000n, withheldMinor: 0n, netPayableMinor: 0n, receivableAfterMinor: 5000n })
  })

  test('an origin is consumed once: a duplicate is refused', () => {
    const twice = { ...input, snapshot: { ...input.snapshot, adjustments: [...input.snapshot.adjustments, input.snapshot.adjustments[0]!] } }
    expect(() => run(twice)).toThrow('INVALID_INPUT')
  })

  test('no withholding instruction: zero withheld, no tax line, NO_WITHHOLDING_RULE warning', () => {
    const c = byName('ts22')
    const o = run({ ...c.input, snapshot: { ...c.input.snapshot, withholding: [] } })
    expect(o.payees[0]).toMatchObject({ grossMinor: 40000n, withheldMinor: 0n, netPayableMinor: 40000n })
    expect(o.taxLines).toEqual([])
    expect(o.warnings).toEqual([expect.objectContaining({ code: 'NO_WITHHOLDING_RULE', ref: 'P1' })])
  })

  test('a position terminated before the period earns nothing (TR-ENG-16)', () => {
    const c = byName('ts22')
    const positions = c.input.snapshot.positions.map((p) => (p.positionId === 'X3' ? { ...p, status: 'terminated' as const, statusFromUs: c.input.snapshot.period.startsAtUs } : p))
    const o = run({ ...c.input, snapshot: { ...c.input.snapshot, positions } })
    expect(o.lines.map((l) => l.payeePositionId)).toEqual(['X1', 'X2'])
  })
})

describe('inputs hash and replay (FR-COMP-008, TS-03)', () => {
  const c = byName('g-e2e-01')
  const committed = run(c.input)

  test('inputs hash ignores object key order but not values', () => {
    expect(inputsHash(reversedKeys(c.input))).toBe(committed.inputsHash)
    const changed = { ...c.input, settings: { ...c.input.settings, settingsVersionId: 'other' } }
    expect(inputsHash(changed)).not.toBe(committed.inputsHash)
  })

  test('replay of the same inputs matches; changed inputs or a changed result are reported', () => {
    expect(replay(c.input, committed)).toMatchObject({ status: 'match', resultHash: committed.resultHash })
    const order = c.input.snapshot.orders[0]!
    const corrected = { ...c.input, snapshot: { ...c.input.snapshot, orders: [{ ...order, lines: [{ ...order.lines[0]!, amountMinor: order.lines[0]!.amountMinor + 1n }] }, ...c.input.snapshot.orders.slice(1)] } }
    expect(replay(corrected, committed)).toMatchObject({ status: 'inputs_differ', resultHash: null })
    expect(replay(c.input, { ...committed, resultHash: '0'.repeat(64) }).status).toBe('result_differs')
  })

  test('the trace check fails a tampered line', () => {
    const line = committed.lines[0]!
    expect(traceAmountMinor(line.trace)).toBe(line.amountMinor)
    expect(explain({ ...line, amountMinor: line.amountMinor + 1n }, 2).reconciles).toBe(false)
  })
})
