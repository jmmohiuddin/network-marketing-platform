// Minimal stand-ins for passes 0-3 so the payout primitives are tested on their own: personal measures from
// order lines (no events, no roll-up split), group roll-ups, paid-as from 'measure' requirements of window
// 'period' only. The real passes are tested by their owners and end to end by test/run.
import { mulRate, parseDecimal, toRaw } from '../../src/money.js'
import type { CreditedLine, Done, QualificationOutput, RunContext } from '../../src/pipeline.js'
import { buildTree, evaluationInstant, positionOrder, rollUp } from '../../src/tree.js'
import type { BonusRule, Ladder, LineKey, MeasureRule, RawLine, RunInput } from '../../src/types.js'

type Personal = Extract<MeasureRule, { kind: 'volume.personal' }>

export function contextOf(input: RunInput, fullTraceFor: readonly LineKey[] = []): RunContext {
  const s = input.snapshot
  const ids = positionOrder(s.positions.map((p) => p.positionId))
  const at = { validAtUs: evaluationInstant(s.period), knownAtUs: s.knownAtUs }
  const byId = new Map(s.positions.map((p) => [p.positionId, p]))
  const participants = new Map(s.participants.map((p) => [p.participantId, p]))
  const participantTypes = new Map(s.participantTypes.map((t) => [t.code, t]))
  const positions = ids.map((id) => byId.get(id)!)
  return {
    input,
    options: { fullTraceFor },
    evaluation: at,
    trees: { sponsor: buildTree(ids, s.relationships, 'sponsor', at), placement: buildTree(ids, s.relationships, 'placement', at) },
    positions,
    ownerOf: positions.map((p) => p.ownerParticipantId),
    participants,
    participantTypes,
    earner: Uint8Array.from(positions, (p) => (participantTypes.get(participants.get(p.ownerParticipantId)!.typeCode)!.canEarn && p.status !== 'terminated' ? 1 : 0)),
  }
}

function lineValue(m: Personal, line: RunInput['snapshot']['orders'][number]['lines'][number]): bigint {
  if (m.source.from === 'amount') return line.amountMinor
  if (m.source.from === 'amount_ex_tax') return line.amountMinor - line.taxMinor
  const name = m.source.name
  return (line.volumes.find((v) => v.name === name)?.perUnitMinor ?? 0n) * BigInt(line.quantity)
}

/** Passes 0-3 stand-in. `paidAs` overrides the computed ranks: ladder -> rank key by position id. */
export function doneOf(ctx: RunContext, paidAs?: Readonly<Record<string, Readonly<Record<string, string>>>>): Done<'pools'> {
  const { plan, snapshot } = ctx.input
  const tree = ctx.trees.sponsor
  const n = tree.ids.length
  const personal = plan.measures.filter((m): m is Personal => m.kind === 'volume.personal')
  const lines: CreditedLine[] = []
  for (const order of [...snapshot.orders].sort((a, b) => (a.orderId < b.orderId ? -1 : 1))) {
    const customer = ctx.participantTypes.get(order.buyerTypeCode)!.countsAsEndCustomer
    for (const line of order.lines) {
      const values = personal.map((m) => (m.orders === 'all' || (m.orders === 'customer') === customer ? lineValue(m, line) : 0n))
      const positionIndex = order.creditPositionId === null ? -1 : tree.index.get(order.creditPositionId)!
      lines.push({ orderId: order.orderId, lineId: line.lineId, positionIndex, creditIndex: positionIndex, customer, purpose: order.purpose, buyerParticipantId: order.buyerParticipantId, values })
    }
  }
  const byMeasure = new Map<string, BigInt64Array>()
  const marketTotal = new Map<string, bigint>()
  for (const m of plan.measures) {
    if (m.kind === 'volume.personal') {
      const mi = personal.indexOf(m)
      const own = new BigInt64Array(n)
      let total = 0n
      for (const l of lines) {
        total += l.values[mi]!
        if (l.positionIndex >= 0) own[l.positionIndex]! += l.values[mi]!
      }
      byMeasure.set(m.key, own)
      marketTotal.set(m.key, total)
    } else if (m.kind === 'volume.group') {
      byMeasure.set(m.key, rollUp(ctx.trees[m.tree], byMeasure.get(m.of)!))
    }
  }

  const ranks = new Map<string, Int16Array>()
  for (const ladder of plan.ladders) {
    const out = new Int16Array(n).fill(-1)
    const given = paidAs?.[ladder.key]
    for (let k = 0; k < n; k++) {
      if (given) {
        out[k] = ladder.ranks.findIndex((r) => r.key === given[tree.ids[k]!])
        continue
      }
      ladder.ranks.forEach((rank, r) => {
        const met = rank.requires.every((req) => req.kind === 'measure' && byMeasure.get(req.measure)![k]! >= req.atLeastMinor)
        if (met) out[k] = r
      })
    }
    ranks.set(ladder.key, out)
  }
  const qualification: QualificationOutput = { paidAs: ranks, titles: ranks, state: [], evaluations: [], warnings: [] }
  return {
    transition: { prior: tree.ids.map(() => null), report: [] },
    lineVolumes: { measureKeys: personal.map((m) => m.key), lines, warnings: [] },
    volumes: { byMeasure, marketTotal, byPurpose: new Map() },
    qualification,
    individual: [],
    matching: [],
  }
}

