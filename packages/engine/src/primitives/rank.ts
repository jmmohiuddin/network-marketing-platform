// Pass 3 (SDD-07 §4; BR-RNK-05..09, TS-05, TS-24, TS-63): paid-as rank per ladder, titles, maintenance + grace,
// counters and carry. Every parameter comes from the plan version; nothing here has a default (DEC-14).
//
// Semantics (the brief leaves these open; recorded in engineering/agent-memory/compensation):
// - A rank is met when all its requirements hold. Qualified rank = highest met rank; lower ranks need not be met
//   (oracle G-E2E-01). Ranks are tried from the top; evaluations record every requirement of every rank tried.
// - Paid-as = qualified rank, except when it is below last period's paid-as rank R, R has maintenance and
//   graceUsed < gracePeriods: paid-as stays R, graceUsed + 1, byGrace. Otherwise graceUsed is 0 (demotion goes
//   straight to the qualified rank). Title = max(prior title, paid-as): highest ever, stored separately.
// - Windows (BR-RNK-06): period = this period's measure; rolling n = this period + the n - 1 most recent
//   snapshot.history periods; per_order = the largest single order credited to the position (volume.personal only).
// - Leg rule (maxPerLegShare; period window; volume.group or volume.enrolled_group): value = self + sum over direct
//   legs of min(leg, share x atLeast), compared exactly in raw units (no rounding).
// - legs: direct children in `tree` whose subtree (child included) holds paid-as >= rank. A ladder may count its own
//   ranks in one tree (positions evaluated bottom-up in it); other references must name an earlier ladder.
// - Counter: prior + 1 when incrementIf holds, else 0. Carry: min(prev + new, cap) when keepIf holds, else 0.
import { EngineError } from '../errors.js'
import { conditionOf } from '../expression.js'
import { assertInt64, mulRate, parseDecimal, RAW_SCALE, toRaw } from '../money.js'
import { holdsRank, type Done, type PassFn, type RunContext } from '../pipeline.js'
import { compareId, rollUp, type Tree } from '../tree.js'
import type {
  CarryRule, EngineWarning, Ladder, LadderRank, QualificationEvaluation, QualificationStateRow, Requirement, TreeKind,
} from '../types.js'

type Inputs = Done<'qualification'>
interface Check { readonly atLeastMinor: bigint; readonly at: (k: number) => { readonly valueMinor: bigint; readonly met: boolean } }
interface Scope {
  readonly ctx: RunContext
  readonly done: Inputs
  readonly paidAs: Map<string, Int16Array>
  readonly ladderPos: ReadonlyMap<string, number>
  readonly warnings: EngineWarning[]
  readonly cache: Map<string, BigInt64Array | Int16Array>
}
/** The ladder being evaluated: its plan position and, when it counts its own ranks in legs, that tree's subtree maxima. */
interface Current { readonly pos: number; readonly own: { readonly tree: TreeKind; readonly subMax: Int16Array } | null }

export const MAX_RANKS = 32767 // Int16Array rank indexes

const invalid = (message: string, details: Record<string, string> = {}): EngineError => new EngineError('INVALID_INPUT', message, details)

function rankIndex(ladder: Ladder, rank: string): number {
  const r = ladder.ranks.findIndex((d) => d.key === rank)
  if (r < 0) throw invalid('unknown rank', { ladder: ladder.key, rank })
  return r
}

function measureValues(s: Scope, key: string): BigInt64Array {
  const v = s.done.volumes.byMeasure.get(key)
  if (!v) throw invalid('requirement names an unknown measure', { measure: key })
  return v
}

function cached<T extends BigInt64Array | Int16Array>(s: Scope, key: string, make: () => T): T {
  const hit = s.cache.get(key)
  if (hit) return hit as T
  const made = make()
  s.cache.set(key, made)
  return made
}

const byValue = (atLeastMinor: bigint, v: BigInt64Array): Check => ({ atLeastMinor, at: (k) => ({ valueMinor: v[k]!, met: v[k]! >= atLeastMinor }) })

