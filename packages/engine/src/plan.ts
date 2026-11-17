// Plan documents as rule rows (PLAN B3 D-B3-02, FR-PLN-001..004): per-kind parameter validation, whole-plan
// validation (references, cycles, calendar scope, caps, bonuses), compilation to one PlanVersion per calendar and
// plain-language rendering. A row's params are the engine object for its kind minus `key`/`kind` (and minus a bonus's
// `reversalPolicy`, which is the row's reversal_policy) in stored JSON form: *Minor / *Us values are decimal strings.
// Pure: the API validates with these functions and stores what compilePlan returns.
import { EngineError } from './errors.js'
import { checkExpression, expressionRefs, renderExpression, type ExprType, type PlanIssue } from './expression.js'
import { parseEngineJson } from './json.js'
import { formatRate, parseDecimal, RATE_SCALE } from './money.js'
import { MAX_RANKS } from './primitives/rank.js'
import { measureUnit } from './primitives/unilevel.js'
import { compareId } from './tree.js'
import type {
  BonusRule, CapRule, CarryRule, CounterRule, Expr, FractionalRollUp, Ladder, MeasureRule, ParticipantConstraint, PlanVersion,
  PointsFactor, PoolAllocation, RankRates, RankRef, Requirement, ReversalPolicy, TransitionRule, TreeKind,
} from './types.js'

export type { PlanIssue } from './expression.js'

export const STRUCTURAL_KINDS = ['genealogy.reparent_on_termination', 'genealogy.change_window', 'genealogy.positions_limit'] as const
export const RULE_KINDS = [
  'volume.personal', 'volume.group', 'volume.enrolled_group', 'count.customers', 'count.enrolled', 'measure.derived', 'ladder',
  'pay.retail_margin', 'pay.percent_by_level', 'pay.generations', 'pay.percent_of_measure', 'pay.differential', 'pay.override',
  'pay.matching', 'pay.fast_start', 'pay.flat', 'pay.one_time', 'pay.pool', 'limit.max_per_period', 'limit.max_share_from_purpose',
  'cap', 'carry', 'counter', 'points_factor', 'customer_roll_up', ...STRUCTURAL_KINDS,
] as const
export type RuleKind = (typeof RULE_KINDS)[number]
export type RulePass = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '10' | 'structure'

/** A plan_rule row as the engine sees it. */
export interface PlanRuleInput {
  readonly ruleKey: string
  readonly kind: string
  readonly params: unknown
  readonly reversalPolicy: ReversalPolicy | null
  readonly calendarId: string | null
  readonly ordinal: number
}
export interface PlanError extends PlanIssue { readonly ruleKey: string | null }
export interface PlanValidation { readonly ok: boolean; readonly errors: readonly PlanError[] }

const KEY = /^[a-z][a-z0-9_]{0,63}$/
const RANK_KEY = /^[A-Za-z0-9_.-]{1,64}$/
const TEXT = /^[^\u0000-\u001f]{1,100}$/
const DECIMAL = /^(0|[1-9]\d{0,17})(\.\d{1,6})?$/
const MINOR = /^(0|[1-9]\d{0,17})$/
const DAY_US = 86_400_000_000n

// ---------------------------------------- parameter schemas ----------------------------------------

type Check = (v: unknown, path: string, out: PlanIssue[]) => void
type Fields = readonly (readonly [string, Check])[]

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v)
const at = (path: string, field: string): string => (path === '' ? field : `${path}.${field}`)
const issue = (out: PlanIssue[], path: string, code: string, message: string): void => {
  out.push({ path, code, message })
}
const str = (pattern: RegExp, what: string): Check => (v, p, o) => {
  if (typeof v !== 'string' || !pattern.test(v)) issue(o, p, 'FIELD_INVALID', `must be ${what}`)
}
const key = str(KEY, 'a key (lower case letters, digits, _)')
const rankKey = str(RANK_KEY, 'a rank key')
const text = str(TEXT, 'text of 1 to 100 characters')
const decimal = str(DECIMAL, 'a non-negative decimal string with at most 6 places')
const minor = str(MINOR, 'a non-negative whole number of minor units as a string')
const int = (min: number): Check => (v, p, o) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) issue(o, p, 'FIELD_INVALID', `must be a whole number >= ${min}`)
}
const bool: Check = (v, p, o) => {
  if (typeof v !== 'boolean') issue(o, p, 'FIELD_INVALID', 'must be true or false')
}
const oneOf = (...values: readonly string[]): Check => (v, p, o) => {
  if (typeof v !== 'string' || !values.includes(v)) issue(o, p, 'FIELD_INVALID', `must be one of ${values.join(', ')}`)
}
const nullable = (c: Check): Check => (v, p, o) => {
  if (v !== null) c(v, p, o)
}
const list = (c: Check, min = 0): Check => (v, p, o) => {
  if (!Array.isArray(v) || v.length < min) return issue(o, p, 'FIELD_INVALID', `must be a list of at least ${min}`)
  v.forEach((item: unknown, i) => c(item, `${p}[${i}]`, o))
}
const refuse = (code: string, message: string): Check => (_, p, o) => issue(o, p, code, message)
/** Exactly these fields. Own keys are only tested for membership and reported sorted, so their order cannot matter. */
const obj = (fields: Fields): Check => (v, p, o) => {
  if (!isRecord(v)) return issue(o, p, 'FIELD_INVALID', 'must be an object')
  for (const [name, check] of fields) {
    if (Object.hasOwn(v, name)) check(v[name], at(p, name), o)
    else issue(o, at(p, name), 'FIELD_REQUIRED', 'is required')
  }
  const known = fields.map(([name]) => name)
  for (const name of Reflect.ownKeys(v).filter((k): k is string => typeof k === 'string').sort()) {
    if (!known.includes(name)) issue(o, at(p, name), 'FIELD_UNKNOWN', 'is not a parameter of this kind')
  }
}
/** An object whose `tag` field selects its other fields (or a whole-object check). */
const tagged = (tag: string, variants: readonly (readonly [string, Fields | Check])[]): Check => (v, p, o) => {
  const variant = isRecord(v) ? variants.find(([name]) => name === v[tag]) : undefined
  if (!variant) return issue(o, at(p, tag), 'FIELD_INVALID', `must be one of ${variants.map(([name]) => name).join(', ')}`)
  const [, rest] = variant
  if (typeof rest === 'function') return rest(v, p, o)
  obj([[tag, () => undefined], ...rest])(v, p, o)
}
const expr = (want: ExprType): Check => (v, p, o) => {
  o.push(...checkExpression(v, want, p))
}

