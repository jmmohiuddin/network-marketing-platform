import { describe, expect, test } from 'vitest'
import { RAW_SCALE, roundRaw, toRaw } from '../../src/money.js'
import type { Done, RunContext } from '../../src/pipeline.js'
import { allocateCap, capAmountMinor, capPass, constraintPass, orderStructureBaseRaw } from '../../src/primitives/caps.js'
import { buildTree, positionOrder } from '../../src/tree.js'
import type { CapBase, CapRule, ParticipantConstraint, RawLine, TraceSource } from '../../src/types.js'
import { loadFixture } from '../fixtures/load.js'

interface FixtureLine { readonly payeePositionId: string; readonly ruleKey: string; readonly amountMinor: bigint }
interface CapCase { readonly name: string; readonly lines: readonly FixtureLine[]; readonly baseMinor: bigint; readonly rate: string; readonly method: CapRule['method']; readonly expected: { readonly capMinor: bigint; readonly naiveScaledTotalMinor?: bigint; readonly lines: readonly FixtureLine[] } }
interface Ts09Case { readonly firstMinor: bigint; readonly secondMinor: bigint; readonly netSalesMinor: bigint; readonly inScopeMinor: bigint; readonly outOfScopeMinor: bigint; readonly base: Extract<CapBase, { kind: 'order_structure' }>; readonly rate: string; readonly expected: { readonly baseMinor: bigint; readonly capMinor: bigint; readonly factor4dp: string; readonly outOfScopeMinor: bigint } }

function allocate(c: CapCase): bigint[] | null {
  const keys = [...new Set(c.lines.map((l) => l.ruleKey))]
  const priority = c.method.type === 'priority' ? c.method.reduce.map((k) => keys.indexOf(k)) : []
  return allocateCap(capAmountMinor(toRaw(c.baseMinor), c.rate, 'half_up'), c.lines.map((l) => toRaw(l.amountMinor)), c.lines.map((l) => keys.indexOf(l.ruleKey)), priority, 'half_up')
}

describe('cap allocation (caps.json: TS-07, TS-08)', () => {
  const { cases } = loadFixture<{ cases: CapCase[] }>('caps.json')

  test.each(cases)('$name', (c) => {
    expect(capAmountMinor(toRaw(c.baseMinor), c.rate, 'half_up')).toBe(c.expected.capMinor)
    const out = allocate(c)
    expect(out).toEqual(c.expected.lines.map((l) => l.amountMinor))
    expect(out!.reduce((a, v) => a + v, 0n)).toBe(c.expected.capMinor)
  })

  test('TS-07: largest remainder hits the cap exactly where naive per-line rounding overshoots', () => {
    const c = cases.find((x) => x.name === 'ts07-proportional')!
    const proposed = c.lines.reduce((a, l) => a + l.amountMinor, 0n)
    expect(proposed).toBe(940393n) // proposed 9,403.93
    const naive = c.lines.reduce((a, l) => a + roundRaw((toRaw(l.amountMinor) * c.expected.capMinor) / proposed, 'half_up'), 0n)
    expect(naive).toBe(c.expected.naiveScaledTotalMinor)
  })

  test('does not bind at or below the cap', () => {
    expect(allocateCap(100n, [toRaw(60n), toRaw(40n)], [0, 1], [], 'half_up')).toBeNull()
  })

  test('priority: a listed bonus loses all, then the rest is reduced proportionally', () => {
    // cap 100; match 30 (listed) goes to 0, then 120 of rank bonus scaled to 100 by largest remainder.
    expect(allocateCap(100n, [toRaw(70n), toRaw(30n), toRaw(50n)], [0, 1, 0], [1], 'half_up')).toEqual([58n, 0n, 42n])
  })
})

