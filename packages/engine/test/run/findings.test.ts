// Regressions of the B engine review (findings on caps, order-line, purpose split, compression, counts, pools,
// rolling windows, settlement and duplicates), each through run() unless the finding is about one helper.
import { describe, expect, test } from 'vitest'
import { explain } from '../../src/explain.js'
import { toRaw } from '../../src/money.js'
import { inputsHash, resultHash, run } from '../../src/run.js'
import type { BonusRule, Ladder, MeasureRule, Order, OrderPurpose, ParticipantConstraint, PeriodSummary, QualificationStateRow, RunInput } from '../../src/types.js'
import { loadFixture, type RunFixture } from '../fixtures/load.js'
import { DAY, smallInput, T0 } from '../payout/context.js'

const order = (orderId: string, creditPositionId: string, v: bigint, purpose: OrderPurpose = 'personal', buyer = `p${creditPositionId}`, buyerTypeCode = 'distributor'): Order => ({
  orderId, buyerParticipantId: buyer, buyerTypeCode, purpose, creditPositionId, creditedAtUs: T0 + DAY,
  lines: [{ lineId: '1', productId: 'SKU', itemClass: 'product', category: 'general', quantity: 1, amountMinor: 0n, taxMinor: 0n, volumes: [{ name: 'v', perUnitMinor: v }] }],
})
const withSnapshot = (input: RunInput, over: Partial<RunInput['snapshot']>): RunInput => ({ ...input, snapshot: { ...input.snapshot, ...over } })
const withPlan = (input: RunInput, over: Partial<RunInput['plan']>): RunInput => ({ ...input, plan: { ...input.plan, ...over } })
const amount = (input: RunInput, payee: string, ruleKey: string): bigint => run(input).lines.find((l) => l.payeePositionId === payee && l.ruleKey === ruleKey)?.amountMinor ?? 0n
const uni = (levels: string[], over: Partial<Extract<BonusRule, { kind: 'pay.percent_by_level' }>> = {}): BonusRule =>
  ({ key: 'uni', kind: 'pay.percent_by_level', sourceKind: 'downline_volume', reversalPolicy: 'order_line', eligibleIf: null, tree: 'sponsor', measure: 'v', levels, compression: 'none', ...over })
const personalShare = (maxShare: string, scope = ['uni']): ParticipantConstraint => ({ kind: 'limit.max_share_from_purpose', key: 'pu', scope, purpose: 'personal', maxShare })
const always = (...ranks: string[]): Ladder => ({ key: 'main', ranks: ranks.map((key) => ({ key, requires: [], maintenance: null })) })

