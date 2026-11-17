// Contracts of @nmp/engine: plan version, run input snapshot, run output. Data only.
//
// Binding conventions for every implementer:
// - bigint fields end in `Minor` (money, volume and counts in their smallest unit; a count's unit is 1) or
//   `Us` (UTC epoch microseconds; PostgreSQL timestamptz precision). Nothing else is bigint in input data.
// - Decimal parameters are `Decimal` strings parsed only by money.parseDecimal. No parameter has a default:
//   every rate, threshold and window comes from the plan version, settings or snapshot (DEC-14).
// - Ids are strings ordered by code unit (tree.compareId). Iterate arrays in their given order or positions
//   by tree index; never iterate the keys of an input object (determinism, SDD-07 §2).
// - Plans are data: nothing here or in src/ may branch on a tenant (BR-PLN-05, TS-67).
import type { RoundingMode } from './money.js'

export type Decimal = string
export type PositionId = string
export type ParticipantId = string
export type TreeKind = 'sponsor' | 'placement'
export type OrderPurpose = 'resale' | 'personal' | 'unspecified' | 'customer'
export type ReversalPolicy = 'order_line' | 'restatement'
/** Same set as cpl_fact_payout_line.source_kind minus the import-only 'unknown'. */
export type SourceKind = 'retail_sale' | 'downline_volume' | 'enrolment_order' | 'pool' | 'match' | 'clawback' | 'other'
export type PassNumber = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

// ===================================== Plan version (FR-PLN-001..004, SDD-07 §3) =====================================

export interface PlanVersion {
  readonly planVersionId: string
  readonly version: number
  readonly contentHash: string
  readonly effectiveFromUs: bigint
  readonly calendars: readonly string[]
  readonly measures: readonly MeasureRule[] // dependency order: a measure's `of` appears earlier
  readonly ladders: readonly Ladder[]
  readonly bonuses: readonly BonusRule[]
  readonly constraints: readonly ParticipantConstraint[] // pass 7, before caps (BR-CAP-02)
  readonly caps: readonly CapRule[] // pass 8, applied in array order (array order = stated precedence)
  readonly carries: readonly CarryRule[]
  readonly counters: readonly CounterRule[]
  readonly transitions: readonly TransitionRule[] // pass 0 (FR-PLN-008)
  readonly pointsToCurrency: readonly PointsFactor[] // BR-MNY-05; needed only when a measure has unit 'points'
  readonly customerRollUp: FractionalRollUp | null // BR-ATT-04
}

/** "Paid-as rank in `ladder` is `rank` or higher." */
export interface RankRef { readonly ladder: string; readonly rank: string }

// ---------- Measures (pass 1 per line, pass 2 per position) ----------

/** Where a line's value comes from: a named volume (per unit x quantity), the line amount, or the amount less tax. */
export type LineSource = { readonly from: 'volume'; readonly name: string } | { readonly from: 'amount' } | { readonly from: 'amount_ex_tax' }

export interface ItemRules {
  readonly excludeItemClasses: readonly string[] // e.g. starter kits, samples
  readonly categories: readonly string[] | null // null = every category is credited
}

export type MeasureRule =
  | {
      readonly kind: 'volume.personal' // per order line, credited to the order's credit position, summed per position
      readonly key: string
      readonly unit: 'currency' | 'points'
      readonly source: LineSource
      readonly items: ItemRules
      readonly orders: 'own' | 'customer' | 'all' // own = buyer type not an end customer; customer = end-customer orders
    }
  | { readonly kind: 'volume.group'; readonly key: string; readonly of: string; readonly tree: TreeKind; readonly includeSelf: boolean }
  | { readonly kind: 'volume.enrolled_group'; readonly key: string; readonly of: string; readonly includeSelf: boolean } // self + personally sponsored
  | {
      readonly kind: 'count.customers' // distinct end customers whose orders credited to the position reach the minimum
      readonly key: string
      readonly measure: string
      readonly minPerCustomerMinor: bigint
    }
  | {
      readonly kind: 'count.enrolled' // personally sponsored positions whose `measure` reaches `atLeastMinor`
      readonly key: string
      readonly measure: string
      readonly atLeastMinor: bigint
    }
  | { readonly kind: 'measure.derived'; readonly key: string; readonly expr: Expr } // tier 2 (E-ADR-41), rounded half-up once

// ---------- Tier-2 expressions (E-ADR-41, E-ADR-42; checked and evaluated by expression.ts) ----------