const tree = oneOf('sponsor', 'placement')
const rankRef = obj([['ladder', key], ['rank', rankKey]])
const rankRates = obj([['ladder', key], ['rates', list(obj([['rank', rankKey], ['rate', decimal]]), 1)]])
const scope = list(key, 1)
const requirement = tagged('kind', [
  ['measure', [['measure', key], ['atLeastMinor', minor], ['window', tagged('type', [['period', []], ['rolling', [['periods', int(1)]]], ['per_order', []]])], ['maxPerLegShare', nullable(decimal)]]],
  ['legs', [['tree', tree], ['count', int(1)], ['rank', rankRef]]],
  ['profile', refuse('PROFILE_FACTS_UNAVAILABLE', 'participant profile facts are not available yet')],
  ['rank', [['rank', rankRef]]],
  ['expression', [['expr', expr('bool')]]],
])
const bonus = (fields: Fields): Fields => [['sourceKind', oneOf('retail_sale', 'downline_volume', 'enrolment_order', 'pool', 'match', 'clawback', 'other')], ['eligibleIf', nullable(rankRef)], ...fields]

const PARAMS: Readonly<Record<RuleKind, Fields>> = {
  'volume.personal': [
    ['unit', oneOf('currency', 'points')],
    ['source', tagged('from', [['volume', [['name', text]]], ['amount', []], ['amount_ex_tax', []]])],
    ['items', obj([['excludeItemClasses', list(text)], ['categories', nullable(refuse('CATEGORIES_UNAVAILABLE', 'product categories are not available yet; use null'))]])],
    ['orders', oneOf('own', 'customer', 'all')],
  ],
  'volume.group': [['of', key], ['tree', tree], ['includeSelf', bool]],
  'volume.enrolled_group': [['of', key], ['includeSelf', bool]],
  'count.customers': [['measure', key], ['minPerCustomerMinor', minor]],
  'count.enrolled': [['measure', key], ['atLeastMinor', minor]],
  'measure.derived': [['expr', expr('num')]],
  ladder: [['ranks', list(obj([['key', rankKey], ['requires', list(requirement)], ['maintenance', nullable(obj([['gracePeriods', int(1)]]))]]), 1)]],
  'pay.retail_margin': bonus([['rate', decimal], ['measure', key]]),
  'pay.percent_by_level': bonus([['tree', tree], ['measure', key], ['levels', list(decimal, 1)], ['compression', oneOf('dynamic', 'none')]]),
  'pay.generations': bonus([['tree', tree], ['measure', key], ['leader', rankRef], ['rates', list(decimal, 1)]]),
  'pay.percent_of_measure': bonus([['measure', key], ['byRank', rankRates]]),
  'pay.differential': bonus([['tree', tree], ['measure', key], ['byRank', rankRates]]),
  'pay.override': bonus([['tree', tree], ['measure', key], ['rate', decimal], ['levels', int(1)]]),
  'pay.matching': bonus([['tree', tree], ['of', list(key, 1)], ['rates', list(decimal, 1)]]),
  'pay.fast_start': bonus([['tree', tree], ['measure', key], ['buyerEnrolledWithinUs', minor], ['tiers', list(obj([['rate', decimal], ['perOrderCapMinor', minor]]), 1)]]),
  'pay.flat': bonus([['amountMinor', minor]]),
  'pay.one_time': bonus([['amountMinor', minor], ['onceKey', key]]),
  'pay.pool': bonus([['baseMeasure', key], ['rate', decimal], ['allocation', tagged('type', [
    ['shares', [['ladder', key], ['shares', list(obj([['rank', rankKey], ['shares', int(1)]]), 1)]]],
    ['rank_order', [['ladder', key], ['parts', list(obj([['rank', rankKey], ['share', decimal]]), 1)]]],
    ['first_n', [['n', int(1)], ['orderBy', key]]],
  ])]]),
  'limit.max_per_period': [['scope', scope], ['maxMinor', minor]],
  'limit.max_share_from_purpose': [['scope', scope], ['purpose', oneOf('resale', 'personal', 'unspecified', 'customer')], ['maxShare', decimal]],
  cap: [
    ['scope', scope],
    ['base', tagged('kind', [['measure', [['measure', key]]], ['order_structure', [['first', key], ['second', key], ['secondShareAbove', obj([['num', int(0)], ['den', int(1)]])], ['firstMultiplier', decimal]]]])],
    ['rate', decimal],
    ['method', tagged('type', [['proportional', []], ['priority', [['reduce', list(key, 1)]]], ['per_person', []]])],
    ['residue', oneOf('breakage')],
  ],
  carry: [['measure', key], ['capMinor', nullable(minor)], ['keepIf', nullable(rankRef)], ['expiresAfterPeriods', nullable(int(1))]],
  counter: [['incrementIf', rankRef]],
  points_factor: [['marketId', text], ['effectiveFromUs', minor], ['factor', decimal]],
  customer_roll_up: [['measures', list(key, 1)], ['shares', list(obj([['level', int(0)], ['share', decimal]]), 1)]],
  'genealogy.reparent_on_termination': [['tree', tree]],
  'genealogy.change_window': [['tree', tree], ['withinDaysOfEnrolment', int(1)]],
  'genealogy.positions_limit': [['max', int(1)]],
}

const isKind = (kind: string): kind is RuleKind => (RULE_KINDS as readonly string[]).includes(kind)
const isBonusKind = (kind: string): boolean => kind.startsWith('pay.')

/** Per-kind parameter errors (codes FIELD_*, EXPRESSION_*, PROFILE_FACTS_UNAVAILABLE, CATEGORIES_UNAVAILABLE, UNKNOWN_KIND). */
export function validateRule(kind: string, params: unknown): PlanIssue[] {
  if (!isKind(kind)) return [{ path: 'kind', code: 'UNKNOWN_KIND', message: `unknown rule kind ${kind}` }]
  const out: PlanIssue[] = []
  obj(PARAMS[kind])(params, '', out)
  if (out.length === 0) shapeIssues(kind, params as Readonly<Record<string, unknown>>, out)
  return out
}

