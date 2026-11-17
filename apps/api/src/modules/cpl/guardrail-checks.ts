// Platform guardrail predicate catalogue (PLAN B3 D-B3-17, FR-CPL-007, BR-GRD-01/03): pure checks over a plan
// version's rule rows. guardrail_rule.predicate = {"check": <name>}; a check this catalogue does not know, and a rule
// it cannot see through (expressions), give a warned match with opaque = true (routed to compliance review).
import { expressionRefs, type Expr } from '@nmp/engine'

/** A plan_rule row as stored (params in stored JSON form). */
export interface GuardrailRuleRow {
  readonly rule_key: string
  readonly kind: string
  readonly params: Readonly<Record<string, unknown>>
  readonly depends_on: readonly string[]
}

/** One match: the matched rules plus their transitive dependencies (sorted), why, and whether it is opaque. */
export interface GuardrailMatch {
  readonly ruleKeys: readonly string[]
  readonly explanation: string
  readonly opaque: boolean
}

type Status = 'enrolment' | 'opaque' | 'other'
interface RankRef { readonly ladder: string; readonly rank: string }
interface Requirement { readonly kind: string; readonly measure?: string; readonly rank?: RankRef }
interface Rank { readonly key: string; readonly requires: readonly Requirement[] }

const STARTER_KIT = 'starter_kit'

/** Rule keys plus everything they depend on, transitively (guardrail_rules_hash input, D-B3-17). */
function closure(rules: ReadonlyMap<string, GuardrailRuleRow>, roots: readonly string[]): string[] {
  const seen = new Set<string>()
  const visit = (key: string): void => {
    if (seen.has(key) || !rules.has(key)) return
    seen.add(key)
    rules.get(key)!.depends_on.forEach(visit)
  }
  roots.forEach(visit)
  return [...seen].sort()
}

const combine = (statuses: readonly Status[]): Status =>
  statuses.length === 0 || statuses.includes('other') ? 'other' : statuses.includes('opaque') ? 'opaque' : 'enrolment'

/**
 * BR-GRD-01 / TS-27: a bonus paid only for enrolling. Enrolment-only measure = count.enrolled with atLeastMinor 0, or
 * one whose measure is itself enrolment-only (group sums of it too); a positive threshold on a volume is triggered by
 * the recruits' purchases and does not match (AC-CPL7-4). A pay.flat / pay.one_time matches when its eligibility rank
 * requires only enrolment-only measures.
 */
function enrolmentOnlyPay(rules: ReadonlyMap<string, GuardrailRuleRow>): GuardrailMatch[] {
  const memo = new Map<string, Status>()
  const measure = (key: string): Status => {
    const known = memo.get(key)
    if (known !== undefined) return known
    memo.set(key, 'other') // a cycle cannot make a measure enrolment-only
    const rule = rules.get(key)
    const p = rule?.params ?? {}
    const status: Status = rule === undefined ? 'other'
      : rule.kind === 'count.enrolled' ? (p.atLeastMinor === '0' ? 'enrolment' : measure(String(p.measure)))
        : rule.kind === 'volume.group' || rule.kind === 'volume.enrolled_group' ? measure(String(p.of))
          : rule.kind === 'measure.derived' ? derived(p.expr as Expr) : 'other'
    memo.set(key, status)
    return status
  }
  // An expression over enrolment-only measures alone is enrolment-only (wrapping one changes nothing); any other is opaque.
  const derived = (expr: Expr): Status => {
    const { measures, states } = expressionRefs(expr)
    return measures.length > 0 && states.length === 0 && measures.every((m) => measure(m) === 'enrolment') ? 'enrolment' : 'opaque'
  }
  const ranks = new Map<string, Status>()
  const rank = (ref: RankRef | null): Status => {
    if (ref === null) return 'other'
    const id = JSON.stringify([ref.ladder, ref.rank])
    const known = ranks.get(id)
    if (known !== undefined) return known
    ranks.set(id, 'other') // a cycle between ladders (a plan validation error) cannot make a rank enrolment-only
    const ladder = rules.get(ref.ladder)
    const def = ladder?.kind === 'ladder' ? (ladder.params.ranks as readonly Rank[]).find((r) => r.key === ref.rank) : undefined
    const status = def === undefined ? 'other'
      : combine(def.requires.map((q): Status => (q.kind === 'measure' ? measure(q.measure!) : q.kind === 'expression' ? 'opaque' : q.kind === 'rank' && q.rank?.ladder !== ref.ladder ? rank(q.rank!) : 'other')))
    ranks.set(id, status)
    return status
  }
  const matches: GuardrailMatch[] = []
  for (const rule of [...rules.values()].sort((a, b) => (a.rule_key < b.rule_key ? -1 : 1))) {
    if (!rule.kind.startsWith('pay.') || rule.kind === 'pay.matching') continue
    const p = rule.params
    const status = rule.kind === 'pay.flat' || rule.kind === 'pay.one_time'
      ? rank((p.eligibleIf as RankRef | null) ?? null)
      : measure(String(p.measure ?? p.baseMeasure))
    if (status === 'other') continue
    matches.push({
      ruleKeys: closure(rules, [rule.rule_key]),
      opaque: status === 'opaque',
      explanation: status === 'opaque'
        ? `Bonus ${rule.rule_key} depends on an expression the platform cannot check for enrolment-only pay; compliance must review it.`
        : `Bonus ${rule.rule_key} pays for enrolling alone: its base counts enrolments without any purchase or sales requirement.`,
    })
  }
  return matches
}

/** BR-GRD-03 / TS-26: personal volume that credits starter kits. */
function starterKitVolume(rules: ReadonlyMap<string, GuardrailRuleRow>): GuardrailMatch[] {
  return [...rules.values()]
    .filter((r) => r.kind === 'volume.personal' && !((r.params.items as { excludeItemClasses?: readonly string[] } | undefined)?.excludeItemClasses ?? []).includes(STARTER_KIT))
    .sort((a, b) => (a.rule_key < b.rule_key ? -1 : 1))
    .map((r) => ({
      ruleKeys: closure(rules, [r.rule_key]),
      opaque: false,
      explanation: `Measure ${r.rule_key} credits starter kits as volume; exclude item class ${STARTER_KIT} or record why it counts.`,
    }))
}

const CHECKS: Readonly<Record<string, (rules: ReadonlyMap<string, GuardrailRuleRow>) => GuardrailMatch[]>> = {
  enrolment_only_pay: enrolmentOnlyPay,
  starter_kit_volume: starterKitVolume,
}

/** Matches of one guardrail predicate over the version's rules ([] = nothing to decide). */
export function evaluatePredicate(predicate: unknown, rows: readonly GuardrailRuleRow[]): GuardrailMatch[] {
  const check = typeof predicate === 'object' && predicate !== null ? (predicate as { check?: unknown }).check : undefined
  const run = typeof check === 'string' && Object.hasOwn(CHECKS, check) ? CHECKS[check]! : null
  if (run === null) {
    return [{ ruleKeys: [], opaque: true, explanation: 'The platform cannot evaluate this guardrail automatically; compliance must review the plan.' }]
  }
  return run(new Map(rows.map((r) => [r.rule_key, r])))
}
