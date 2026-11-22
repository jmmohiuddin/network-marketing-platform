// A version's content: rule and transition rows, validation and compilation through the engine (D-B3-02), extension
// rules (FR-PLN-003) and the state items a later version must declare transitions for (FR-PLN-008).
import { compilePlan, parseEngineJson, renderRule, stringifyEngineJson, validatePlan, type PlanRuleInput, type PlanTransitionInput, type PlanValidation, type PlanVersion, type ReversalPolicy } from '@nmp/engine'
import type { Tx } from '@nmp/db'

export interface RuleRow {
  readonly rule_key: string
  readonly kind: string
  readonly pass: string
  readonly params: Readonly<Record<string, unknown>>
  readonly depends_on: string[]
  readonly reversal_policy: ReversalPolicy | null
  readonly calendar_id: string | null
  readonly ordinal: number
  readonly created_by: string
  readonly updated_by: string
}
export interface TransitionRow { readonly state_item: string; readonly rule: PlanTransitionInput['rule']; readonly map: PlanTransitionInput['map']; readonly reason: string | null }

export async function ruleRows(tx: Tx, versionId: string): Promise<RuleRow[]> {
  const { rows } = await tx.query<RuleRow>(
    `SELECT rule_key, kind, pass, params, depends_on, reversal_policy, calendar_id, ordinal, created_by, updated_by
     FROM plan_rule WHERE plan_version_id = $1 ORDER BY rule_key`,
    [versionId],
  )
  return rows
}

export async function transitionRows(tx: Tx, versionId: string): Promise<TransitionRow[]> {
  const { rows } = await tx.query<TransitionRow>('SELECT state_item, rule, map, reason FROM plan_transition WHERE to_version_id = $1 ORDER BY state_item', [versionId])
  return rows
}

export const engineRule = (r: RuleRow): PlanRuleInput => ({
  ruleKey: r.rule_key, kind: r.kind, params: r.params, reversalPolicy: r.reversal_policy, calendarId: r.calendar_id, ordinal: r.ordinal,
})
const engineTransition = (t: TransitionRow): PlanTransitionInput => ({ stateItem: t.state_item, rule: t.rule, map: t.map, reason: t.reason })

/**
 * Engine validation plus D-B4-21 (a): placement re-parenting is refused on a version with legs (placement_width set);
 * terminated placement positions keep their slot and the engine compresses them.
 */
export function validationOf(rules: readonly RuleRow[], calendarIds: readonly string[], placementWidth: number | null): PlanValidation {
  const engine = validatePlan(rules.map(engineRule), { calendarIds })
  const legs = placementWidth === null ? [] : rules.filter((r) => r.kind === 'genealogy.reparent_on_termination' && r.params.tree === 'placement').map((r) => ({
    ruleKey: r.rule_key, path: 'params.tree', code: 'REPARENT_PLACEMENT_WITH_LEGS',
    message: 'Placement re-parenting is not available in a tree with legs (placement width is set): terminated positions keep their slot and are compressed.',
  }))
  return legs.length === 0 ? engine : { ok: false, errors: [...engine.errors, ...legs] }
}

export const validationView = (v: PlanValidation): { ok: boolean; errors: { rule_key: string | null; code: string; path: string; message: string }[] } => ({
  ok: v.ok, errors: v.errors.map((e) => ({ rule_key: e.ruleKey, code: e.code, path: e.path, message: e.message })),
})

/**
 * Validates and compiles the version after a draft write: compiled + content_hash when valid, null while invalid, and
 * the revision moves on (D-B3-02, AC-PLN1-1). Returns the validation and the new revision.
 */
export async function recompile(tx: Tx, version: { readonly id: string; readonly version: number; readonly placement_width: number | null }, calendarIds: readonly string[]): Promise<{ validation: PlanValidation; revision: number }> {
  const rules = await ruleRows(tx, version.id)
  const validation = validationOf(rules, calendarIds, version.placement_width)
  const compiled = validation.ok
    ? stringifyEngineJson(compilePlan(rules.map(engineRule), (await transitionRows(tx, version.id)).map(engineTransition), { planVersionId: version.id, version: version.version }, calendarIds))
    : null
  const { rows } = await tx.query<{ revision: number }>(
    `UPDATE plan_version SET compiled = $2::jsonb, revision = revision + 1,
            content_hash = CASE WHEN $2::jsonb IS NULL THEN NULL ELSE digest(($2::jsonb)::text, 'sha256') END
     WHERE id = $1 RETURNING revision`,
    [version.id, compiled],
  )
  return { validation, revision: rows[0]!.revision }
}

/** Tier-2/3 rules that need a golden case before submit (FR-PLN-003): expressions and the order-structure cap module. */
export function isExtension(r: Pick<RuleRow, 'kind' | 'params'>): boolean {
  if (r.kind === 'measure.derived') return true
  if (r.kind === 'ladder') {
    const ranks = r.params.ranks
    return Array.isArray(ranks) && ranks.some((rank: { requires?: unknown }) => Array.isArray(rank.requires) && rank.requires.some((q: { kind?: unknown }) => q.kind === 'expression'))
  }
  return r.kind === 'cap' && (r.params.base as { kind?: unknown } | undefined)?.kind === 'order_structure'
}

/** minorDigits: the first plan market's digits, so volumes and amounts render as units (BUG-090). */
export function ruleView(r: RuleRow, minorDigits: number | null): Record<string, unknown> {
  const { award, ...params } = r.params as { award?: { creditType: string } }
  return {
    rule_key: r.rule_key, kind: r.kind, pass: r.pass, params, credit_type_code: award?.creditType ?? null, depends_on: r.depends_on,
    reversal_policy: r.reversal_policy, calendar_id: r.calendar_id, ordinal: r.ordinal, extension: isExtension(r), rendering: renderRule(engineRule(r), { minorDigits: minorDigits ?? undefined }),
  }
}

/** compiled jsonb text -> one PlanVersion per calendar id. */
export const parseCompiled = (text: string): Record<string, PlanVersion> => parseEngineJson<Record<string, PlanVersion>>(text)

/** State items a version keeps per position (pass 0 inputs of the next version). */
export function stateItems(compiled: Readonly<Record<string, PlanVersion>>, calendarIds: readonly string[]): string[] {
  const items = new Set<string>()
  for (const calendarId of calendarIds) {
    const plan = compiled[calendarId]
    if (plan === undefined) continue
    plan.ladders.forEach((l) => {
      items.add(`title.${l.key}`)
      items.add(`paid_as.${l.key}`)
    })
    plan.carries.forEach((c) => items.add(`carry.${c.key}`))
    plan.counters.forEach((c) => items.add(`counter.${c.key}`))
    plan.bonuses.forEach((b) => {
      if (b.kind === 'pay.one_time') items.add(`one_time.${b.onceKey}`)
    })
  }
  return [...items].sort()
}

/** Items of `items` no transition covers (exact item or `<kind>.*`). */
export function uncovered(items: readonly string[], transitions: readonly TransitionRow[]): string[] {
  const declared = new Set(transitions.map((t) => t.state_item))
  return items.filter((item) => !declared.has(item) && !declared.has(`${item.slice(0, item.indexOf('.'))}.*`))
}