const repeated = (keys: readonly string[], path: (i: number) => string, out: PlanIssue[]): void => {
  keys.forEach((k, i) => {
    if (keys.indexOf(k) !== i) issue(out, path(i), 'RANK_REPEATED', `${k} is listed twice`)
  })
}
const shareSum = (shares: readonly string[]): bigint => shares.reduce((a, s) => a + parseDecimal(s), 0n)

/** The single-row checks the engine makes at run time (rank.ts, pools.ts, differential.ts, caps.ts, volume.ts), made on save. */
function shapeIssues(kind: RuleKind, p: Readonly<Record<string, unknown>>, out: PlanIssue[]): void {
  switch (kind) {
    case 'ladder': {
      const l = p as unknown as Pick<Ladder, 'ranks'>
      if (l.ranks.length > MAX_RANKS) issue(out, 'ranks', 'TOO_MANY_RANKS', `a ladder has at most ${MAX_RANKS} ranks`)
      repeated(l.ranks.map((r) => r.key), (i) => `ranks[${i}].key`, out)
      l.ranks.forEach((r, i) => r.requires.forEach((q, j) => {
        if (q.kind === 'measure' && q.maxPerLegShare !== null && q.window.type !== 'period') issue(out, `ranks[${i}].requires[${j}].window`, 'LEG_RULE_INVALID', 'a leg rule (maxPerLegShare) is defined for the period window only')
      }))
      return
    }
    case 'pay.percent_of_measure':
    case 'pay.differential':
      return repeated((p.byRank as RankRates).rates.map((r) => r.rank), (i) => `byRank.rates[${i}].rank`, out)
    case 'pay.pool': {
      const a = p.allocation as PoolAllocation
      if (a.type === 'shares') repeated(a.shares.map((x) => x.rank), (i) => `allocation.shares[${i}].rank`, out)
      if (a.type !== 'rank_order') return
      repeated(a.parts.map((x) => x.rank), (i) => `allocation.parts[${i}].rank`, out)
      if (shareSum(a.parts.map((x) => x.share)) > RATE_SCALE) issue(out, 'allocation.parts', 'SHARES_EXCEED_ONE', 'the parts of the pool sum to more than 1')
      return
    }
    case 'cap':
      if ((p.method as CapRule['method']).type === 'per_person' && (p.base as CapRule['base']).kind !== 'measure') issue(out, 'base', 'CAP_BASE_INVALID', 'a per_person cap needs a measure base')
      return
    case 'customer_roll_up': {
      const r = p as unknown as FractionalRollUp
      r.shares.forEach((x, i) => {
        if (r.shares.findIndex((y) => y.level === x.level) !== i) issue(out, `shares[${i}].level`, 'LEVEL_REPEATED', `level ${x.level} is listed twice`)
      })
      if (shareSum(r.shares.map((x) => x.share)) !== RATE_SCALE) issue(out, 'shares', 'SHARES_NOT_ONE', 'the shares must sum to exactly 1')
      return
    }
    default:
  }
}

const PASSES: Readonly<Record<RuleKind, RulePass>> = {
  'volume.personal': '1', customer_roll_up: '1', 'volume.group': '2', 'volume.enrolled_group': '2', 'count.customers': '2',
  'count.enrolled': '2', 'measure.derived': '2', ladder: '3', carry: '3', counter: '3', 'pay.retail_margin': '4',
  'pay.percent_by_level': '4', 'pay.generations': '4', 'pay.percent_of_measure': '4', 'pay.differential': '4', 'pay.override': '4',
  'pay.fast_start': '4', 'pay.flat': '4', 'pay.one_time': '4', 'pay.matching': '5', 'pay.pool': '6', 'limit.max_per_period': '7',
  'limit.max_share_from_purpose': '7', cap: '8', points_factor: '10', 'genealogy.reparent_on_termination': 'structure',
  'genealogy.change_window': 'structure', 'genealogy.positions_limit': 'structure',
}

/** The engine pass a kind runs in (plan_rule.pass); 'structure' = read by genealogy, ignored by runs. */
export function rulePass(kind: RuleKind): RulePass {
  return PASSES[kind]
}

// ---------------------------------------- typed rules and references ----------------------------------------

type Item =
  | { readonly as: 'measure'; readonly m: MeasureRule }
  | { readonly as: 'ladder'; readonly l: Ladder }
  | { readonly as: 'bonus'; readonly b: BonusRule }
  | { readonly as: 'constraint'; readonly c: ParticipantConstraint }
  | { readonly as: 'cap'; readonly c: CapRule }
  | { readonly as: 'carry'; readonly c: CarryRule }
  | { readonly as: 'counter'; readonly c: CounterRule }
  | { readonly as: 'points'; readonly p: PointsFactor }
  | { readonly as: 'rollUp'; readonly r: FractionalRollUp }
  | { readonly as: 'structure' }
type Target = 'measure' | 'ladder' | 'bonus' | 'carry' | 'counter'
/** edge = ordering dependency (prior-period state reads and a ladder's own legs are not). */
interface Ref { readonly path: string; readonly target: Target; readonly key: string; readonly rank: string | null; readonly edge: boolean }

/** The engine object of a row whose params passed validateRule. */
function itemOf(rule: PlanRuleInput): Item {
  const p = parseEngineJson<Record<string, unknown>>(JSON.stringify(rule.params))
  const kind = rule.kind as RuleKind
  const keyed = { key: rule.ruleKey, kind, ...p }
  if (PASSES[kind] === 'structure') return { as: 'structure' }
  if (kind.startsWith('volume.') || kind.startsWith('count.') || kind === 'measure.derived') return { as: 'measure', m: keyed as unknown as MeasureRule }
  if (kind === 'ladder') return { as: 'ladder', l: { key: rule.ruleKey, ranks: p.ranks as Ladder['ranks'] } }
  if (isBonusKind(kind)) return { as: 'bonus', b: { ...keyed, reversalPolicy: rule.reversalPolicy } as unknown as BonusRule }
  if (kind.startsWith('limit.')) return { as: 'constraint', c: keyed as unknown as ParticipantConstraint }
  if (kind === 'cap') return { as: 'cap', c: { key: rule.ruleKey, ...p } as unknown as CapRule }
  if (kind === 'carry') return { as: 'carry', c: { key: rule.ruleKey, ...p } as unknown as CarryRule }
  if (kind === 'counter') return { as: 'counter', c: { key: rule.ruleKey, ...p } as unknown as CounterRule }
  if (kind === 'points_factor') return { as: 'points', p: p as unknown as PointsFactor }
  return { as: 'rollUp', r: p as unknown as FractionalRollUp }
}