/** A pass-4 line as matching sees it (raw = amount in minor units). */
export function individualLine(payeePositionId: string, ruleKey: string, amountMinor: bigint): RawLine {
  return {
    payeePositionId, ruleKey, kind: 'pay.percent_of_measure', sourceKind: 'downline_volume', pass: 4, unit: 'currency', reversalPolicy: 'restatement',
    origin: null, raw: toRaw(amountMinor), allocatedMinor: null, purposeRaw: [], trace: {} as RawLine['trace'],
  }
}

/** Raw amount of rate x minor, for hand-derived expectations. */
export const rawOf = (minor: bigint, rate: string): bigint => mulRate(toRaw(minor), parseDecimal(rate))

export const T0 = 1_800_000_000_000_000n
export const DAY = 86_400_000_000n

/**
 * Small hand-built run: positions with volume `v` (measure 'v', currency), sponsor edges [parent, child],
 * the given bonuses and ladders; every owner is a distributor enrolled long before the period.
 */
export function smallInput(volumes: Readonly<Record<string, bigint>>, edges: readonly (readonly [string, string])[], bonuses: readonly BonusRule[], ladders: readonly Ladder[] = []): RunInput {
  const ids = [...new Set([...edges.flat(), ...Object.getOwnPropertyNames(volumes)])]
  return {
    plan: {
      planVersionId: 'plan-small', version: 1, contentHash: 'test', effectiveFromUs: T0, calendars: ['monthly'],
      measures: [{ kind: 'volume.personal', key: 'v', unit: 'currency', source: { from: 'volume', name: 'v' }, items: { excludeItemClasses: [], categories: null }, orders: 'all' }],
      ladders, bonuses, constraints: [], caps: [], carries: [], counters: [], transitions: [], pointsToCurrency: [], customerRollUp: null,
    },
    settings: { settingsVersionId: 's', roundingMode: 'half_up', restockingFeeAffectsVolume: false },
    snapshot: {
      snapshotId: 'snap', market: { marketId: 'MKT', currency: 'XXX', minorDigits: 2 },
      period: { periodId: 'p', calendar: 'monthly', startsAtUs: T0, endsAtUs: T0 + 30n * DAY }, knownAtUs: T0 + 30n * DAY,
      participantTypes: [{ code: 'distributor', canEarn: true, countsAsEndCustomer: false, canSponsor: true, canHoldPositions: true }],
      participants: ids.map((id) => ({ participantId: `p${id}`, typeCode: 'distributor', enrolledAtUs: 0n, facts: [] })),
      positions: ids.map((id) => ({ positionId: id, ownerParticipantId: `p${id}`, status: 'active', statusFromUs: 0n })),
      relationships: edges.map(([parent, child]) => ({ kind: 'sponsor', parentPositionId: parent, childPositionId: child, leg: null, validFromUs: 0n, validToUs: null, recordedAtUs: 0n, supersededAtUs: null })),
      orders: ids.filter((id) => (volumes[id] ?? 0n) !== 0n).map((id) => ({
        orderId: `o-${id}`, buyerParticipantId: `p${id}`, buyerTypeCode: 'distributor', purpose: 'personal', creditPositionId: id, creditedAtUs: T0 + DAY,
        lines: [{ lineId: '1', productId: 'SKU', itemClass: 'product', category: 'general', quantity: 1, amountMinor: 0n, taxMinor: 0n, volumes: [{ name: 'v', perUnitMinor: volumes[id]! }] }],
      })),
      orderEvents: [], history: [], priorState: null, adjustments: [], receivables: [], withholding: [],
    },
  }
}