describe('order-structure cap base (ts09-order-structure-cap.json: TS-09)', () => {
  const [c] = loadFixture<{ cases: Ts09Case[] }>('ts09-order-structure-cap.json').cases
  const base = orderStructureBaseRaw(c!.base, c!.firstMinor, c!.secondMinor)

  test('base 1.5 x first because second/(first+second) > 1/3; cap = r2(base x rate)', () => {
    expect(base).toBe(toRaw(c!.expected.baseMinor))
    expect(c!.expected.baseMinor * 10n < c!.netSalesMinor * 8n).toBe(true) // 75% of net sales, below 80%
    expect(capAmountMinor(base, c!.rate, 'half_up')).toBe(c!.expected.capMinor)
  })

  test('below the share threshold the base is first + second', () => {
    expect(orderStructureBaseRaw(c!.base, 60n, 30n)).toBe(toRaw(90n)) // 30/90 = 1/3 is not above 1/3
    expect(orderStructureBaseRaw(c!.base, 0n, 0n)).toBe(0n)
  })

  test('capPass scales only in-scope lines (factor 0.9210); out-of-scope untouched', () => {
    const cap: CapRule = { key: 'cap', scope: ['in'], base: { ...c!.base, first: 'g1', second: 'g2' }, rate: c!.rate, method: { type: 'proportional' }, residue: 'breakage' }
    const { ctx } = context(['P'], ['in', 'out'], { caps: [cap] })
    const lines = [line('P', 'in', toRaw(c!.inScopeMinor)), line('P', 'out', toRaw(c!.outOfScopeMinor))]
    const volumes = { byMeasure: new Map(), marketTotal: new Map([['g1', c!.firstMinor], ['g2', c!.secondMinor]]) }
    const out = capPass(ctx, { constraints: { lines, applications: [] }, volumes } as unknown as Done<'caps'>)
    expect(out.lines[0]!.allocatedMinor).toBe(c!.expected.capMinor)
    expect(((c!.expected.capMinor * 10000n * 2n + c!.inScopeMinor) / (c!.inScopeMinor * 2n)).toString()).toBe(c!.expected.factor4dp.replace('0.', ''))
    expect(out.lines[1]).toBe(lines[1])
    expect(out.lines[1]!.raw).toBe(toRaw(c!.expected.outOfScopeMinor))
    expect(out.applications).toEqual([expect.objectContaining({ capKey: 'cap', bound: true, baseMinor: c!.expected.baseMinor, capMinor: c!.expected.capMinor, proposedRaw: toRaw(c!.inScopeMinor) })])
    expect(out.lines[0]!.trace.steps).toEqual([{ step: 'cap', key: 'cap', method: 'proportional', beforeRaw: toRaw(c!.inScopeMinor), afterMinor: c!.expected.capMinor }])
  })
})

// ---------- hand-built pass contexts ----------

function context(positionIds: string[], bonusKeys: string[], plan: { caps?: CapRule[]; constraints?: ParticipantConstraint[] }, owners?: Record<string, string>): { ctx: RunContext } {
  const ids = positionOrder(positionIds)
  const at = { validAtUs: 0n, knownAtUs: 0n }
  const ctx = {
    input: { plan: { bonuses: bonusKeys.map((key) => ({ key })), caps: plan.caps ?? [], constraints: plan.constraints ?? [] }, settings: { roundingMode: 'half_up' } },
    trees: { sponsor: buildTree(ids, [], 'sponsor', at), placement: buildTree(ids, [], 'placement', at) },
    ownerOf: ids.map((id) => owners?.[id] ?? `p-${id}`),
  } as unknown as RunContext
  return { ctx }
}

function line(payee: string, ruleKey: string, raw: bigint, purposeRaw: RawLine['purposeRaw'] = []): RawLine {
  const src: TraceSource[] = [{ positionId: null, level: null, measure: null, ruleKey: null, base: raw, baseScale: 'raw', rate: null, share: null, capMinor: null, raw, orders: [], compressedOver: [] }]
  return {
    payeePositionId: payee, ruleKey, kind: 'pay.flat', sourceKind: 'other', pass: 4, unit: 'currency', reversalPolicy: 'order_line', origin: null, raw, allocatedMinor: null, purposeRaw,
    trace: { rule: ruleKey, kind: 'pay.flat', pass: 4, planVersionId: 'p', engineVersion: 'e', payeePositionId: payee, rankEvaluated: [], tree: null, sources: src, omitted: { count: 0, raw: 0n }, raw, steps: [] },
  }
}