function exprRefs(e: Expr, path: string): Ref[] {
  const { measures, states } = expressionRefs(e)
  return [
    ...measures.map((m): Ref => ({ path, target: 'measure', key: m, rank: null, edge: true })),
    ...states.map((s): Ref => ({ path, target: s.startsWith('carry.') ? 'carry' : 'counter', key: s.slice(s.indexOf('.') + 1), rank: null, edge: false })),
  ]
}
const measureRef = (path: string, k: string): Ref => ({ path, target: 'measure', key: k, rank: null, edge: true })
const rankRefOf = (path: string, r: RankRef): Ref => ({ path, target: 'ladder', key: r.ladder, rank: r.rank, edge: true })
const bonusRef = (path: string, k: string): Ref => ({ path, target: 'bonus', key: k, rank: null, edge: true })

function requirementRefs(ladder: string, q: Requirement, path: string): Ref[] {
  switch (q.kind) {
    case 'measure':
      return [measureRef(`${path}.measure`, q.measure)]
    case 'legs':
      return [{ ...rankRefOf(`${path}.rank`, q.rank), edge: q.rank.ladder !== ladder }]
    case 'rank':
      return [rankRefOf(`${path}.rank`, q.rank)]
    case 'expression':
      return exprRefs(q.expr, `${path}.expr`)
    case 'profile':
      return []
  }
}

function bonusRefs(b: BonusRule): Ref[] {
  const refs: Ref[] = b.eligibleIf ? [rankRefOf('eligibleIf', b.eligibleIf)] : []
  if ('measure' in b) refs.push(measureRef('measure', b.measure))
  if ('leader' in b) refs.push(rankRefOf('leader', b.leader))
  if ('byRank' in b) refs.push(...b.byRank.rates.map((r, i) => rankRefOf(`byRank.rates[${i}].rank`, { ladder: b.byRank.ladder, rank: r.rank })))
  if (b.kind === 'pay.matching') refs.push(...b.of.map((k, i) => bonusRef(`of[${i}]`, k)))
  if (b.kind === 'pay.pool') {
    refs.push(measureRef('baseMeasure', b.baseMeasure))
    const a = b.allocation
    if (a.type === 'first_n') refs.push(measureRef('allocation.orderBy', a.orderBy))
    else if (a.type === 'shares') refs.push(...a.shares.map((s, i) => rankRefOf(`allocation.shares[${i}].rank`, { ladder: a.ladder, rank: s.rank })))
    else refs.push(...a.parts.map((s, i) => rankRefOf(`allocation.parts[${i}].rank`, { ladder: a.ladder, rank: s.rank })))
  }
  return refs
}

function refsOf(item: Item): Ref[] {
  switch (item.as) {
    case 'measure': {
      const m = item.m
      if (m.kind === 'volume.group' || m.kind === 'volume.enrolled_group') return [measureRef('of', m.of)]
      if (m.kind === 'count.customers' || m.kind === 'count.enrolled') return [measureRef('measure', m.measure)]
      return m.kind === 'measure.derived' ? exprRefs(m.expr, 'expr') : []
    }
    case 'ladder':
      return item.l.ranks.flatMap((r, i) => r.requires.flatMap((q, j) => requirementRefs(item.l.key, q, `ranks[${i}].requires[${j}]`)))
    case 'bonus':
      return bonusRefs(item.b)
    case 'constraint':
      return item.c.scope.map((k, i) => bonusRef(`scope[${i}]`, k))
    case 'cap': {
      const c = item.c
      const base = c.base.kind === 'measure' ? [measureRef('base.measure', c.base.measure)] : [measureRef('base.first', c.base.first), measureRef('base.second', c.base.second)]
      return [...c.scope.map((k, i) => bonusRef(`scope[${i}]`, k)), ...base]
    }
    case 'carry':
      return [measureRef('measure', item.c.measure), ...(item.c.keepIf ? [rankRefOf('keepIf', item.c.keepIf)] : [])]
    case 'counter':
      return [rankRefOf('incrementIf', item.c.incrementIf)]
    case 'rollUp':
      return item.r.measures.map((k, i) => measureRef(`measures[${i}]`, k))
    case 'points':
    case 'structure':
      return []
  }
}

/** Rule keys a valid row depends on (plan_rule.depends_on), sorted; [] when its params are invalid. */
export function ruleDependencies(rule: PlanRuleInput): string[] {
  if (validateRule(rule.kind, rule.params).length > 0) return []
  return [...new Set(refsOf(itemOf(rule)).map((r) => r.key))].filter((k) => k !== rule.ruleKey).sort(compareId)
}

// ---------------------------------------- whole-plan validation ----------------------------------------

const targetOf = (item: Item): Target | null => (item.as === 'measure' || item.as === 'ladder' || item.as === 'bonus' || item.as === 'carry' || item.as === 'counter' ? item.as : null)

interface Parsed { readonly rule: PlanRuleInput; readonly item: Item; readonly refs: readonly Ref[] }

/**
 * Codes: per-kind codes (validateRule), UNKNOWN_CALENDAR, UNKNOWN_REFERENCE, CYCLIC_DEPENDENCY, CALENDAR_SCOPE_CONFLICT,
 * MEASURE_NOT_PERSONAL, REVERSAL_POLICY_MISSING / _NOT_APPLICABLE, ORDER_LINE_MEASURE_INVALID, PRIORITY_INCOMPLETE, CAP_PRECEDENCE_MISSING,
 * DUPLICATE_RULE_KIND, STRUCTURAL_RULE_SCOPED, POINTS_FACTOR_MISSING. Sorted by rule key, path, code.
 */
