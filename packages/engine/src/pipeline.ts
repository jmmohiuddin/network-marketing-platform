// Pass order (SDD-07 §4, ENGINE_GENEALOGY §6.6 and conflict C1: SDD order wins) as a typed registry.
// A pass may read only the outputs of earlier passes (Done<K>); the runner calls them in PASS_ORDER and
// builds a new outputs object after every pass. Inside a pass: rules in plan order (plan arrays are in
// dependency order), payees by ascending position index.
import { EngineError } from './errors.js'
import type { AsOf, Tree } from './tree.js'
import type {
  BonusKind, BonusRule, CapApplication, ConstraintApplication, ControlTotals, EngineWarning, OrderPurpose, Participant,
  ParticipantId, ParticipantType, PassNumber, PayeeSettlement, Position, PositionSummary, QualificationEvaluation,
  QualificationStateRow, RankRef, RawLine, ResultLine, RunInput, RunOptions, TaxLine, TransitionChange, TreeKind,
} from './types.js'

export const ENGINE_VERSION = '0.2.0'
/** Compact-trace bound (technical limit, not a plan parameter): sources kept per line unless fullTraceFor. */
export const TRACE_SOURCE_LIMIT = 16

export const PASS_ORDER = [
  'transition', // 0  transition rules on the first run of a new plan version (FR-PLN-008)
  'lineVolumes', // 1  measures per order line, period returns/events, item rules, customer roll-up split
  'volumes', // 2  per-position measures, group roll-ups, counts, market totals
  'qualification', // 3  paid-as per ladder, titles, maintenance + grace, counters, carry
  'individual', // 4  retail, level, generations, differential, override, fast start, flat, one-time
  'matching', // 5  % of pass-4 lines; never on a reversed bonus
  'pools', // 6  base x rate split by largest remainder
  'constraints', // 7  per-participant constraints (before caps, BR-CAP-02)
  'caps', // 8  company caps: proportional / priority then proportional / per person
  'adjustments', // 9  adjustment origins, once each
  'rounding', // 10 points -> currency, round once per line, drop zero lines
  'settlement', // 11 netting of receivables, then withholding; tax lines
  'totals', // 12 invariants, control totals, result hash
] as const
export type PassName = (typeof PASS_ORDER)[number]
export const PASS_NUMBER: { readonly [K in PassName]: PassNumber } = {
  transition: 0, lineVolumes: 1, volumes: 2, qualification: 3, individual: 4, matching: 5, pools: 6,
  constraints: 7, caps: 8, adjustments: 9, rounding: 10, settlement: 11, totals: 12,
}

/** Everything a pass may read besides earlier outputs. Built once by run.ts from the RunInput. */
export interface RunContext {
  readonly input: RunInput
  readonly options: RunOptions
  readonly evaluation: AsOf // validAt = tree.evaluationInstant(period), knownAt = snapshot.knownAtUs
  readonly trees: { readonly [K in TreeKind]: Tree } // same position index in both
  readonly positions: readonly Position[] // by position index
  readonly ownerOf: readonly ParticipantId[] // by position index
  readonly participants: ReadonlyMap<ParticipantId, Participant>
  readonly participantTypes: ReadonlyMap<string, ParticipantType>
  /** 1 when the position may be a payee: owner type canEarn and not terminated before the period (TR-ENG-16). */
  readonly earner: Uint8Array
}