/**
 * This period plus the periods - 1 most recent committed periods (TS-63: exactly those periods). The history used
 * must be contiguous: each period ends where the next more recent one starts, the first where this one starts.
 */
function rollingValues(s: Scope, measure: string, periods: number): BigInt64Array {
  if (!Number.isInteger(periods) || periods < 1) throw invalid('rolling window needs a whole number of periods >= 1', { measure })
  return cached(s, `rolling/${measure}/${periods}`, () => {
    const { history } = s.ctx.input.snapshot
    const used = history.slice(0, periods - 1)
    let start = s.ctx.input.snapshot.period.startsAtUs
    for (const period of used) {
      if (period.endsAtUs !== start || period.startsAtUs >= period.endsAtUs) {
        throw invalid('snapshot.history must be the contiguous earlier periods, most recent first', { periodId: period.periodId })
      }
      start = period.startsAtUs
    }
    if (used.length < periods - 1) {
      s.warnings.push({ code: 'ROLLING_WINDOW_SHORT', message: `rolling window of ${periods} periods has only ${used.length + 1} (history is shorter)`, ref: measure })
    }
    const out = measureValues(s, measure).slice()
    const index = s.ctx.trees.sponsor.index
    for (const period of used) {
      const seen = new Set<string>()
      for (const summary of period.positions) {
        if (seen.has(summary.positionId)) throw invalid('snapshot.history repeats a position in one period', { periodId: period.periodId, positionId: summary.positionId })
        seen.add(summary.positionId)
        const values = summary.measures.filter((m) => m.measure === measure)
        if (values.length > 1) throw invalid('snapshot.history repeats a measure of one position', { periodId: period.periodId, positionId: summary.positionId, measure })
        const k = index.get(summary.positionId)
        if (k !== undefined && values[0]) out[k] = assertInt64(out[k]! + values[0].valueMinor, 'rolling measure')
      }
    }
    return out
  })
}

/** Largest single order credited to each position (0 = none); lines arrive sorted by order id. */
function perOrderMax(s: Scope, measure: string): BigInt64Array {
  const rule = s.ctx.input.plan.measures.find((m) => m.key === measure)
  const j = s.done.lineVolumes.measureKeys.indexOf(measure)
  if (rule?.kind !== 'volume.personal' || j < 0) throw invalid('a per_order window needs a volume.personal measure', { measure })
  return cached(s, `per_order/${measure}`, () => {
    const out = new BigInt64Array(s.ctx.positions.length)
    let orderId: string | null = null
    let sums = new Map<number, bigint>()
    const flush = (): void => {
      for (const [k, v] of sums) if (v > out[k]!) out[k] = v
      sums = new Map()
    }
    for (const line of s.done.lineVolumes.lines) {
      if (line.orderId !== orderId) {
        flush()
        orderId = line.orderId
      }
      if (line.positionIndex >= 0) sums.set(line.positionIndex, assertInt64((sums.get(line.positionIndex) ?? 0n) + line.values[j]!, 'order measure'))
    }
    flush()
    return out
  })
}

/** Self + sum over direct legs of min(leg, share x atLeast), exact in raw units. */
function legRule(s: Scope, measure: string, atLeastMinor: bigint, share: string): Check {
  const rule = s.ctx.input.plan.measures.find((m) => m.key === measure)
  if (rule?.kind !== 'volume.group' && rule?.kind !== 'volume.enrolled_group') throw invalid('a leg rule needs a volume.group or volume.enrolled_group measure', { measure })
  const own = measureValues(s, rule.of)
  const tree: Tree = rule.kind === 'volume.group' ? s.ctx.trees[rule.tree] : s.ctx.trees.sponsor
  const leg = rule.kind === 'volume.group' ? cached(s, `group/${rule.of}/${rule.tree}`, () => rollUp(tree, own)) : own
  const legCapRaw = mulRate(toRaw(atLeastMinor), parseDecimal(share))
  const targetRaw = toRaw(atLeastMinor)
  return {
    atLeastMinor,
    at: (k) => {
      let raw = rule.includeSelf ? toRaw(own[k]!) : 0n
      for (let c = tree.childStart[k]!; c < tree.childStart[k + 1]!; c++) {
        const legRaw = toRaw(leg[tree.childList[c]!]!)
        raw += legRaw < legCapRaw ? legRaw : legCapRaw
      }
      return { valueMinor: raw / RAW_SCALE, met: raw >= targetRaw }
    },
  }
}