export function validatePlan(rules: readonly PlanRuleInput[], context: { readonly calendarIds: readonly string[] }): PlanValidation {
  const errors: PlanError[] = []
  const add = (ruleKey: string | null, path: string, code: string, message: string): void => {
    errors.push({ ruleKey, path, code, message })
  }
  const parsed: Parsed[] = []
  for (const rule of rules) {
    const issues = validateRule(rule.kind, rule.params)
    issues.forEach((i) => add(rule.ruleKey, i.path, i.code, i.message))
    if (rule.calendarId !== null && !context.calendarIds.includes(rule.calendarId)) add(rule.ruleKey, 'calendar_id', 'UNKNOWN_CALENDAR', 'the calendar is not a calendar of the plan')
    if (isBonusKind(rule.kind) && rule.reversalPolicy === null) add(rule.ruleKey, 'reversal_policy', 'REVERSAL_POLICY_MISSING', 'every bonus names its reversal policy')
    if (!isBonusKind(rule.kind) && rule.reversalPolicy !== null) add(rule.ruleKey, 'reversal_policy', 'REVERSAL_POLICY_NOT_APPLICABLE', 'only bonuses have a reversal policy')
    if (issues.length > 0) continue
    const item = itemOf(rule)
    if (item.as === 'structure' && rule.calendarId !== null) add(rule.ruleKey, 'calendar_id', 'STRUCTURAL_RULE_SCOPED', 'a genealogy rule applies to the whole market, not a calendar')
    parsed.push({ rule, item, refs: refsOf(item) })
  }
  const byKey = new Map(parsed.map((p) => [p.rule.ruleKey, p]))
  for (const p of parsed) checkRefs(p, byKey, add)
  checkOrderLineMeasures(parsed, byKey, add)
  checkCaps(parsed, add)
  checkSingletons(parsed, add)
  checkCycles(parsed, byKey, add)
  checkEngineShapes(parsed, byKey, add, !errors.some((e) => e.code === 'UNKNOWN_REFERENCE' || e.code === 'CYCLIC_DEPENDENCY'))
  const points = parsed.some((p) => p.item.as === 'measure' && p.item.m.kind === 'volume.personal' && p.item.m.unit === 'points')
  if (points && !parsed.some((p) => p.item.as === 'points')) add(null, '', 'POINTS_FACTOR_MISSING', 'a points measure needs a points_factor rule')
  errors.sort((a, b) => compareId(a.ruleKey ?? '', b.ruleKey ?? '') || compareId(a.path, b.path) || compareId(a.code, b.code))
  return { ok: errors.length === 0, errors }
}

type Add = (ruleKey: string | null, path: string, code: string, message: string) => void

function checkRefs(p: Parsed, byKey: ReadonlyMap<string, Parsed>, add: Add): void {
  for (const r of p.refs) {
    const target = byKey.get(r.key)
    if (!target || targetOf(target.item) !== r.target) {
      add(p.rule.ruleKey, r.path, 'UNKNOWN_REFERENCE', `names unknown ${r.target} ${r.key}`)
      continue
    }
    if (r.rank !== null && target.item.as === 'ladder' && !target.item.l.ranks.some((x) => x.key === r.rank)) {
      add(p.rule.ruleKey, r.path, 'UNKNOWN_REFERENCE', `names unknown rank ${r.rank} of ladder ${r.key}`)
    }
    const mine = p.rule.calendarId
    const theirs = target.rule.calendarId
    if (theirs !== null && theirs !== mine) add(p.rule.ruleKey, r.path, 'CALENDAR_SCOPE_CONFLICT', `depends on ${r.key}, which runs only in another calendar`)
  }
  const personalOnly = (k: string): boolean => {
    const t = byKey.get(k)?.item
    return t?.as === 'measure' && t.m.kind === 'volume.personal'
  }
  personalMeasures(p.item).filter((k) => byKey.has(k) && !personalOnly(k)).forEach((k) => add(p.rule.ruleKey, '', 'MEASURE_NOT_PERSONAL', `${k} must be a volume.personal measure here`))
}

const WALKING = ['pay.percent_by_level', 'pay.override', 'pay.differential', 'pay.generations', 'pay.fast_start']

/** Measures the engine reads per order line or as market totals: only volume.personal ones have those values. */
function personalMeasures(item: Item): readonly string[] {
  if (item.as === 'rollUp') return item.r.measures
  if (item.as === 'measure' && item.m.kind === 'count.customers') return [item.m.measure]
  if (item.as === 'bonus' && WALKING.includes(item.b.kind) && 'measure' in item.b) return [item.b.measure] // the primitive walks the tree itself
  if (item.as === 'bonus' && item.b.kind === 'pay.pool') return [item.b.baseMeasure]
  if (item.as === 'cap') return item.c.base.kind === 'measure' ? [item.c.base.measure] : [item.c.base.first, item.c.base.second]
  return []
}

/** BR-REV-07: an order_line bonus pays on a measure built from order lines (personal, or one roll-up of a personal one). */
function checkOrderLineMeasures(parsed: readonly Parsed[], byKey: ReadonlyMap<string, Parsed>, add: Add): void {
  const traced = ['pay.retail_margin', 'pay.percent_by_level', 'pay.generations', 'pay.percent_of_measure', 'pay.differential', 'pay.override']
  const measureOf = (k: string): MeasureRule | null => {
    const t = byKey.get(k)?.item
    return t?.as === 'measure' ? t.m : null
  }
  for (const p of parsed) {
    if (p.item.as !== 'bonus' || p.item.b.reversalPolicy !== 'order_line' || !traced.includes(p.item.b.kind) || !('measure' in p.item.b)) continue
    const m = measureOf(p.item.b.measure)
    const base = m && (m.kind === 'volume.group' || m.kind === 'volume.enrolled_group') ? measureOf(m.of) : m
    if (m && base?.kind !== 'volume.personal') {
      add(p.rule.ruleKey, 'measure', 'ORDER_LINE_MEASURE_INVALID', 'an order_line bonus pays on a personal or group volume measure; use the restatement policy for other measures')
    }
  }
}