export interface TransitionOutput {
  readonly prior: readonly (QualificationStateRow | null)[] // prior state after transition rules, by position index
  readonly report: readonly TransitionChange[]
}
/** One per (order line, credited position) after events and the customer roll-up split, sorted by order id, line id, position index. */
export interface CreditedLine {
  readonly orderId: string
  readonly lineId: string
  readonly positionIndex: number // -1 = credited to the company (still counts in market totals)
  readonly creditIndex: number // the order's credit (servicing) position before the customer roll-up split; -1 = company
  readonly customer: boolean // buyer type counts as end customer
  readonly purpose: OrderPurpose
  readonly buyerParticipantId: ParticipantId
  readonly values: readonly bigint[] // aligned with LineVolumes.measureKeys
}
export interface LineVolumes { readonly measureKeys: readonly string[]; readonly lines: readonly CreditedLine[]; readonly warnings: readonly EngineWarning[] }
export interface PositionVolumes {
  readonly byMeasure: ReadonlyMap<string, BigInt64Array> // every measure in plan order, by position index
  readonly marketTotal: ReadonlyMap<string, bigint> // volume.personal measures over every credited line
  /** The same measures over the lines of one order purpose, for each purpose a plan constraint names (pass 7). */
  readonly byPurpose: ReadonlyMap<OrderPurpose, { readonly byMeasure: ReadonlyMap<string, BigInt64Array>; readonly marketTotal: ReadonlyMap<string, bigint> }>
}
export interface QualificationOutput {
  readonly paidAs: ReadonlyMap<string, Int16Array> // ladder key -> rank index into ladder.ranks, -1 = none
  readonly titles: ReadonlyMap<string, Int16Array>
  readonly state: readonly QualificationStateRow[] // candidates, by position index
  readonly evaluations: readonly QualificationEvaluation[]
  readonly warnings: readonly EngineWarning[]
}
export interface LimitedLines<A> { readonly lines: readonly RawLine[]; readonly applications: readonly A[] }
/** breakageMinor: computed in pass 8 from the constraint and cap steps of its lines. */
export interface CapOutput extends LimitedLines<CapApplication> { readonly breakageMinor: bigint }
/**
 * Pass 10 output (D-BM-05 b, TK-B6-14): the final lines in RESULT_HASH order, made one chunk at a time when the caller
 * asks for it; each raw line is released once its chunk is made, so the whole final line array never exists at once.
 */
export interface RoundedLines { readonly count: number; readonly chunks: () => Generator<ResultLine[], void, undefined> }
export interface Settlement { readonly payees: readonly PayeeSettlement[]; readonly taxLines: readonly TaxLine[]; readonly warnings: readonly EngineWarning[] }
/** state = rows to commit: pass-3 candidates plus the onceKey of every pay.one_time line paid in this run (TS-25). */
export interface Totals { readonly controlTotals: ControlTotals; readonly resultHash: string; readonly state: readonly QualificationStateRow[]; readonly volumeSummaries: readonly PositionSummary[] }

export interface PassOutputs {
  readonly transition: TransitionOutput
  readonly lineVolumes: LineVolumes
  readonly volumes: PositionVolumes
  readonly qualification: QualificationOutput
  readonly individual: readonly RawLine[]
  readonly matching: readonly RawLine[]
  readonly pools: readonly RawLine[]
  readonly constraints: LimitedLines<ConstraintApplication> // every pass 4-6 line after per-participant limits
  readonly caps: CapOutput // every line after company caps
  readonly adjustments: readonly RawLine[]
  readonly rounding: RoundedLines
  readonly settlement: Settlement
  readonly totals: Totals
}

type Earlier<K extends PassName, T extends readonly PassName[] = typeof PASS_ORDER> = T extends readonly [infer H extends PassName, ...infer R extends readonly PassName[]]
  ? H extends K ? never : H | Earlier<K, R>
  : never
/** Outputs a pass may read: exactly the passes before it. */
export type Done<K extends PassName> = Pick<PassOutputs, Earlier<K>>
export type PassFn<K extends PassName> = (ctx: RunContext, done: Done<K>) => PassOutputs[K]
export type PassRegistry = { readonly [K in PassName]: PassFn<K> }

/**
 * S-1 memory (D-B4-22): after the last pass reading an output's lines, the runner drops those lines (keys and the
 * other fields stay). Credited lines are read up to pass 4; pass 4-6 lines up to pass 7 (pass 8 sums the breakage from
 * the steps passes 7-8 add, TK-B6-14); pass 7 lines up to pass 8 (which updates them in place); pass 8 lines up to pass 10.
 */
export const RELEASE_AFTER: { readonly [K in PassName]?: (done: Partial<PassOutputs>) => Partial<PassOutputs> } = {
  individual: (d) => ({ lineVolumes: { ...d.lineVolumes!, lines: [] } }),
  constraints: () => ({ individual: [], matching: [], pools: [] }),
  caps: (d) => ({ constraints: { ...d.constraints!, lines: [] } }),
  rounding: (d) => ({ caps: { ...d.caps!, lines: [] } }),
}