function constrain(ctx: RunContext, individual: RawLine[]): ReturnType<typeof constraintPass> {
  return constraintPass(ctx, { individual, matching: [], pools: [] } as unknown as Done<'constraints'>)
}

describe('constraintPass (pass 7, per participant, BR-CAP-02)', () => {
  test('max_per_period caps a participant across positions and in-scope bonuses only', () => {
    const c: ParticipantConstraint = { kind: 'limit.max_per_period', key: 'max', scope: ['a', 'b'], maxMinor: 100n }
    const { ctx } = context(['X1', 'X2', 'Y'], ['a', 'b', 'c'], { constraints: [c] }, { X1: 'P', X2: 'P', Y: 'Q' })
    const lines = [line('X1', 'a', toRaw(90n)), line('X2', 'b', toRaw(60n)), line('X2', 'c', toRaw(500n)), line('Y', 'a', toRaw(100n))]
    const out = constrain(ctx, lines)
    expect(out.lines.map((l) => l.raw)).toEqual([toRaw(60n), toRaw(40n), toRaw(500n), toRaw(100n)])
    expect(out.lines[2]).toBe(lines[2])
    expect(out.lines[3]).toBe(lines[3]) // Q is at the limit, not above it
    expect(out.applications).toEqual([{ key: 'max', participantId: 'P', beforeRaw: toRaw(150n), afterRaw: toRaw(100n) }])
    expect(out.lines[0]!.trace.steps).toEqual([{ step: 'constraint', key: 'max', beforeRaw: toRaw(90n), afterRaw: toRaw(60n) }])
  })

  test('max_share_from_purpose limits pay sourced from personal-use orders to the share', () => {
    // Pay 100 = 80 from personal-use orders + 20 other; max share 0.5 => personal part 20, total 40.
    const c: ParticipantConstraint = { kind: 'limit.max_share_from_purpose', key: 'pu', scope: ['a'], purpose: 'personal', maxShare: '0.5' }
    const { ctx } = context(['X'], ['a'], { constraints: [c] })
    const l = line('X', 'a', toRaw(100n), [{ purpose: 'personal', raw: toRaw(80n) }])
    const out = constrain(ctx, [l])
    expect(out.lines[0]!.raw).toBe(toRaw(40n))
    expect(out.applications).toEqual([{ key: 'pu', participantId: 'p-X', beforeRaw: toRaw(100n), afterRaw: toRaw(40n) }])
  })

  test('max_share_from_purpose does nothing at or under the share', () => {
    const c: ParticipantConstraint = { kind: 'limit.max_share_from_purpose', key: 'pu', scope: ['a'], purpose: 'personal', maxShare: '0.5' }
    const { ctx } = context(['X'], ['a'], { constraints: [c] })
    const ok = line('X', 'a', toRaw(100n), [{ purpose: 'personal', raw: toRaw(50n) }])
    expect(constrain(ctx, [ok]).lines[0]).toBe(ok)
  })

  test('max_share_from_purpose rounds the kept total once: other 10.3 + allowed 0.3 -> 11 (half up of 10.6; truncation paid 10)', () => {
    // total 12.3 = 10.3 other + 2.0 personal; share 0.028302 -> allowed = 10.3 x 0.028302 / 0.971698 = 0.29999...
    const c: ParticipantConstraint = { kind: 'limit.max_share_from_purpose', key: 'pu', scope: ['a'], purpose: 'personal', maxShare: '0.028302' }
    const { ctx } = context(['X'], ['a'], { constraints: [c] })
    const tenths = (n: bigint): bigint => toRaw(n) / 10n
    const out = constrain(ctx, [line('X', 'a', tenths(123n), [{ purpose: 'personal', raw: tenths(20n) }])])
    expect(out.lines[0]!.raw).toBe(toRaw(11n))
  })

  test('max_per_period binds on the rounded lines: 50.5 + 49.5 under 100 would pay 51 + 50 = 101', () => {
    const c: ParticipantConstraint = { kind: 'limit.max_per_period', key: 'max', scope: ['a'], maxMinor: 100n }
    const { ctx } = context(['X1', 'X2'], ['a'], { constraints: [c] }, { X1: 'P', X2: 'P' })
    const half = RAW_SCALE / 2n
    const out = constrain(ctx, [line('X1', 'a', toRaw(50n) + half), line('X2', 'a', toRaw(49n) + half)])
    expect(out.lines.reduce((a, l) => a + (l.allocatedMinor ?? roundRaw(l.raw, 'half_up')), 0n)).toBe(100n)
    expect(out.applications).toHaveLength(1)
  })
})

