// Test harness for pass 3: a RunContext built the way run.ts builds it, and pass 0-2 outputs supplied directly,
// so qualification is tested on stated volumes without depending on the volume primitives.
import type { CreditedLine, Done, RunContext } from '../../src/pipeline.js'
import { buildTree, evaluationInstant, positionOrder } from '../../src/tree.js'
import type {
  CarryRule, CounterRule, Ladder, MeasureRule, PeriodSummary, QualificationEvaluation, QualificationStateRow, RunInput,
} from '../../src/types.js'
import { loadFixture } from '../fixtures/load.js'

export const START = 1803859200000000n // 2027-03-01T00:00Z
export const END = 1806537600000000n // 2027-04-01T00:00Z

export interface RankCase {
  readonly name: string
  readonly description: string
  readonly measures: readonly MeasureRule[]
  readonly ladders: readonly Ladder[]
  readonly counters?: readonly CounterRule[]
  readonly carries?: readonly CarryRule[]
  readonly positions: readonly { readonly positionId: string; readonly sponsor: string | null; readonly facts?: readonly { key: string; value: string }[] }[]
  readonly values: readonly { readonly measure: string; readonly positionId: string; readonly valueMinor: bigint }[]
  readonly orderLines?: readonly { readonly orderId: string; readonly lineId: string; readonly positionId: string; readonly measure: string; readonly valueMinor: bigint }[]
  readonly history?: readonly PeriodSummary[]
  readonly prior?: readonly (Partial<QualificationStateRow> & { readonly positionId: string })[]
  readonly expected: { readonly state: readonly Partial<QualificationStateRow>[]; readonly evaluations?: readonly Partial<QualificationEvaluation>[] }
}

export const golden = loadFixture<{ cases: readonly RankCase[] }>('../qualification/rank-golden.json').cases

export function inputOf(c: RankCase): RunInput {
  const owner = (id: string): string => `p${id}`
  return {
    plan: {
      planVersionId: `plan-${c.name}`, version: 1, contentHash: 'fixture', effectiveFromUs: START, calendars: ['monthly'],
      measures: c.measures, ladders: c.ladders, bonuses: [], constraints: [], caps: [], carries: c.carries ?? [], counters: c.counters ?? [],
      transitions: [], pointsToCurrency: [], customerRollUp: null,
    },
    settings: { settingsVersionId: 'settings-fixture', roundingMode: 'half_up', restockingFeeAffectsVolume: false },
    snapshot: {
      snapshotId: `snap-${c.name}`,
      market: { marketId: 'MKT', currency: 'XXX', minorDigits: 2 },
      period: { periodId: '2027-03', calendar: 'monthly', startsAtUs: START, endsAtUs: END },
      knownAtUs: END,
      participantTypes: [{ code: 'distributor', canEarn: true, countsAsEndCustomer: false, canSponsor: true, canHoldPositions: true }],
      participants: c.positions.map((p) => ({ participantId: owner(p.positionId), typeCode: 'distributor', enrolledAtUs: 0n, facts: p.facts ?? [] })),
      positions: c.positions.map((p) => ({ positionId: p.positionId, ownerParticipantId: owner(p.positionId), status: 'active', statusFromUs: 0n })),
      relationships: c.positions.flatMap((p) =>
        p.sponsor === null ? [] : [{ kind: 'sponsor' as const, parentPositionId: p.sponsor, childPositionId: p.positionId, leg: null, validFromUs: 0n, validToUs: null, recordedAtUs: 0n, supersededAtUs: null }],
      ),
      orders: [], orderEvents: [], history: c.history ?? [], priorState: null, adjustments: [], receivables: [], withholding: [],
    },
  }
}

export function contextOf(input: RunInput): RunContext {
  const s = input.snapshot
  const ids = positionOrder(s.positions.map((p) => p.positionId))
  const evaluation = { validAtUs: evaluationInstant(s.period), knownAtUs: s.knownAtUs }
  const byId = new Map(s.positions.map((p) => [p.positionId, p]))
  const positions = ids.map((id) => byId.get(id)!)
  return {
    input, options: { fullTraceFor: [] }, evaluation,
    trees: { sponsor: buildTree(ids, s.relationships, 'sponsor', evaluation), placement: buildTree(ids, s.relationships, 'placement', evaluation) },
    positions, ownerOf: positions.map((p) => p.ownerParticipantId),
    participants: new Map(s.participants.map((p) => [p.participantId, p])),
    participantTypes: new Map(s.participantTypes.map((t) => [t.code, t])),
    earner: new Uint8Array(ids.length).fill(1),
  }
}

const emptyRow = (positionId: string): QualificationStateRow => ({ positionId, paidAs: [], titles: [], graceUsed: [], counters: [], carry: [], oneTimeFlags: [], banked: [] })

/** Pass 0-2 outputs from stated values: every plan measure gets a column (0 where not stated). */
export function doneOf(ctx: RunContext, c: Pick<RankCase, 'values' | 'orderLines' | 'prior'>): Done<'qualification'> {
  const { plan } = ctx.input
  const n = ctx.positions.length
  const index = ctx.trees.sponsor.index
  const byMeasure = new Map(plan.measures.map((m) => [m.key, new BigInt64Array(n)]))
  for (const v of c.values) byMeasure.get(v.measure)![index.get(v.positionId)!] = v.valueMinor
  const measureKeys = plan.measures.filter((m) => m.kind === 'volume.personal').map((m) => m.key)
  const lines: CreditedLine[] = (c.orderLines ?? []).map((l) => ({
    orderId: l.orderId, lineId: l.lineId, positionIndex: index.get(l.positionId)!, creditIndex: index.get(l.positionId)!, customer: false, purpose: 'personal', buyerParticipantId: `p${l.positionId}`,
    values: measureKeys.map((key) => (key === l.measure ? l.valueMinor : 0n)),
  }))
  const prior = ctx.positions.map((p) => {
    const row = c.prior?.find((r) => r.positionId === p.positionId)
    return row ? { ...emptyRow(p.positionId), ...row } : null
  })
  return {
    transition: { prior, report: [] },
    lineVolumes: { measureKeys, lines, warnings: [] },
    volumes: { byMeasure, marketTotal: new Map(), byPurpose: new Map() },
  }
}