export type ExprOp = 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max' | 'if' | 'gte' | 'gt' | 'lte' | 'lt' | 'eq' | 'and' | 'or' | 'not'
export type AggregateKind = 'sum' | 'max' | 'min' | 'count'
/**
 * Typed JSON AST. Numbers are exact rationals in the measures' minor units: `const` is a non-negative Decimal in those
 * units, `measure` this period's value, `state` the PRIOR period's balance (`carry.<key>` amount or `counter.<key>`
 * value, after transitions), `agg` folds `of` over the position's direct children in `tree` (count: children whose
 * value reaches atLeastMinor; null = every child). `fact` compares a profile fact (bool).
 */
export type Expr =
  | { readonly const: Decimal }
  | { readonly measure: string }
  | { readonly state: string }
  | { readonly fact: string; readonly equals: string }
  | { readonly op: ExprOp; readonly args: readonly Expr[] }
  | { readonly agg: AggregateKind; readonly of: string; readonly tree: TreeKind; readonly atLeastMinor: bigint | null }

// ---------- Qualification (pass 3; BR-RNK-05..09) ----------

export type QualWindow = { readonly type: 'period' } | { readonly type: 'rolling'; readonly periods: number } | { readonly type: 'per_order' }

export type Requirement =
  | {
      readonly kind: 'measure'
      readonly measure: string
      readonly atLeastMinor: bigint
      readonly window: QualWindow
      readonly maxPerLegShare: Decimal | null // leg rule: each direct leg counts at most share x atLeastMinor
    }
  | { readonly kind: 'legs'; readonly tree: TreeKind; readonly count: number; readonly rank: RankRef } // qualified legs
  | { readonly kind: 'profile'; readonly fact: string; readonly equals: string } // participant profile fact
  | { readonly kind: 'rank'; readonly rank: RankRef } // rank held in another ladder
  | { readonly kind: 'expression'; readonly expr: Expr } // tier 2 (E-ADR-41): met when the boolean expression holds

export interface RankDef {
  readonly key: string
  readonly requires: readonly Requirement[] // all must hold; [] always holds
  readonly maintenance: { readonly gracePeriods: number } | null // failing periods that keep this paid-as rank
}

export interface Ladder {
  readonly key: string
  readonly ranks: readonly RankDef[] // ascending; paid-as = highest rank held after maintenance/grace; title = highest ever
}

// ---------- Bonuses (passes 4, 5, 6) ----------

interface BonusCommon {
  readonly key: string
  readonly sourceKind: SourceKind
  readonly reversalPolicy: ReversalPolicy
  readonly eligibleIf: RankRef | null // payee must hold this rank; for compression it is also "active"; null = every earner
}
export interface RankRates { readonly ladder: string; readonly rates: readonly { readonly rank: string; readonly rate: Decimal }[] }

export type PoolAllocation =
  | { readonly type: 'shares'; readonly ladder: string; readonly shares: readonly { readonly rank: string; readonly shares: number }[] } // by exact paid-as rank
  | { readonly type: 'rank_order'; readonly ladder: string; readonly parts: readonly { readonly rank: string; readonly share: Decimal }[] } // part of the pool per exact rank, split equally
  | { readonly type: 'first_n'; readonly n: number; readonly orderBy: string } // top n eligible by measure desc, ties position id asc

export type BonusRule = BonusCommon &
  (
    | { readonly kind: 'pay.retail_margin'; readonly rate: Decimal; readonly measure: string } // measure with orders 'customer'
    | { readonly kind: 'pay.percent_by_level'; readonly tree: TreeKind; readonly measure: string; readonly levels: readonly Decimal[]; readonly compression: 'dynamic' | 'none' }
    | { readonly kind: 'pay.generations'; readonly tree: TreeKind; readonly measure: string; readonly leader: RankRef; readonly rates: readonly Decimal[] }
    | { readonly kind: 'pay.percent_of_measure'; readonly measure: string; readonly byRank: RankRates }
    | { readonly kind: 'pay.differential'; readonly tree: TreeKind; readonly measure: string; readonly byRank: RankRates }
    | { readonly kind: 'pay.override'; readonly tree: TreeKind; readonly measure: string; readonly rate: Decimal; readonly levels: number }
    | { readonly kind: 'pay.matching'; readonly tree: TreeKind; readonly of: readonly string[]; readonly rates: readonly Decimal[] } // rate per generation
    | {
        readonly kind: 'pay.fast_start'
        readonly tree: TreeKind
        readonly measure: string
        readonly buyerEnrolledWithinUs: bigint
        readonly tiers: readonly { readonly rate: Decimal; readonly perOrderCapMinor: bigint }[] // tier 0 = buyer position's parent
      }
    | { readonly kind: 'pay.flat'; readonly amountMinor: bigint } // every period to each eligible earner
    | { readonly kind: 'pay.one_time'; readonly amountMinor: bigint; readonly onceKey: string } // once per position ever (TS-25)
    | { readonly kind: 'pay.pool'; readonly baseMeasure: string; readonly rate: Decimal; readonly allocation: PoolAllocation } // base = market total
  )