/** The passes from the first through L (run.ts streams passes 11-12 itself, D-B6-12). */
export type PassesThrough<L extends PassName> = { readonly [K in Earlier<L> | L]: PassFn<K> }

/** Runs the passes in PASS_ORDER through `last` (default: every pass). */
export function runPipeline<L extends PassName = 'totals'>(ctx: RunContext, passes: PassesThrough<L>, last?: L): Pick<PassOutputs, Earlier<L> | L> {
  let done: Partial<PassOutputs> = {}
  for (const name of PASS_ORDER) {
    const pass = (passes as Partial<PassRegistry>)[name] as (c: RunContext, d: Partial<PassOutputs>) => PassOutputs[typeof name]
    done = { ...done, [name]: pass(ctx, done) }
    done = { ...done, ...RELEASE_AFTER[name]?.(done) }
    if (name === last) break
  }
  return done as Pick<PassOutputs, Earlier<L> | L>
}

// ---------- Payout primitives (passes 4-6) ----------

export type BonusOf<K extends BonusKind> = Extract<BonusRule, { readonly kind: K }>
export type PayoutPass = 'individual' | 'matching' | 'pools'
/** Every payout primitive has this shape; run.ts dispatches plan.bonuses (in plan order) by kind. */
export type PayoutFn<K extends BonusKind, P extends PayoutPass = 'individual'> = (rule: BonusOf<K>, ctx: RunContext, done: Done<P>) => readonly RawLine[]
export const BONUS_PASS: { readonly [K in BonusKind]: PayoutPass } = {
  'pay.retail_margin': 'individual', 'pay.percent_by_level': 'individual', 'pay.generations': 'individual',
  'pay.percent_of_measure': 'individual', 'pay.differential': 'individual', 'pay.override': 'individual',
  'pay.fast_start': 'individual', 'pay.flat': 'individual', 'pay.one_time': 'individual',
  'pay.matching': 'matching', 'pay.pool': 'pools',
}

/**
 * Predicate "paid-as rank in ref.ladder >= ref.rank" by position index; null ref = always true.
 * Payees must ALSO satisfy ctx.earner[k] === 1; compression uses this predicate alone.
 */
export function holdsRank(ctx: RunContext, q: Pick<QualificationOutput, 'paidAs'>, ref: RankRef | null): (k: number) => boolean {
  if (ref === null) return () => true
  const ladder = ctx.input.plan.ladders.find((l) => l.key === ref.ladder)
  const min = ladder?.ranks.findIndex((r) => r.key === ref.rank) ?? -1
  const ranks = q.paidAs.get(ref.ladder)
  if (!ladder || min < 0 || !ranks) throw new EngineError('INVALID_INPUT', 'plan references an unknown rank', { ladder: ref.ladder, rank: ref.rank })
  return (k) => ranks[k]! >= min
}

/**
 * RESULT_HASH (FR-COMP-008, TS-03): lowercase hex sha256 (node:crypto) over UTF-8 records joined by "\n":
 *   every ResultLine in output order: JSON.stringify(['L', payeePositionId, pass, ruleKey, originType|null, originId|null, amountMinor.toString(), currency])
 *   every TaxLine by participant id:  JSON.stringify(['T', participantId, ruleId, taxableMinor.toString(), withheldMinor.toString()])
 *   every state row by position id:   JSON.stringify(['S', positionId, row]) with bigint as decimal strings, arrays sorted by key/ladder
 *   every volume summary by position id: JSON.stringify(['V', positionId, [[measure, value]...] by measure, [[ladder, rank|null]...] by ladder])
 *     (summaries come back as snapshot.history, which drives later rolling windows)
 * Output line order: payeePositionId, pass, ruleKey, originType, originId, each ascending by compareId (null first).
 * Traces are not hashed; replay compares inputsHash first, then resultHash.
 */
export const RESULT_HASH = 'sha256'