describe('limit.max_share_from_purpose reads the purpose split, never the trace (TS-31 R2)', () => {
  // P1 sponsors P2; P2 orders O2 personal 60.00 and O3 resale 40.00; unilevel 6%.
  const base = withSnapshot(withPlan(smallInput({ P1: 0n }, [['P1', 'P2']], [uni(['0.06'])]), { constraints: [personalShare('0.333333')] }), {
    orders: [order('O2', 'P2', 6000n, 'personal'), order('O3', 'P2', 4000n, 'resale')],
  })

  test('mixed purposes on one source: personal 3.60 of 6.00 binds; P1 keeps 2.40 + 1.20', () => {
    const out = run(base)
    expect(out.lines.map((l) => [l.payeePositionId, l.amountMinor])).toEqual([['P1', 360n]])
    expect(out.constraintApplications).toEqual([expect.objectContaining({ key: 'pu', participantId: 'pP1', beforeRaw: toRaw(600n), afterRaw: toRaw(360n) })])
    expect(out.lines[0]!.trace.sources[0]!.orders).toEqual([{ orderId: 'O2', raw: toRaw(360n) }, { orderId: 'O3', raw: toRaw(240n) }])
    expect(out.controlTotals.breakageMinor).toBe(240n) // removed by the limit, not earned
  })

  test('binds under restatement too: all of P1 pay is personal-use, so nothing is kept', () => {
    const input = withSnapshot(withPlan(base, { bonuses: [uni(['0.06'], { reversalPolicy: 'restatement' })] }), { orders: [order('O2', 'P2', 10000n)] })
    const out = run(input)
    expect(out.lines).toEqual([])
    expect(out.constraintApplications).toEqual([expect.objectContaining({ beforeRaw: toRaw(600n), afterRaw: 0n })])
  })

  test(`more sources than the trace keeps: the run completes and does not depend on fullTraceFor`, () => {
    const kids = Array.from({ length: 17 }, (_, i) => `C${String(i).padStart(2, '0')}`)
    const input = withPlan(smallInput(Object.fromEntries(kids.map((k) => [k, 1000n])), kids.map((k) => ['P', k] as [string, string]), [uni(['0.1'])]), { constraints: [personalShare('0.5')] })
    const compact = run(input)
    expect(compact.lines.find((l) => l.payeePositionId === 'P')).toBeUndefined() // 100% personal-use against 50%: 0 kept
    expect(compact.constraintApplications).toHaveLength(1)
    expect(run(input, { fullTraceFor: [{ payeePositionId: 'P', ruleKey: 'uni' }] }).resultHash).toBe(compact.resultHash)
  })

  test('a group-measure bonus is split by purpose as well (percent_of_measure on GV)', () => {
    const rb: BonusRule = { key: 'rb', kind: 'pay.percent_of_measure', sourceKind: 'downline_volume', reversalPolicy: 'restatement', eligibleIf: null, measure: 'gv', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.1' }] } }
    const gv: MeasureRule = { kind: 'volume.group', key: 'gv', of: 'v', tree: 'sponsor', includeSelf: true }
    const input = withPlan(base, { measures: [...base.plan.measures, gv], ladders: [always('R1')], bonuses: [rb], constraints: [personalShare('0.5', ['rb'])] })
    // P1 GV 100.00: rb 10.00, of which 6.00 personal (O2) > 50%: kept 4.00 resale + 4.00 personal = 8.00; P2 the same on its own GV.
    expect(run(input).lines.map((l) => [l.payeePositionId, l.amountMinor])).toEqual([['P1', 800n], ['P2', 800n]])
  })
})

describe('order-line reversal cites each order with its own amount (BR-REV-07, AC-20.1)', () => {
  test('aggregate measure: GV of A = O1 300.00 + O2 500.00; a full trace cites O1 30.00 and O2 50.00', () => {
    const rb: BonusRule = { key: 'rb', kind: 'pay.percent_of_measure', sourceKind: 'downline_volume', reversalPolicy: 'order_line', eligibleIf: null, measure: 'gv', byRank: { ladder: 'main', rates: [{ rank: 'R1', rate: '0.10' }] } }
    const gv: MeasureRule = { kind: 'volume.group', key: 'gv', of: 'v', tree: 'sponsor', includeSelf: true }
    const plain = smallInput({ A: 0n }, [], [rb], [always('R1')])
    const input = withSnapshot(withPlan(plain, { measures: [...plain.plan.measures, gv] }), { orders: [order('O1', 'A', 30000n), order('O2', 'A', 50000n)] })
    const full = run(input, { fullTraceFor: [{ payeePositionId: 'A', ruleKey: 'rb' }] }).lines[0]!
    expect(full.amountMinor).toBe(8000n)
    expect(full.trace.sources[0]!.orders).toEqual([{ orderId: 'O1', raw: toRaw(3000n) }, { orderId: 'O2', raw: toRaw(5000n) }])
    expect(run(input).lines[0]!.trace.sources[0]!.orders).toEqual([]) // compact: a group source may hold every order of a subtree
  })

  test('TS-10 golden from the paid run: order-line clawback A -50.00, C 0.00, leaving 30.00 / 16.00', () => {
    const paid = loadFixture<RunFixture>('ts10-refund.json').cases.find((c) => c.name === 'paid')!.input
    const input = withPlan(paid, { bonuses: paid.plan.bonuses.map((b) => ({ ...b, reversalPolicy: 'order_line' as const })) })
    const out = run(input, { fullTraceFor: [{ payeePositionId: 'A', ruleKey: 'rank_bonus' }, { payeePositionId: 'C', ruleKey: 'match' }] })
    const clawback = (payee: string): bigint => -out.lines.find((l) => l.payeePositionId === payee)!.trace.sources.flatMap((s) => s.orders).filter((o) => o.orderId === 'O2').reduce((a, o) => a + o.raw, 0n) / toRaw(1n)
    expect([clawback('A'), clawback('C')]).toEqual([-5000n, 0n])
    expect([8000n + clawback('A'), 1600n + clawback('C')]).toEqual([3000n, 1600n])
  })
})

describe('points pool converts before it splits (FR-COMP-012)', () => {
  test('100 points-minor at 0.5 over 3 holders pays 17/17/16 = 50, not 17 x 3', () => {
    const rule: BonusRule = { key: 'pool', kind: 'pay.pool', sourceKind: 'pool', reversalPolicy: 'restatement', eligibleIf: null, baseMeasure: 'v', rate: '0.01', allocation: { type: 'first_n', n: 3, orderBy: 'v' } }
    const plain = smallInput({ A: 0n, B: 0n, C: 0n, X: 10000n }, [], [rule])
    const points: MeasureRule = { ...(plain.plan.measures[0] as Extract<MeasureRule, { kind: 'volume.personal' }>), unit: 'points' }
    const out = run(withPlan(plain, { measures: [points], pointsToCurrency: [{ marketId: 'MKT', effectiveFromUs: 0n, factor: '0.5' }] }))
    expect(out.lines.map((l) => [l.payeePositionId, l.amountMinor])).toEqual([['A', 17n], ['B', 17n], ['X', 16n]])
    expect(out.lines.every((l) => explain(l, 2).reconciles)).toBe(true)
  })

  test('a pool part without holders is reported as breakage', () => {
    const rule: BonusRule = { key: 'pool', kind: 'pay.pool', sourceKind: 'pool', reversalPolicy: 'restatement', eligibleIf: null, baseMeasure: 'v', rate: '0.1', allocation: { type: 'shares', ladder: 'main', shares: [{ rank: 'R2', shares: 1 }] } }
    const ladder: Ladder = { key: 'main', ranks: [{ key: 'R1', requires: [], maintenance: null }, { key: 'R2', requires: [{ kind: 'measure', measure: 'v', atLeastMinor: 10n ** 9n, window: { type: 'period' }, maxPerLegShare: null }], maintenance: null }] }
    const out = run(smallInput({ A: 1000n }, [], [rule], [ladder]))
    expect(out.lines).toEqual([])
    expect(out.controlTotals.breakageMinor).toBe(100n)
  })
})

describe('tree-walking bonuses take personal measures only (TS-43)', () => {
  // A -> B -> C; v A 10.00, B 50.00, C 10.00; R15 v >= 50.00, R21 gv >= 70.00
  const gv: MeasureRule = { kind: 'volume.group', key: 'gv', of: 'v', tree: 'sponsor', includeSelf: true }
  const ladder: Ladder = {
    key: 'main', ranks: [
      { key: 'R15', requires: [{ kind: 'measure', measure: 'v', atLeastMinor: 5000n, window: { type: 'period' }, maxPerLegShare: null }], maintenance: null },
      { key: 'R21', requires: [{ kind: 'measure', measure: 'gv', atLeastMinor: 7000n, window: { type: 'period' }, maxPerLegShare: null }], maintenance: null },
    ],
  }
  const diff = (measure: string): BonusRule => ({ key: 'diff', kind: 'pay.differential', sourceKind: 'downline_volume', reversalPolicy: 'restatement', eligibleIf: null, tree: 'sponsor', measure, byRank: { ladder: 'main', rates: [{ rank: 'R15', rate: '0.15' }, { rank: 'R21', rate: '0.21' }] } })
  const input = (measure: string): RunInput => {
    const plain = smallInput({ A: 1000n, B: 5000n, C: 1000n }, [['A', 'B'], ['B', 'C']], [diff(measure)], [ladder])
    return withPlan(plain, { measures: [...plain.plan.measures, gv] })
  }

  test('three levels on personal volume: A earns (21% - 15%) x B breakaway 6,000 = 360 (minor)', () => {
    expect(amount(input('v'), 'A', 'diff')).toBe(360n)
  })

  test('a group measure is refused: the walk would count the downline twice (A 420 instead of 360)', () => {
    expect(() => run(input('gv'))).toThrow(/must be volume.personal/)
    const override: BonusRule = { key: 'ovr', kind: 'pay.override', sourceKind: 'downline_volume', reversalPolicy: 'restatement', eligibleIf: null, tree: 'sponsor', measure: 'gv', rate: '0.03', levels: 2 }
    expect(() => run(withPlan(input('v'), { bonuses: [override] }))).toThrow(/must be volume.personal/)
  })
})

describe('dynamic compression skips positions that may not earn (TR-ENG-16)', () => {
  test('a terminated position keeping R1 by grace is compressed: P0 = 8% x 1,000.00 + 5% x 4,000.00 = 280.00', () => {
    const ladder: Ladder = { key: 'main', ranks: [{ key: 'R1', requires: [{ kind: 'measure', measure: 'v', atLeastMinor: 1n, window: { type: 'period' }, maxPerLegShare: null }], maintenance: { gracePeriods: 1 } }] }
    const rule = uni(['0.08', '0.05', '0.04'], { eligibleIf: { ladder: 'main', rank: 'R1' }, compression: 'dynamic' })
    const plain = smallInput({ P0: 100n, L1: 100000n, L2: 0n, L3: 400000n }, [['P0', 'L1'], ['L1', 'L2'], ['L2', 'L3']], [rule], [ladder])
    const row = (positionId: string): QualificationStateRow => ({ positionId, paidAs: [{ ladder: 'main', rank: 'R1' }], titles: [{ ladder: 'main', rank: 'R1' }], graceUsed: [{ ladder: 'main', periods: 0 }], counters: [], carry: [], oneTimeFlags: [], banked: [] })
    const input = withSnapshot(plain, {
      positions: plain.snapshot.positions.map((p) => (p.positionId === 'L2' ? { ...p, status: 'terminated' as const, statusFromUs: T0 - DAY } : p)),
      priorState: { planVersionId: plain.plan.planVersionId, periodId: 'prev', positions: ['P0', 'L1', 'L2', 'L3'].map(row) },
    })
    expect(amount(input, 'P0', 'uni')).toBe(28000n)
  })
})

describe('count.customers counts the servicing position only (BR-ATT-04 roll-up shares do not count)', () => {
  test('A sponsors B; K1 orders 100.00 through B, split 70/30: A 0 customers, B 1', () => {
    const cc: MeasureRule = { kind: 'count.customers', key: 'cc', measure: 'v', minPerCustomerMinor: 1n }
    const plain = smallInput({ A: 0n }, [['A', 'B']], [])
    const input = withSnapshot(withPlan(plain, { measures: [...plain.plan.measures, cc], customerRollUp: { measures: ['v'], shares: [{ level: 0, share: '0.7' }, { level: 1, share: '0.3' }] } }), {
      participantTypes: [...plain.snapshot.participantTypes, { code: 'customer', canEarn: false, countsAsEndCustomer: true, canSponsor: false, canHoldPositions: false }],
      participants: [...plain.snapshot.participants, { participantId: 'K1', typeCode: 'customer', enrolledAtUs: 0n, facts: [] }],
      orders: [order('OK1', 'B', 10000n, 'customer', 'K1', 'customer')],
    })
    const counts = run(input).volumeSummaries.map((s) => [s.positionId, s.measures.find((m) => m.measure === 'cc')!.valueMinor])
    expect(counts).toEqual([['A', 0n], ['B', 1n]])
  })

  test('roll-up ties go to the lower position id (MONEY I-11): 0.01 split 50/50 between B (level 0) and its sponsor A', () => {
    const plain = smallInput({ A: 0n }, [['A', 'B']], [])
    const input = withSnapshot(withPlan(plain, { customerRollUp: { measures: ['v'], shares: [{ level: 0, share: '0.5' }, { level: 1, share: '0.5' }] } }), {
      participantTypes: [...plain.snapshot.participantTypes, { code: 'customer', canEarn: false, countsAsEndCustomer: true, canSponsor: false, canHoldPositions: false }],
      participants: [...plain.snapshot.participants, { participantId: 'K1', typeCode: 'customer', enrolledAtUs: 0n, facts: [] }],
      orders: [order('OK1', 'B', 1n, 'customer', 'K1', 'customer')],
    })
    expect(run(input).volumeSummaries.map((s) => [s.positionId, s.measures[0]!.valueMinor])).toEqual([['A', 1n], ['B', 0n]])
  })
})

describe('rolling windows use exactly the n contiguous periods (TS-63)', () => {
  test('a missing period in history is refused instead of widening the window', () => {
    const ladder: Ladder = { key: 'main', ranks: [{ key: 'R1', requires: [{ kind: 'measure', measure: 'v', atLeastMinor: 400n, window: { type: 'rolling', periods: 4 }, maxPerLegShare: null }], maintenance: null }] }
    const period = (back: bigint): PeriodSummary => ({ periodId: `m-${back}`, startsAtUs: T0 - 30n * DAY * (back + 1n), endsAtUs: T0 - 30n * DAY * back, positions: [{ positionId: 'A', measures: [{ measure: 'v', valueMinor: 100n }], paidAs: [] }] })
    const plain = smallInput({ A: 100n }, [], [], [ladder])
    expect(() => run(withSnapshot(plain, { history: [period(1n), period(2n), period(3n)] }))).toThrow(/contiguous/)
    expect(run(withSnapshot(plain, { history: [period(0n), period(1n), period(2n)] })).volumeSummaries[0]!.paidAs).toEqual([{ ladder: 'main', rank: 'R1' }])
  })

  test('a position repeated in one history period is refused', () => {
    const ladder: Ladder = { key: 'main', ranks: [{ key: 'R1', requires: [{ kind: 'measure', measure: 'v', atLeastMinor: 400n, window: { type: 'rolling', periods: 2 }, maxPerLegShare: null }], maintenance: null }] }
    const row = { positionId: 'A', measures: [{ measure: 'v', valueMinor: 100n }], paidAs: [] }
    const plain = smallInput({ A: 100n }, [], [], [ladder])
    expect(() => run(withSnapshot(plain, { history: [{ periodId: 'm', startsAtUs: T0 - 30n * DAY, endsAtUs: T0, positions: [row, row] }] }))).toThrow(/repeats a position/)
  })
})

describe('settlement: netting first, withholding on what remains (provisional reading, MONEY O-5)', () => {
  test('TS-38 with a receivable of 234.56: netted 234.56, taxable 1,000.00, withheld 20.00, payable 980.00', () => {
    const c = loadFixture<RunFixture>('ts38-withholding.json').cases[0]!.input
    const out = run(withSnapshot(c, { receivables: [{ participantId: 'P1', amountMinor: 23456n }] }))
    expect(out.payees[0]).toMatchObject({ grossMinor: 123456n, nettedMinor: 23456n, taxableMinor: 100000n, withheldMinor: 2000n, netPayableMinor: 98000n, receivableAfterMinor: 0n })
    expect(out.taxLines).toEqual([{ participantId: 'P1', ruleId: 'fixture-wh-0.02', taxableMinor: 100000n, withheldMinor: 2000n }])
  })
})

describe('duplicate snapshot rows that would be applied twice or by input order are refused', () => {
  const plain = smallInput({ A: 1000n }, [], [uni(['0.1'])])
  test('order event id', () => {
    const e = { eventId: 'e1', orderId: 'o-A', lineId: '1', type: 'refund' as const, quantity: 1, refundMinor: 0n, restockingFeeMinor: 0n, atUs: T0 + 2n * DAY }
    expect(() => run(withSnapshot(plain, { orderEvents: [e, e] }))).toThrow(/duplicate order event id/)
  })
  test('participant fact key', () => {
    const participants = plain.snapshot.participants.map((p) => ({ ...p, facts: [{ key: 'kyc', value: 'yes' }, { key: 'kyc', value: 'no' }] }))
    expect(() => run(withSnapshot(plain, { participants }))).toThrow(/duplicate fact key/)
  })
  test('volume name on an order line', () => {
    const o = plain.snapshot.orders[0]!
    const orders = [{ ...o, lines: [{ ...o.lines[0]!, volumes: [{ name: 'v', perUnitMinor: 1n }, { name: 'v', perUnitMinor: 2n }] }] }]
    expect(() => run(withSnapshot(plain, { orders }))).toThrow(/duplicate volume name/)
  })
})

describe('hashes', () => {
  test('a number where a bigint money field belongs is refused at the boundary', () => {
    const plain = smallInput({ A: 1000n }, [], [uni(['0.1'])])
    const bad = { ...plain, snapshot: { ...plain.snapshot, receivables: [{ participantId: 'pA', amountMinor: 5 as unknown as bigint }] } }
    expect(() => inputsHash(bad)).toThrow(/must be bigint/)
  })

  test('the result hash covers the volume summaries that come back as history', () => {
    const out = run(loadFixture<RunFixture>('g-e2e-01.json').cases[0]!.input)
    const changed = out.volumeSummaries.map((s, i) => (i === 0 ? { ...s, measures: s.measures.map((m, j) => (j === 0 ? { ...m, valueMinor: m.valueMinor + 1n } : m)) } : s))
    expect(resultHash(out.lines, out.taxLines, out.qualification, out.volumeSummaries)).toBe(out.resultHash)
    expect(resultHash(out.lines, out.taxLines, out.qualification, changed)).not.toBe(out.resultHash)
  })
})
