// Pass 0 (FR-PLN-008, BR-PLN-01, TS-24): prior qualification state by position index, after the plan version's
// transition rules when the prior state was committed under another plan version (first run of a new version).
//
// Semantics:
// - Same plan version (or no prior state): prior rows pass through unchanged, empty report.
// - A state item is `<kind>.<key>` (title.<ladder>, paid_as.<ladder>, carry.<key>, counter.<key>, one_time.<onceKey>,
//   banked.<key>). The rule is the exact item, else `<kind>.*`; an item holding a value without a rule is refused
//   (activation should have blocked it). paid_as also governs that ladder's graceUsed.
// - carry keeps the value; reset removes it (needs a reason); map renames a rank (title, paid_as only; unmapped ranks kept).
// - The report lists every item whose value changed (TS-24: "if the rule changes the value").
import { EngineError } from '../errors.js'
import type { PassFn } from '../pipeline.js'
import type { LadderRank, QualificationStateRow, TransitionChange, TransitionRule } from '../types.js'

type Kind = 'title' | 'paid_as' | 'carry' | 'counter' | 'one_time' | 'banked'
const RESET_TEXT: { readonly [K in Kind]: string } = { title: '', paid_as: '', carry: '0/0', counter: '0', one_time: '', banked: '0' }

const invalid = (message: string, details: Record<string, string>): EngineError => new EngineError('INVALID_INPUT', message, details)

function rulesOf(transitions: readonly TransitionRule[]): ReadonlyMap<string, TransitionRule> {
  const rules = new Map<string, TransitionRule>()
  for (const t of transitions) {
    if (rules.has(t.stateItem)) throw invalid('transition rule declared twice for a state item', { stateItem: t.stateItem })
    if (t.rule === 'reset' && t.reason === null) throw invalid('a reset transition needs a reason (FR-PLN-008)', { stateItem: t.stateItem })
    rules.set(t.stateItem, t)
  }
  return rules
}

/** Applies the rules to one prior row; pushes every changed item to `report`. */
function transitionRow(row: QualificationStateRow, rules: ReadonlyMap<string, TransitionRule>, report: TransitionChange[]): QualificationStateRow {
  const { positionId } = row
  /** New value text of an item, or null when reset. */
  const apply = (kind: Kind, key: string, before: string): string | null => {
    const stateItem = `${kind}.${key}`
    const t = rules.get(stateItem) ?? rules.get(`${kind}.*`)
    if (t === undefined) throw invalid('state item has no transition rule (FR-PLN-008)', { positionId, stateItem })
    let after: string | null = before
    if (t.rule === 'reset') after = null
    else if (t.rule === 'map') {
      if (kind !== 'title' && kind !== 'paid_as') throw invalid('a map transition applies to title and paid_as items only', { stateItem: t.stateItem })
      after = t.map.find((m) => m.from === before)?.to ?? before
    }
    const text = after ?? RESET_TEXT[kind]
    if (text !== before) report.push({ positionId, stateItem, rule: t.rule, before, after: text })
    return after
  }
  const ranks = (kind: 'title' | 'paid_as', list: readonly LadderRank[]): LadderRank[] =>
    list.map((r) => (r.rank === null ? r : { ladder: r.ladder, rank: apply(kind, r.ladder, r.rank) }))
  const paidAs = ranks('paid_as', row.paidAs)
  const reset = new Set(row.paidAs.filter((r, i) => r.rank !== null && paidAs[i]!.rank === null).map((r) => r.ladder))
  return {
    positionId,
    paidAs,
    titles: ranks('title', row.titles),
    graceUsed: row.graceUsed.filter((g) => !reset.has(g.ladder)),
    counters: row.counters.filter((c) => apply('counter', c.key, String(c.value)) !== null),
    carry: row.carry.filter((c) => apply('carry', c.key, `${c.amountMinor}/${c.periodsHeld}`) !== null),
    oneTimeFlags: row.oneTimeFlags.filter((key) => apply('one_time', key, 'set') !== null),
    banked: row.banked.filter((b) => apply('banked', b.key, b.amountMinor.toString()) !== null),
  }
}

export const transitionPass: PassFn<'transition'> = (ctx) => {
  const prior: (QualificationStateRow | null)[] = ctx.positions.map(() => null)
  const state = ctx.input.snapshot.priorState
  if (state === null) return { prior, report: [] }
  for (const row of state.positions) {
    const k = ctx.trees.sponsor.index.get(row.positionId)
    if (k === undefined) throw invalid('prior state names a position that is not in the snapshot', { positionId: row.positionId })
    if (prior[k] !== null) throw invalid('prior state lists a position twice', { positionId: row.positionId })
    prior[k] = row
  }
  if (state.planVersionId === ctx.input.plan.planVersionId) return { prior, report: [] }
  const rules = rulesOf(ctx.input.plan.transitions)
  const report: TransitionChange[] = [] // position index order, then the row's item order
  return { prior: prior.map((row) => row && transitionRow(row, rules, report)), report }
}