export type BonusKind = BonusRule['kind']

// ---------- Limits (passes 7, 8; BR-CAP-01..03) ----------

export type ParticipantConstraint =
  | { readonly kind: 'limit.max_per_period'; readonly key: string; readonly scope: readonly string[]; readonly maxMinor: bigint }
  | { readonly kind: 'limit.max_share_from_purpose'; readonly key: string; readonly scope: readonly string[]; readonly purpose: OrderPurpose; readonly maxShare: Decimal }

export type CapBase =
  | { readonly kind: 'measure'; readonly measure: string } // market total; the payee's own value for method per_person
  | {
      readonly kind: 'order_structure' // TS-09: base = firstMultiplier x first if second/(first+second) > ratio, else first + second
      readonly first: string
      readonly second: string
      readonly secondShareAbove: { readonly num: number; readonly den: number }
      readonly firstMultiplier: Decimal
    }

export interface CapRule {
  readonly key: string
  readonly scope: readonly string[] // bonus keys
  readonly base: CapBase
  readonly rate: Decimal // cap = roundRaw(base x rate)
  readonly method: { readonly type: 'proportional' } | { readonly type: 'priority'; readonly reduce: readonly string[] } | { readonly type: 'per_person' }
  readonly residue: 'breakage' // removed amounts are not earned (ENGINE_GENEALOGY C10)
}

// ---------- State (BR-RNK-07/08, FR-PLN-008) ----------

export interface CarryRule { readonly key: string; readonly measure: string; readonly capMinor: bigint | null; readonly keepIf: RankRef | null; readonly expiresAfterPeriods: number | null }
export interface CounterRule { readonly key: string; readonly incrementIf: RankRef } // streak: +1 when held, else 0
/** stateItem: `title.<ladder>`, `paid_as.<ladder>`, `carry.<key>`, `counter.<key>`, `one_time.<onceKey>`, `banked.<key>`, or `<kind>.*`. */
export interface TransitionRule {
  readonly stateItem: string
  readonly rule: 'carry' | 'map' | 'reset'
  readonly map: readonly { readonly from: string; readonly to: string }[]
  readonly reason: string | null
}
export interface PointsFactor { readonly marketId: string; readonly effectiveFromUs: bigint; readonly factor: Decimal }
/** Customer order volume split up the servicing chain: level 0 = servicing position, 1 = its sponsor, ...; shares sum to 1. */
export interface FractionalRollUp { readonly measures: readonly string[]; readonly shares: readonly { readonly level: number; readonly share: Decimal }[] }

// ===================================== Run input (SDD-07 §2, §6) =====================================

export interface RunSettings {
  readonly settingsVersionId: string
  readonly roundingMode: RoundingMode
  readonly restockingFeeAffectsVolume: boolean // BR-RET-03 tenant setting
}