/** Highest paid-as rank in each subtree (position included), one bottom-up pass. */
function subtreeMax(tree: Tree, ranks: Int16Array): Int16Array {
  const out = ranks.slice()
  for (let i = tree.bfs.length - 1; i >= 0; i--) {
    const k = tree.bfs[i]!
    const p = tree.parent[k]!
    if (p >= 0 && out[k]! > out[p]!) out[p] = out[k]!
  }
  return out
}

function earlierLadder(s: Scope, ladder: string, current: Current): Ladder {
  const pos = s.ladderPos.get(ladder)
  if (pos === undefined || pos >= current.pos) throw invalid('a requirement may only reference an earlier ladder (or its own ranks through legs)', { ladder })
  return s.ctx.input.plan.ladders[pos]!
}

function compile(s: Scope, req: Requirement, current: Current): Check {
  switch (req.kind) {
    case 'measure': {
      if (req.maxPerLegShare !== null) {
        if (req.window.type !== 'period') throw invalid('a leg rule is defined for the period window only', { measure: req.measure })
        return legRule(s, req.measure, req.atLeastMinor, req.maxPerLegShare)
      }
      const w = req.window
      if (w.type === 'period') return byValue(req.atLeastMinor, measureValues(s, req.measure))
      if (w.type === 'rolling') return byValue(req.atLeastMinor, rollingValues(s, req.measure, w.periods))
      return byValue(req.atLeastMinor, perOrderMax(s, req.measure))
    }
    case 'legs': {
      const tree = s.ctx.trees[req.tree]
      const own = s.ladderPos.get(req.rank.ladder) === current.pos
      const ladder = own ? s.ctx.input.plan.ladders[current.pos]! : earlierLadder(s, req.rank.ladder, current)
      const min = rankIndex(ladder, req.rank.rank)
      const sub = own
        ? current.own!.subMax
        : cached(s, `submax/${ladder.key}/${req.tree}`, () => subtreeMax(tree, s.paidAs.get(ladder.key)!))
      return {
        atLeastMinor: BigInt(req.count),
        at: (k) => {
          let legs = 0
          for (let c = tree.childStart[k]!; c < tree.childStart[k + 1]!; c++) if (sub[tree.childList[c]!]! >= min) legs++
          return { valueMinor: BigInt(legs), met: legs >= req.count }
        },
      }
    }
    case 'profile': {
      const { ctx } = s
      return {
        atLeastMinor: 1n,
        at: (k) => {
          const met = ctx.participants.get(ctx.ownerOf[k]!)?.facts.find((f) => f.key === req.fact)?.value === req.equals
          return { valueMinor: met ? 1n : 0n, met }
        },
      }
    }
    case 'expression': {
      const holds = conditionOf(req.expr, { ctx: s.ctx, rule: s.ctx.input.plan.ladders[current.pos]!.key, measure: (key) => measureValues(s, key), prior: s.done.transition.prior })
      return { atLeastMinor: 1n, at: (k) => (holds(k) ? { valueMinor: 1n, met: true } : { valueMinor: 0n, met: false }) }
    }
    case 'rank': {
      earlierLadder(s, req.rank.ladder, current)
      const holds = holdsRank(s.ctx, s, req.rank)
      return { atLeastMinor: 1n, at: (k) => (holds(k) ? { valueMinor: 1n, met: true } : { valueMinor: 0n, met: false }) }
    }
  }
}