function checkCaps(parsed: readonly Parsed[], add: Add): void {
  const caps = parsed.flatMap((p) => (p.item.as === 'cap' ? [{ p, c: p.item.c }] : []))
  for (const { p, c } of caps) {
    if (c.method.type !== 'priority') continue
    const reduce = c.method.reduce
    reduce.forEach((k, i) => {
      if (!c.scope.includes(k)) add(p.rule.ruleKey, `method.reduce[${i}]`, 'UNKNOWN_REFERENCE', `${k} is not in the cap's scope`)
    })
    const missing = c.scope.filter((k) => !reduce.includes(k))
    if (missing.length > 0) add(p.rule.ruleKey, 'method.reduce', 'PRIORITY_INCOMPLETE', `the priority list misses ${missing.join(', ')}`)
  }
  caps.forEach(({ p, c }, i) => {
    for (const other of caps.slice(0, i)) {
      if (other.p.rule.ordinal === p.rule.ordinal && other.c.scope.some((k) => c.scope.includes(k))) {
        add(p.rule.ruleKey, 'ordinal', 'CAP_PRECEDENCE_MISSING', `shares a bonus with cap ${other.p.rule.ruleKey} at the same ordinal; give them distinct ordinals`)
      }
    }
  })
}

function checkSingletons(parsed: readonly Parsed[], add: Add): void {
  for (const kind of ['customer_roll_up', ...STRUCTURAL_KINDS]) {
    parsed.filter((p) => p.rule.kind === kind).slice(1).forEach((p) => add(p.rule.ruleKey, 'kind', 'DUPLICATE_RULE_KIND', `a plan version has at most one ${kind} rule`))
  }
}

/** The cross-rule checks the engine makes at run time (unilevel.ts, matching.ts, rank.ts, volume.ts), made on save. */
function checkEngineShapes(parsed: readonly Parsed[], byKey: ReadonlyMap<string, Parsed>, add: Add, referencesOk: boolean): void {
  const measures = parsed.flatMap((p) => (p.item.as === 'measure' ? [p.item.m] : []))
  const measureOf = (k: string): MeasureRule | null => measures.find((m) => m.key === k) ?? null
  const points: Parsed[] = []
  for (const p of parsed) {
    const item = p.item
    if (item.as === 'bonus' && (item.b.kind === 'pay.retail_margin' || item.b.kind === 'pay.percent_of_measure') && referencesOk) {
      try {
        measureUnit({ measures }, item.b.measure)
      } catch (e) {
        if (!(e instanceof EngineError)) throw e
        add(p.rule.ruleKey, 'measure', 'MEASURE_NOT_PAYABLE', `${item.b.measure} holds no currency or points volume of one unit (${e.message})`)
      }
    }
    if (item.as === 'bonus' && item.b.kind === 'pay.matching') {
      item.b.of.forEach((k, i) => {
        const t = byKey.get(k)
        if (t?.item.as === 'bonus' && PASSES[t.rule.kind as RuleKind] !== '4') add(p.rule.ruleKey, `of[${i}]`, 'MATCHING_NOT_INDIVIDUAL', `${k} is not a bonus paid before matching`)
      })
    }
    if (item.as === 'ladder') checkLadderShapes(p.rule.ruleKey, item.l, measureOf, add)
    if (item.as === 'points') {
      const f = item.p
      const twin = points.find((o) => o.item.as === 'points' && o.item.p.marketId === f.marketId && o.item.p.effectiveFromUs === f.effectiveFromUs && (o.rule.calendarId === null || p.rule.calendarId === null || o.rule.calendarId === p.rule.calendarId))
      if (twin) add(p.rule.ruleKey, 'effectiveFromUs', 'POINTS_FACTOR_DUPLICATE', `shares market and effective date with ${twin.rule.ruleKey}`)
      points.push(p)
    }
  }
}

function checkLadderShapes(ladder: string, l: Ladder, measureOf: (k: string) => MeasureRule | null, add: Add): void {
  const ownTrees = new Set<string>()
  l.ranks.forEach((r, i) => r.requires.forEach((q, j) => {
    const path = `ranks[${i}].requires[${j}]`
    if (q.kind === 'legs' && q.rank.ladder === ladder) ownTrees.add(q.tree)
    if (q.kind !== 'measure') return
    const m = measureOf(q.measure)
    if (m === null) return
    if (q.window.type === 'per_order' && m.kind !== 'volume.personal') add(ladder, `${path}.measure`, 'MEASURE_NOT_PERSONAL', 'a per_order window needs a volume.personal measure')
    if (q.maxPerLegShare !== null && m.kind !== 'volume.group' && m.kind !== 'volume.enrolled_group') add(ladder, `${path}.measure`, 'LEG_RULE_INVALID', 'a leg rule needs a volume.group or volume.enrolled_group measure')
  }))
  if (ownTrees.size > 1) add(ladder, 'ranks', 'LEG_RULE_INVALID', 'a ladder may count its own ranks in legs of one tree only')
}

function checkCycles(parsed: readonly Parsed[], byKey: ReadonlyMap<string, Parsed>, add: Add): void {
  const state = new Map<string, 'visiting' | 'done'>()
  const cyclic = new Set<string>()
  const stack: string[] = []
  const visit = (k: string): void => {
    state.set(k, 'visiting')
    stack.push(k)
    for (const r of byKey.get(k)!.refs) {
      if (!r.edge || !byKey.has(r.key)) continue
      if (state.get(r.key) === 'visiting') stack.slice(stack.indexOf(r.key)).forEach((c) => cyclic.add(c))
      else if (!state.has(r.key)) visit(r.key)
    }
    stack.pop()
    state.set(k, 'done')
  }
  for (const k of [...byKey.keys()].sort(compareId)) if (!state.has(k)) visit(k)
  for (const k of [...cyclic].sort(compareId)) add(k, '', 'CYCLIC_DEPENDENCY', 'the rule depends on itself through other rules')
}

// ---------------------------------------- compilation ----------------------------------------

export interface PlanTransitionInput { readonly stateItem: string; readonly rule: TransitionRule['rule']; readonly map: TransitionRule['map']; readonly reason: string | null }