export interface ParticipantType {
  readonly code: string
  readonly canEarn: boolean
  readonly countsAsEndCustomer: boolean
  readonly canSponsor: boolean
  readonly canHoldPositions: boolean
}
export interface Participant {
  readonly participantId: ParticipantId
  readonly typeCode: string // type at the evaluation instant
  readonly enrolledAtUs: bigint
  readonly facts: readonly { readonly key: string; readonly value: string }[]
}
export type PositionStatus = 'pending' | 'active' | 'suspended' | 'terminated'
export interface Position {
  readonly positionId: PositionId
  readonly ownerParticipantId: ParticipantId // owner at the evaluation instant
  readonly status: PositionStatus
  readonly statusFromUs: bigint
}
/** One `relationship` row (ENT-05); the engine applies the as-of predicate itself (tree.buildTree). */
export interface Relationship {
  readonly kind: TreeKind
  readonly parentPositionId: PositionId
  readonly childPositionId: PositionId
  readonly leg: string | null
  readonly validFromUs: bigint
  readonly validToUs: bigint | null
  readonly recordedAtUs: bigint
  readonly supersededAtUs: bigint | null
}
export interface OrderLine {
  readonly lineId: string
  readonly productId: string
  readonly itemClass: string
  readonly category: string
  readonly quantity: number // integer > 0
  readonly amountMinor: bigint // net sale value as charged
  readonly taxMinor: bigint
  readonly volumes: readonly { readonly name: string; readonly perUnitMinor: bigint }[] // fixed at ingestion (BR-VOL-01)
}
/** Orders credited to this period by the plan's crediting event (D-R1); the orchestrator assigns periods. */
export interface Order {
  readonly orderId: string
  readonly buyerParticipantId: ParticipantId
  readonly buyerTypeCode: string // fixed at ingestion (BR-ORD-01)
  readonly purpose: OrderPurpose
  readonly creditPositionId: PositionId | null // buyer's position, or servicing position for customer orders; null = company
  readonly creditedAtUs: bigint
  readonly lines: readonly OrderLine[]
}
export type OrderEventType = 'refund' | 'return' | 'exchange' | 'chargeback' | 'chargeback_reversed' | 'cancelled'
/** Events of this period against orders of this period; events against committed periods arrive as adjustments. */
export interface OrderEvent {
  readonly eventId: string
  readonly orderId: string
  readonly lineId: string
  readonly type: OrderEventType
  readonly quantity: number
  readonly refundMinor: bigint
  readonly restockingFeeMinor: bigint
  readonly atUs: bigint
}
export interface LadderRank { readonly ladder: string; readonly rank: string | null }
export interface MeasureValue { readonly measure: string; readonly valueMinor: bigint }
export interface PositionSummary { readonly positionId: PositionId; readonly measures: readonly MeasureValue[]; readonly paidAs: readonly LadderRank[] }
/** A committed earlier period of the same calendar (rolling windows, TS-63): history is contiguous, [startsAtUs, endsAtUs). */
export interface PeriodSummary { readonly periodId: string; readonly startsAtUs: bigint; readonly endsAtUs: bigint; readonly positions: readonly PositionSummary[] }

export interface QualificationStateRow {
  readonly positionId: PositionId
  readonly paidAs: readonly LadderRank[]
  readonly titles: readonly LadderRank[]
  readonly graceUsed: readonly { readonly ladder: string; readonly periods: number }[]
  readonly counters: readonly { readonly key: string; readonly value: number }[]
  readonly carry: readonly { readonly key: string; readonly amountMinor: bigint; readonly periodsHeld: number }[]
  readonly oneTimeFlags: readonly string[]
  readonly banked: readonly { readonly key: string; readonly amountMinor: bigint }[]
}
export interface PriorState { readonly planVersionId: string; readonly periodId: string; readonly positions: readonly QualificationStateRow[] }

export type OriginType = 'late_transaction' | 'clawback' | 'manual' | 'restatement'
/** Pass-9 input, consumed once per run (FR-COMP-010). Amount already computed by its origin. */
export interface AdjustmentOrigin {
  readonly originType: OriginType
  readonly originId: string
  readonly payeePositionId: PositionId
  readonly ruleKey: string
  readonly sourceKind: SourceKind
  readonly amountMinor: bigint
  readonly originalPeriodId: string | null
  readonly reasonCode: string | null
}
/** Clawback receivable balance before this run (positive). */
export interface Receivable { readonly participantId: ParticipantId; readonly amountMinor: bigint }
/** Withholding rule already selected by the orchestrator for this payee, market and pay date (MONEY §9.3 steps 1-3). */
export interface WithholdingInstruction { readonly participantId: ParticipantId; readonly ruleId: string; readonly rate: Decimal; readonly rounding: RoundingMode }

export interface Snapshot {
  readonly snapshotId: string
  readonly market: { readonly marketId: string; readonly currency: string; readonly minorDigits: number }
  readonly period: { readonly periodId: string; readonly calendar: string; readonly startsAtUs: bigint; readonly endsAtUs: bigint } // [start, end)
  readonly knownAtUs: bigint
  readonly participantTypes: readonly ParticipantType[]
  readonly participants: readonly Participant[]
  readonly positions: readonly Position[]
  readonly relationships: readonly Relationship[]
  readonly orders: readonly Order[]
  readonly orderEvents: readonly OrderEvent[]
  readonly history: readonly PeriodSummary[] // most recent first
  readonly priorState: PriorState | null
  readonly adjustments: readonly AdjustmentOrigin[]
  readonly receivables: readonly Receivable[]
  readonly withholding: readonly WithholdingInstruction[]
}