/** Prior rank index in `ladder` from a state list (-1 = none); a key this version does not define needs a transition map. */
function priorIndex(list: readonly LadderRank[] | undefined, ladder: Ladder, positionId: string): number {
  const rank = list?.find((e) => e.ladder === ladder.key)?.rank ?? null
  if (rank === null) return -1
  const r = ladder.ranks.findIndex((d) => d.key === rank)
  if (r < 0) throw invalid('prior state names a rank this plan version does not define (transition map missing)', { positionId, ladder: ladder.key, rank })
  return r
}

interface LadderResult { readonly paid: Int16Array; readonly title: Int16Array; readonly grace: Int32Array; readonly evaluations: readonly QualificationEvaluation[] }

function evaluateLadder(s: Scope, ladder: Ladder, pos: number): LadderResult {
  const { ctx } = s
  const n = ctx.positions.length
  const prior = s.done.transition.prior
  const ownTrees = [...new Set(ladder.ranks.flatMap((r) => r.requires.flatMap((q) => (q.kind === 'legs' && q.rank.ladder === ladder.key ? [q.tree] : []))))]
  if (ownTrees.length > 1) throw invalid('a ladder may count its own ranks in legs of one tree only', { ladder: ladder.key })
  const ownTree = ownTrees[0] ?? null
  const current: Current = { pos, own: ownTree === null ? null : { tree: ownTree, subMax: new Int16Array(n).fill(-1) } }
  const checks = ladder.ranks.map((r) => r.requires.map((q) => compile(s, q, current)))
  const paid = new Int16Array(n).fill(-1)
  const title = new Int16Array(n).fill(-1)
  const grace = new Int32Array(n)
  const evaluations = new Array<QualificationEvaluation>(n)

  const visit = (k: number): void => {
    const positionId = ctx.positions[k]!.positionId
    const checked: QualificationEvaluation['checked'][number][] = []
    let qualified = -1
    for (let r = ladder.ranks.length - 1; r >= 0 && qualified < 0; r--) {
      let all = true
      checks[r]!.forEach((check, requirement) => {
        const { valueMinor, met } = check.at(k)
        checked.push({ rank: ladder.ranks[r]!.key, requirement, valueMinor, atLeastMinor: check.atLeastMinor, met })
        all &&= met
      })
      if (all) qualified = r
    }
    const row = prior[k] ?? null
    const was = priorIndex(row?.paidAs, ladder, positionId)
    const used = row?.graceUsed.find((g) => g.ladder === ladder.key)?.periods ?? 0
    const maintenance = was >= 0 ? ladder.ranks[was]!.maintenance : null
    const byGrace = qualified < was && maintenance !== null && used < maintenance.gracePeriods
    paid[k] = byGrace ? was : qualified
    grace[k] = byGrace ? used + 1 : 0
    title[k] = Math.max(priorIndex(row?.titles, ladder, positionId), paid[k]!)
    if (current.own) {
      const tree = ctx.trees[current.own.tree]
      let m = paid[k]!
      for (let c = tree.childStart[k]!; c < tree.childStart[k + 1]!; c++) m = Math.max(m, current.own.subMax[tree.childList[c]!]!)
      current.own.subMax[k] = m
    }
    evaluations[k] = { positionId, ladder: ladder.key, paidAs: paid[k]! >= 0 ? ladder.ranks[paid[k]!]!.key : null, byGrace, checked }
  }

  if (current.own) {
    const bfs = ctx.trees[current.own.tree].bfs
    for (let i = n - 1; i >= 0; i--) visit(bfs[i]!) // children before parents
  } else {
    for (let k = 0; k < n; k++) visit(k)
  }
  return { paid, title, grace, evaluations }
}