const byOrdinal = (a: Parsed, b: Parsed): number => a.rule.ordinal - b.rule.ordinal || compareId(a.rule.ruleKey, b.rule.ruleKey)

/** Dependency order (edges only), ties by ordinal then rule key. */
function topological(items: readonly Parsed[]): Parsed[] {
  const keys = new Set(items.map((p) => p.rule.ruleKey))
  const placed = new Set<string>()
  const out: Parsed[] = []
  let left = [...items].sort(byOrdinal)
  while (left.length > 0) {
    const next = left.find((p) => p.refs.every((r) => !r.edge || r.key === p.rule.ruleKey || !keys.has(r.key) || placed.has(r.key)))
    if (!next) throw new EngineError('INVALID_INPUT', 'plan has a dependency cycle')
    placed.add(next.rule.ruleKey)
    out.push(next)
    left = left.filter((p) => p !== next)
  }
  return out
}

/**
 * One PlanVersion per calendar (PLAN D-B3-02/03): the unscoped rules plus the calendar's own, with contentHash "" and
 * effectiveFromUs 0 (readers fill both). Throws INVALID_INPUT unless validatePlan(rules) is ok.
 */
export function compilePlan(
  rules: readonly PlanRuleInput[],
  transitions: readonly PlanTransitionInput[],
  version: { readonly planVersionId: string; readonly version: number },
  calendars: readonly string[],
): Record<string, PlanVersion> {
  const validation = validatePlan(rules, { calendarIds: calendars })
  if (!validation.ok) throw new EngineError('INVALID_INPUT', 'the plan is not valid', { code: validation.errors[0]!.code, rule: validation.errors[0]!.ruleKey ?? '' })
  const parsed = rules.map((rule): Parsed => {
    const item = itemOf(rule)
    return { rule, item, refs: refsOf(item) }
  })
  const compiled = calendars.map((calendar): [string, PlanVersion] => {
    const mine = parsed.filter((p) => p.rule.calendarId === null || p.rule.calendarId === calendar)
    const of = <A extends Item['as']>(as: A): Parsed[] => mine.filter((p) => p.item.as === as)
    const pick = <T>(list: readonly Parsed[], f: (i: Item) => T): T[] => list.map((p) => f(p.item))
    const rollUp = of('rollUp')[0]?.item
    return [calendar, {
      planVersionId: version.planVersionId,
      version: version.version,
      contentHash: '',
      effectiveFromUs: 0n,
      calendars: [calendar],
      measures: pick(topological(of('measure')), (i) => (i as Extract<Item, { as: 'measure' }>).m),
      ladders: pick(topological(of('ladder')), (i) => (i as Extract<Item, { as: 'ladder' }>).l),
      bonuses: pick(of('bonus').sort(byOrdinal), (i) => (i as Extract<Item, { as: 'bonus' }>).b),
      constraints: pick(of('constraint').sort(byOrdinal), (i) => (i as Extract<Item, { as: 'constraint' }>).c),
      caps: pick(of('cap').sort(byOrdinal), (i) => (i as Extract<Item, { as: 'cap' }>).c),
      carries: pick(of('carry').sort(byOrdinal), (i) => (i as Extract<Item, { as: 'carry' }>).c),
      counters: pick(of('counter').sort(byOrdinal), (i) => (i as Extract<Item, { as: 'counter' }>).c),
      transitions: [...transitions].sort((a, b) => compareId(a.stateItem, b.stateItem)).map((t) => ({ stateItem: t.stateItem, rule: t.rule, map: t.map, reason: t.reason })),
      pointsToCurrency: pick(of('points').sort(byOrdinal), (i) => (i as Extract<Item, { as: 'points' }>).p),
      customerRollUp: rollUp?.as === 'rollUp' ? rollUp.r : null,
    }]
  })
  return Object.fromEntries(compiled)
}

// ---------------------------------------- plain language ----------------------------------------

const pct = (d: string): string => `${formatRate(parseDecimal(d) * 100n)} %`
const rankText = (r: RankRef): string => `${r.ladder} ≥ ${r.rank}`
const minorText = (v: bigint): string => `${v} minor units`
const levelsText = (n: number): string => (n === 1 ? 'level 1' : `levels 1–${n}`)
const durationText = (us: bigint): string => (us % DAY_US === 0n ? `${us / DAY_US} days` : `${us} µs`)
const ratesByRank = (r: { readonly ladder: string; readonly rates: readonly { readonly rank: string; readonly rate: string }[] }): string =>
  `by ${r.ladder} rank (${r.rates.map((x) => `${x.rank} ${pct(x.rate)}`).join(', ')})`

function requirementText(q: Requirement): string {
  switch (q.kind) {
    case 'measure': {
      const w = q.window.type === 'rolling' ? ` over ${q.window.periods} periods` : q.window.type === 'per_order' ? ' in one order' : ''
      const leg = q.maxPerLegShare === null ? '' : `, each leg counting at most ${pct(q.maxPerLegShare)} of it`
      return `${q.measure} ≥ ${minorText(q.atLeastMinor)}${w}${leg}`
    }
    case 'legs':
      return `${q.count} ${q.tree} legs with ${rankText(q.rank)}`
    case 'rank':
      return `holds ${rankText(q.rank)}`
    case 'expression':
      return renderExpression(q.expr)
    case 'profile':
      return `profile ${q.fact} is "${q.equals}"`
  }
}

function measureText(m: MeasureRule): string {
  switch (m.kind) {
    case 'volume.personal': {
      const source = m.source.from === 'volume' ? `volume "${m.source.name}" per unit` : m.source.from === 'amount' ? 'order amount' : 'order amount less tax'
      const orders = { own: 'own (non-customer) orders', customer: 'end-customer orders', all: 'all orders' }[m.orders]
      const excluded = m.items.excludeItemClasses.length > 0 ? `, excluding item classes ${m.items.excludeItemClasses.join(', ')}` : ''
      return `Personal ${m.unit === 'points' ? 'points' : 'volume'} from the ${source} of ${orders}${excluded}`
    }
    case 'volume.group':
      return `Group volume: ${m.of} summed over the ${m.tree} tree, ${m.includeSelf ? 'including' : 'excluding'} the position itself`
    case 'volume.enrolled_group':
      return `${m.of} summed over personally enrolled positions, ${m.includeSelf ? 'including' : 'excluding'} the position itself`
    case 'count.customers':
      return `Count of end customers with at least ${minorText(m.minPerCustomerMinor)} of ${m.measure}`
    case 'count.enrolled':
      return `Count of personally enrolled positions with ${m.measure} ≥ ${minorText(m.atLeastMinor)}`
    case 'measure.derived':
      return `Derived measure ${renderExpression(m.expr)}, rounded half-up to a whole minor unit`
  }
}