export interface RunInput { readonly plan: PlanVersion; readonly settings: RunSettings; readonly snapshot: Snapshot }
export interface LineKey { readonly payeePositionId: PositionId; readonly ruleKey: string }
/** fullTraceFor: lines whose trace keeps every source (FR-COMP-007 "replay the rule for that payee"). */
export interface RunOptions { readonly fullTraceFor: readonly LineKey[] }

// ===================================== Trace (FR-COMP-007) =====================================

/** One order's part of a source (order_line rules): parts split the source raw by the order's value in the measure. */
export interface TraceOrder { readonly orderId: string; readonly raw: bigint }
/** raw = min(base x rate x share.num / share.den, capMinor), each factor present only when not null. */
export interface TraceSource {
  readonly positionId: PositionId | null // source position (level k, matched payee); null = market/company
  readonly level: number | null // levels/generations below the payee
  readonly measure: string | null
  readonly ruleKey: string | null // matched bonus (pay.matching)
  readonly base: bigint
  readonly baseScale: 'minor' | 'raw'
  readonly rate: Decimal | null
  readonly share: { readonly num: bigint; readonly den: bigint } | null // pools: the holder's part of the pool
  readonly capMinor: bigint | null // fast start: per-order cap
  readonly raw: bigint // this source's contribution
  // Orders the base came from with their part of raw: order_line rules only (fast start always); a source on an
  // aggregate measure (group, generation) cites them only in a full trace (RunOptions.fullTraceFor).
  readonly orders: readonly TraceOrder[]
  readonly compressedOver: readonly PositionId[]
}
export type TraceStep =
  | { readonly step: 'constraint'; readonly key: string; readonly beforeRaw: bigint; readonly afterRaw: bigint }
  | { readonly step: 'cap'; readonly key: string; readonly method: CapRule['method']['type']; readonly beforeRaw: bigint; readonly afterMinor: bigint }
  | { readonly step: 'allocation'; readonly key: string; readonly weight: bigint; readonly totalMinor: bigint; readonly afterMinor: bigint }
  | { readonly step: 'points'; readonly factor: Decimal; readonly beforeRaw: bigint; readonly afterRaw: bigint }
  | { readonly step: 'rounding'; readonly mode: RoundingMode; readonly raw: bigint; readonly minor: bigint }

/** Compact trace (~1 KB): at most TRACE_SOURCE_LIMIT sources unless the line is in RunOptions.fullTraceFor. */
export interface Trace {
  readonly rule: string
  readonly kind: BonusKind | 'adjustment'
  readonly pass: PassNumber
  readonly planVersionId: string
  readonly engineVersion: string
  readonly payeePositionId: PositionId
  readonly rankEvaluated: readonly LadderRank[]
  readonly tree: { readonly kind: TreeKind; readonly knownAtUs: bigint } | null
  readonly sources: readonly TraceSource[] // level asc, then position id asc
  readonly omitted: { readonly count: number; readonly raw: bigint } // sources beyond the limit; sum(sources.raw) + omitted.raw = raw
  readonly raw: bigint // before passes 7+
  readonly steps: readonly TraceStep[] // appended by passes 7, 8, 10 in order
}

// ===================================== Pass outputs and run output =====================================

/** Unrounded line of passes 4-9. allocatedMinor is set when an allocation fixed the final amount (pool, cap, adjustment). */
export interface RawLine {
  readonly payeePositionId: PositionId
  readonly ruleKey: string
  readonly kind: BonusKind | 'adjustment'
  readonly sourceKind: SourceKind
  readonly pass: PassNumber
  readonly unit: 'currency' | 'points'
  readonly reversalPolicy: ReversalPolicy | null
  readonly origin: LineOrigin | null
  readonly raw: bigint
  readonly allocatedMinor: bigint | null
  // Part of trace.raw paid on orders of each purpose a pass-7 limit names (limit.max_share_from_purpose); never truncated.
  readonly purposeRaw: readonly { readonly purpose: OrderPurpose; readonly raw: bigint }[]
  readonly trace: Trace
}
export interface LineOrigin { readonly originType: OriginType; readonly originId: string; readonly originalPeriodId: string | null }