describe('capPass methods', () => {
  test('per_person caps each payee at roundRaw(own measure x rate)', () => {
    const cap: CapRule = { key: 'pp', scope: ['a'], base: { kind: 'measure', measure: 'pv' }, rate: '0.5', method: { type: 'per_person' }, residue: 'breakage' }
    const { ctx } = context(['A', 'B'], ['a'], { caps: [cap] })
    const lines = [line('A', 'a', toRaw(80n)), line('B', 'a', toRaw(10n))]
    const volumes = { byMeasure: new Map([['pv', BigInt64Array.from([100n, 100n])]]), marketTotal: new Map() }
    const out = capPass(ctx, { constraints: { lines, applications: [] }, volumes } as unknown as Done<'caps'>)
    expect(out.lines[0]!.allocatedMinor).toBe(50n)
    expect(out.lines[1]).toBe(lines[1])
    expect(out.applications).toEqual([{ capKey: 'pp', method: 'per_person', baseMinor: 200n, capMinor: 100n, proposedRaw: toRaw(90n), bound: true, affected: [{ payeePositionId: 'A', ruleKey: 'a', beforeRaw: toRaw(80n), afterMinor: 50n }] }])
  })

  test('a cap the raw sum fits still binds when the rounded lines exceed it (50.5 + 49.5 under 100)', () => {
    const cap: CapRule = { key: 'c', scope: ['a'], base: { kind: 'measure', measure: 'sales' }, rate: '1', method: { type: 'proportional' }, residue: 'breakage' }
    const { ctx } = context(['A', 'B'], ['a'], { caps: [cap] })
    const half = RAW_SCALE / 2n
    const lines = [line('A', 'a', toRaw(50n) + half), line('B', 'a', toRaw(49n) + half)]
    const out = capPass(ctx, { constraints: { lines, applications: [] }, volumes: { byMeasure: new Map(), marketTotal: new Map([['sales', 100n]]) } } as unknown as Done<'caps'>)
    expect(out.lines.reduce((a, l) => a + (l.allocatedMinor ?? roundRaw(l.raw, 'half_up')), 0n)).toBe(100n)
    expect(out.applications[0]).toMatchObject({ bound: true, capMinor: 100n })
  })

  test('a non-binding cap is reported unbound and leaves every line as it was', () => {
    const cap: CapRule = { key: 'c', scope: ['a'], base: { kind: 'measure', measure: 'sales' }, rate: '1', method: { type: 'proportional' }, residue: 'breakage' }
    const { ctx } = context(['A'], ['a'], { caps: [cap] })
    const lines = [line('A', 'a', toRaw(80n))]
    const out = capPass(ctx, { constraints: { lines, applications: [] }, volumes: { byMeasure: new Map(), marketTotal: new Map([['sales', 100n]]) } } as unknown as Done<'caps'>)
    expect(out.lines[0]).toBe(lines[0])
    expect(out.applications[0]).toMatchObject({ bound: false, capMinor: 100n, affected: [] })
  })

  test('unknown scope bonus and a priority key outside the scope are refused', () => {
    const bad: CapRule = { key: 'c', scope: ['zz'], base: { kind: 'measure', measure: 'sales' }, rate: '1', method: { type: 'proportional' }, residue: 'breakage' }
    const done = { constraints: { lines: [], applications: [] }, volumes: { byMeasure: new Map(), marketTotal: new Map([['sales', 1n]]) } } as unknown as Done<'caps'>
    expect(() => capPass(context(['A'], ['a'], { caps: [bad] }).ctx, done)).toThrow('unknown bonus')
    const outside: CapRule = { ...bad, scope: ['a'], method: { type: 'priority', reduce: ['b'] } }
    expect(() => capPass(context(['A'], ['a', 'b'], { caps: [outside] }).ctx, done)).toThrow('outside the cap scope')
  })
})
