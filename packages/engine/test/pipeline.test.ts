import { describe, expect, test } from 'vitest'
import { BONUS_PASS, holdsRank, PASS_NUMBER, PASS_ORDER, runPipeline, type Done, type PassName, type PassOutputs, type PassRegistry, type RunContext } from '../src/pipeline.js'
import type { BonusKind } from '../src/types.js'
import { loadFixture, RUN_FIXTURES, type RunFixture } from './fixtures/load.js'

describe('runPipeline', () => {
  test('calls every pass once, in the SDD-07 §4 order, each seeing exactly the earlier outputs', () => {
    const calls: { name: PassName; saw: string[] }[] = []
    const stub = <K extends PassName>(name: K) => (_ctx: RunContext, done: object): PassOutputs[K] => {
      calls.push({ name, saw: Object.keys(done) })
      return { stubOf: name } as unknown as PassOutputs[K]
    }
    const registry = Object.fromEntries(PASS_ORDER.map((name) => [name, stub(name)])) as unknown as PassRegistry
    const out = runPipeline({} as RunContext, registry)

    expect(calls.map((c) => c.name)).toEqual([...PASS_ORDER])
    calls.forEach((c, i) => expect(c.saw).toEqual(PASS_ORDER.slice(0, i)))
    expect(Object.keys(out)).toEqual([...PASS_ORDER])
    expect(PASS_ORDER.map((n) => PASS_NUMBER[n])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  test('a pass cannot alter what earlier passes produced (new outputs object per pass)', () => {
    const seen: object[] = []
    const registry = Object.fromEntries(PASS_ORDER.map((name) => [name, (_c: RunContext, done: object) => { seen.push(done); return name }])) as unknown as PassRegistry
    runPipeline({} as RunContext, registry)
    expect(new Set(seen).size).toBe(PASS_ORDER.length)
  })

  test('Done<K> exposes only earlier passes (compile-time)', () => {
    const readMatching = (d: Done<'matching'>): unknown[] => [d.transition, d.individual, // @ts-expect-error pools run after matching
      d.pools]
    expect(readMatching).toBeTypeOf('function')
  })

  test('every bonus kind is assigned to pass 4, 5 or 6', () => {
    const kinds: BonusKind[] = ['pay.retail_margin', 'pay.percent_by_level', 'pay.generations', 'pay.percent_of_measure', 'pay.differential', 'pay.override', 'pay.matching', 'pay.fast_start', 'pay.flat', 'pay.one_time', 'pay.pool']
    expect(kinds.map((k) => PASS_NUMBER[BONUS_PASS[k]])).toEqual([4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 6])
  })

  test('holdsRank compares paid-as rank index; unknown ranks fail loudly', () => {
    const ctx = { input: { plan: { ladders: [{ key: 'main', ranks: [{ key: 'R1' }, { key: 'R2' }] }] } } } as unknown as RunContext
    const q = { paidAs: new Map([['main', Int16Array.from([-1, 0, 1])]]) }
    const r2 = holdsRank(ctx, q, { ladder: 'main', rank: 'R2' })
    expect([0, 1, 2].map(r2)).toEqual([false, false, true])
    expect([0, 1, 2].map(holdsRank(ctx, q, null))).toEqual([true, true, true])
    expect(() => holdsRank(ctx, q, { ladder: 'main', rank: 'R9' })).toThrow('INVALID_INPUT')
  })
})

describe('golden run fixtures are self-consistent (FR-PLN-006: expected totals equal the sum of expected lines)', () => {
  const fixtures = RUN_FIXTURES.map((file) => ({ file, fixture: loadFixture<RunFixture>(file) }))

  test.each(fixtures)('$file', ({ fixture }) => {
    for (const { name, input, expected } of fixture.cases) {
      const ids = new Set(input.snapshot.positions.map((p) => p.positionId))
      const owner = new Map(input.snapshot.positions.map((p) => [p.positionId, p.ownerParticipantId]))
      const bonusKeys = new Set(input.plan.bonuses.map((b) => b.key))
      for (const l of expected.lines ?? []) {
        expect(ids.has(l.payeePositionId), `${name}: payee ${l.payeePositionId}`).toBe(true)
        expect(bonusKeys.has(l.ruleKey), `${name}: rule ${l.ruleKey}`).toBe(true)
        expect(l.amountMinor, `${name}: zero lines are not emitted`).not.toBe(0n)
      }
      const lineSum = (expected.lines ?? []).reduce((a, l) => a + l.amountMinor, 0n)
      if (expected.controlTotals?.grossMinor !== undefined) expect(expected.controlTotals.grossMinor, name).toBe(lineSum)
      for (const p of expected.payees ?? []) {
        const gross = (expected.lines ?? []).filter((l) => owner.get(l.payeePositionId) === p.participantId).reduce((a, l) => a + l.amountMinor, 0n)
        expect(p.grossMinor, `${name}: ${String(p.participantId)} gross`).toBe(gross)
        expect((p.nettedMinor as bigint) + (p.withheldMinor as bigint) + (p.netPayableMinor as bigint), `${name}: gross = netted + withheld + net`).toBe(gross)
      }
    }
  })
})