function bonusText(b: BonusRule): string {
  const body = ((): string => {
    switch (b.kind) {
      case 'pay.retail_margin':
        return `Pays ${pct(b.rate)} of ${b.measure} as retail margin`
      case 'pay.percent_by_level':
        return `Pays ${b.levels.map(pct).join(', ')} of ${b.measure} on ${b.tree} ${levelsText(b.levels.length)}; compression ${b.compression}`
      case 'pay.generations':
        return `Pays ${b.rates.map(pct).join(', ')} of ${b.measure} on ${b.tree} generations 1–${b.rates.length} led by ${rankText(b.leader)}`
      case 'pay.percent_of_measure':
        return `Pays ${ratesByRank(b.byRank)} of ${b.measure}`
      case 'pay.differential':
        return `Pays the rate difference ${ratesByRank(b.byRank)} of ${b.measure} down the ${b.tree} tree`
      case 'pay.override':
        return `Pays ${pct(b.rate)} of ${b.measure} on ${b.tree} ${levelsText(b.levels)}`
      case 'pay.matching':
        return `Matches ${b.rates.map(pct).join(', ')} of ${b.of.join(', ')} on ${b.tree} generations 1–${b.rates.length}`
      case 'pay.fast_start':
        return `Pays ${b.tiers.map((t) => `${pct(t.rate)} (at most ${minorText(t.perOrderCapMinor)} per order)`).join(', ')} of ${b.measure} on orders of buyers enrolled within ${durationText(b.buyerEnrolledWithinUs)}, up the ${b.tree} tree`
      case 'pay.flat':
        return `Pays ${minorText(b.amountMinor)} each period`
      case 'pay.one_time':
        return `Pays ${minorText(b.amountMinor)} once per position (${b.onceKey})`
      case 'pay.pool': {
        const a = b.allocation
        const split = a.type === 'shares' ? `shares by ${a.ladder} rank (${a.shares.map((s) => `${s.rank} ${s.shares}`).join(', ')})`
          : a.type === 'rank_order' ? `parts by ${a.ladder} rank (${a.parts.map((s) => `${s.rank} ${pct(s.share)}`).join(', ')})`
            : `the first ${a.n} by ${a.orderBy}`
        return `Pools ${pct(b.rate)} of the market's ${b.baseMeasure}, split by ${split}`
      }
    }
  })()
  const policy = b.reversalPolicy === 'order_line' ? 'order line' : b.reversalPolicy === 'restatement' ? 'restatement' : 'not set'
  return `${body}; reversal: ${policy}; paid to ${b.eligibleIf ? `holders of ${rankText(b.eligibleIf)}` : 'every earner'}`
}

function itemText(item: Item, rule: PlanRuleInput): string {
  const p = item.as === 'structure' ? (rule.params as Readonly<Record<string, TreeKind | number>>) : null
  switch (item.as) {
    case 'measure':
      return measureText(item.m)
    case 'ladder':
      return `Ladder ${item.l.ranks.map((r) => `${r.key}: ${r.requires.length === 0 ? 'always held' : r.requires.map(requirementText).join(' and ')}${r.maintenance ? ` (grace ${r.maintenance.gracePeriods} periods)` : ''}`).join('; ')}`
    case 'bonus':
      return bonusText(item.b)
    case 'constraint':
      return item.c.kind === 'limit.max_per_period'
        ? `Limits ${item.c.scope.join(', ')} to ${minorText(item.c.maxMinor)} per participant per period`
        : `Limits the share of ${item.c.scope.join(', ')} paid on ${item.c.purpose} orders to ${pct(item.c.maxShare)}`
    case 'cap': {
      const c = item.c
      const base = c.base.kind === 'measure' ? `the market's ${c.base.measure}` : `the order-structure base of ${c.base.first} and ${c.base.second}`
      const method = c.method.type === 'priority' ? `priority (reduce ${c.method.reduce.join(', ')} in that order)` : c.method.type === 'per_person' ? 'per person' : 'proportional'
      return `Caps ${c.scope.join(', ')} at ${pct(c.rate)} of ${base}; method ${method}; breakage: removed amounts are not earned`
    }
    case 'carry': {
      const c = item.c
      return `Carries ${c.measure} forward${c.capMinor === null ? '' : ` up to ${minorText(c.capMinor)}`}${c.keepIf ? ` while holding ${rankText(c.keepIf)}` : ''}${c.expiresAfterPeriods === null ? '' : `, expiring after ${c.expiresAfterPeriods} periods`}`
    }
    case 'counter':
      return `Counts consecutive periods holding ${rankText(item.c.incrementIf)}`
    case 'points':
      return `Converts points to currency at ${item.p.factor} in market ${item.p.marketId} from ${item.p.effectiveFromUs} µs`
    case 'rollUp':
      return `Splits end-customer ${item.r.measures.join(', ')} up the servicing chain: ${item.r.shares.map((s) => `level ${s.level} ${pct(s.share)}`).join(', ')}`
    case 'structure':
      if (rule.kind === 'genealogy.reparent_on_termination') return `On termination, the direct ${p!.tree} children move to the terminated position's parent`
      if (rule.kind === 'genealogy.change_window') return `Genealogy changes in the ${p!.tree} tree only within ${p!.withinDaysOfEnrolment} days of enrolment`
      return `At most ${p!.max} positions per participant`
  }
}

/** Plain-language text of one rule row (AC-PLN2-2). */
export function renderRule(rule: PlanRuleInput): string {
  if (validateRule(rule.kind, rule.params).length > 0) return `${rule.kind}: invalid parameters (see the validation errors)`
  const text = itemText(itemOf(rule), rule)
  return rule.calendarId === null ? text : `${text} (one calendar only)`
}