/** Final line (pass 10). Zero amounts are not emitted. One line per (payee position, rule) plus one per adjustment origin. */
export interface ResultLine {
  readonly payeePositionId: PositionId
  readonly payeeParticipantId: ParticipantId
  readonly ruleKey: string
  readonly kind: BonusKind | 'adjustment'
  readonly sourceKind: SourceKind
  readonly pass: PassNumber
  readonly amountMinor: bigint
  readonly currency: string
  readonly reversalPolicy: ReversalPolicy | null
  readonly origin: LineOrigin | null
  readonly trace: Trace
}

export interface ConstraintApplication { readonly key: string; readonly participantId: ParticipantId; readonly beforeRaw: bigint; readonly afterRaw: bigint }
/** BR-CAP-03: payees affected and amounts removed, per cap. */
export interface CapApplication {
  readonly capKey: string
  readonly method: CapRule['method']['type']
  readonly baseMinor: bigint
  readonly capMinor: bigint
  readonly proposedRaw: bigint
  readonly bound: boolean
  readonly affected: readonly { readonly payeePositionId: PositionId; readonly ruleKey: string; readonly beforeRaw: bigint; readonly afterMinor: bigint }[]
}

export interface QualificationEvaluation {
  readonly positionId: PositionId
  readonly ladder: string
  readonly paidAs: string | null
  readonly byGrace: boolean
  readonly checked: readonly { readonly rank: string; readonly requirement: number; readonly valueMinor: bigint; readonly atLeastMinor: bigint; readonly met: boolean }[]
}
export interface TransitionChange { readonly positionId: PositionId; readonly stateItem: string; readonly rule: TransitionRule['rule']; readonly before: string; readonly after: string }

/** Pass 11, per participant. Netting first, then withholding on what remains: gross = netted + withheld + netPayable. */
export interface PayeeSettlement {
  readonly participantId: ParticipantId
  readonly positions: readonly PositionId[]
  readonly grossMinor: bigint
  readonly receivableBeforeMinor: bigint
  readonly nettedMinor: bigint
  readonly taxableMinor: bigint
  readonly withheldMinor: bigint
  readonly netPayableMinor: bigint
  readonly receivableAfterMinor: bigint
}
export interface TaxLine { readonly participantId: ParticipantId; readonly ruleId: string; readonly taxableMinor: bigint; readonly withheldMinor: bigint }

export interface ControlTotals {
  readonly grossMinor: bigint // sum of result lines
  readonly byRule: readonly { readonly ruleKey: string; readonly amountMinor: bigint }[]
  readonly bySourceKind: readonly { readonly sourceKind: SourceKind; readonly amountMinor: bigint }[]
  readonly adjustmentsByOrigin: readonly { readonly originType: OriginType; readonly amountMinor: bigint }[]
  readonly nettedMinor: bigint
  readonly withheldMinor: bigint
  readonly netPayableMinor: bigint
  readonly breakageMinor: bigint // not earned: removed by pass-7 limits and pass-8 caps, plus pool parts without a holder
  readonly residueMinor: bigint // BR-MNY-04 rounding residue account
  readonly lineCount: number
  readonly payeeCount: number
}

export interface EngineWarning { readonly code: string; readonly message: string; readonly ref: string | null }

export interface RunOutput {
  readonly engineVersion: string
  readonly planVersionId: string
  readonly settingsVersionId: string
  readonly snapshotId: string
  readonly periodId: string
  readonly inputsHash: string // sha256 of the canonical RunInput; replay compares it first
  readonly lines: readonly ResultLine[] // sorted: payee position id, pass, rule key, origin type, origin id
  readonly payees: readonly PayeeSettlement[] // participant id asc
  readonly taxLines: readonly TaxLine[]
  readonly qualification: readonly QualificationStateRow[] // state candidates, position id asc
  readonly evaluations: readonly QualificationEvaluation[]
  readonly volumeSummaries: readonly PositionSummary[]
  readonly constraintApplications: readonly ConstraintApplication[]
  readonly capApplications: readonly CapApplication[]
  readonly transitionReport: readonly TransitionChange[]
  readonly controlTotals: ControlTotals
  readonly warnings: readonly EngineWarning[]
  readonly resultHash: string // see pipeline.ts RESULT_HASH
}