/** TS-05 carry: min(prev + new, cap) while qualified, else 0; never below 0. */
export function carryForward(
  rule: Pick<CarryRule, 'capMinor' | 'expiresAfterPeriods'>,
  prior: { readonly amountMinor: bigint; readonly periodsHeld: number } | null,
  newMinor: bigint,
  qualified: boolean,
): { amountMinor: bigint; periodsHeld: number } {
  if (!qualified) return { amountMinor: 0n, periodsHeld: 0 }
  // shortcut: the whole balance expires once held expiresAfterPeriods periods (not per period of origin); split it if a plan needs FIFO expiry.
  const expired = prior !== null && rule.expiresAfterPeriods !== null && prior.periodsHeld >= rule.expiresAfterPeriods
  const prev = prior === null || expired ? 0n : prior.amountMinor
  let amount = prev + newMinor
  if (rule.capMinor !== null && amount > rule.capMinor) amount = rule.capMinor
  if (amount < 0n) amount = 0n
  return { amountMinor: amount, periodsHeld: amount === 0n ? 0 : prev > 0n ? prior!.periodsHeld + 1 : 1 }
}

function validateLadders(ladders: readonly Ladder[]): Map<string, number> {
  const pos = new Map<string, number>()
  ladders.forEach((l, i) => {
    if (pos.has(l.key)) throw invalid('duplicate ladder key', { ladder: l.key })
    if (l.ranks.length > MAX_RANKS) throw invalid('ladder has too many ranks', { ladder: l.key })
    if (new Set(l.ranks.map((r) => r.key)).size !== l.ranks.length) throw invalid('duplicate rank key', { ladder: l.key })
    pos.set(l.key, i)
  })
  return pos
}

export const qualificationPass: PassFn<'qualification'> = (ctx, done) => {
  const { plan } = ctx.input
  const n = ctx.positions.length
  const s: Scope = { ctx, done, paidAs: new Map(), ladderPos: validateLadders(plan.ladders), warnings: [], cache: new Map() }
  const results = plan.ladders.map((ladder, pos) => {
    const result = evaluateLadder(s, ladder, pos)
    s.paidAs.set(ladder.key, result.paid)
    return result
  })
  const titles = new Map(plan.ladders.map((l, i) => [l.key, results[i]!.title]))

  const counters = [...plan.counters].sort((a, b) => compareId(a.key, b.key)).map((c) => ({ key: c.key, holds: holdsRank(ctx, s, c.incrementIf) }))
  const carries = [...plan.carries]
    .sort((a, b) => compareId(a.key, b.key))
    .map((c) => ({ rule: c, holds: holdsRank(ctx, s, c.keepIf), values: measureValues(s, c.measure) }))
  const ladders = plan.ladders.map((l, i) => ({ l, r: results[i]! })).sort((a, b) => compareId(a.l.key, b.l.key))
  const rankKey = (l: Ladder, r: number): string | null => (r >= 0 ? l.ranks[r]!.key : null)

  const state: QualificationStateRow[] = []
  const evaluations: QualificationEvaluation[] = []
  for (let k = 0; k < n; k++) {
    const row = done.transition.prior[k] ?? null
    state.push({
      positionId: ctx.positions[k]!.positionId,
      paidAs: ladders.map(({ l, r }) => ({ ladder: l.key, rank: rankKey(l, r.paid[k]!) })),
      titles: ladders.map(({ l, r }) => ({ ladder: l.key, rank: rankKey(l, r.title[k]!) })),
      graceUsed: ladders.map(({ l, r }) => ({ ladder: l.key, periods: r.grace[k]! })),
      counters: counters.map((c) => ({ key: c.key, value: c.holds(k) ? (row?.counters.find((p) => p.key === c.key)?.value ?? 0) + 1 : 0 })),
      carry: carries.map((c) => ({ key: c.rule.key, ...carryForward(c.rule, row?.carry.find((p) => p.key === c.rule.key) ?? null, c.values[k]!, c.holds(k)) })),
      oneTimeFlags: row?.oneTimeFlags ?? [], // added by one_time lines after pass 4 (run owner)
      banked: row?.banked ?? [],
    })
    for (const r of results) evaluations.push(r.evaluations[k]!)
  }
  return { paidAs: s.paidAs, titles, state, evaluations, warnings: s.warnings }
}
