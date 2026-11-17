// Tier-2 expressions (E-ADR-41, E-ADR-42, FR-PLN-003): a typed JSON AST, checked at plan validation (shape, types,
// bounds) and evaluated per position in exact rational arithmetic. A derived measure is rounded half-up to a whole
// minor unit once per position (E-ADR-41: one rounding per derived value). Division by zero fails the run naming the
// rule and the position. Pure: no clock, randomness or I/O; positions by index.
import { EngineError } from './errors.js'
import { assertInt64, parseDecimal, RATE_SCALE } from './money.js'
import type { RunContext } from './pipeline.js'
import type { AggregateKind, Expr, ExprOp, QualificationStateRow, TreeKind } from './types.js'

export const EXPRESSION_MAX_NODES = 64
export const EXPRESSION_MAX_DEPTH = 16

export type ExprType = 'num' | 'bool'
export interface PlanIssue { readonly path: string; readonly code: string; readonly message: string }

const KEY = /^[a-z][a-z0-9_]{0,63}$/
const STATE = /^(carry|counter)\.[a-z][a-z0-9_]{0,63}$/
const DECIMAL = /^(0|[1-9]\d{0,17})(\.\d{1,6})?$/
const MINOR = /^(0|[1-9]\d{0,17})$/
const NUM_OPS: readonly ExprOp[] = ['add', 'sub', 'mul', 'div', 'min', 'max']
const COMPARE_OPS: readonly ExprOp[] = ['gte', 'gt', 'lte', 'lt', 'eq']
const BOOL_OPS: readonly ExprOp[] = ['and', 'or', 'not']
const OPS: readonly ExprOp[] = [...NUM_OPS, ...COMPARE_OPS, ...BOOL_OPS, 'if']
const AGGREGATES: readonly AggregateKind[] = ['sum', 'max', 'min', 'count']
const TREES: readonly TreeKind[] = ['sponsor', 'placement']
/** Exact argument count; null = two or more. */
const ARITY: Readonly<Record<ExprOp, number | null>> = {
  add: null, sub: 2, mul: null, div: 2, min: null, max: null, if: 3, gte: 2, gt: 2, lte: 2, lt: 2, eq: 2, and: null, or: null, not: 1,
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v)
const has = (v: Readonly<Record<string, unknown>>, k: string): boolean => Object.hasOwn(v, k)
/** Sorted own keys of an untrusted JSON object: membership checks only, so the order cannot leak into results. */
const keysOf = (v: Readonly<Record<string, unknown>>): string[] => Reflect.ownKeys(v).filter((k): k is string => typeof k === 'string').sort()

// ---------------------------------------- validation ----------------------------------------

interface Walk { nodes: number; readonly issues: PlanIssue[] }

/**
 * Shape, type and bound check of untrusted JSON as an expression of type `want`. Codes: EXPRESSION_INVALID (shape),
 * EXPRESSION_TYPE, EXPRESSION_TOO_LARGE (more than 64 nodes or deeper than 16: "evaluation bound exceeded"),
 * PROFILE_FACTS_UNAVAILABLE (no participant-fact store exists, PLAN D-B3-18). References are checked by validatePlan.
 */
export function checkExpression(value: unknown, want: ExprType, path: string): PlanIssue[] {
  const walk: Walk = { nodes: 0, issues: [] }
  let deepest = 0
  const visit = (v: unknown, at: string, depth: number): ExprType | null => {
    walk.nodes += 1
    if (depth > deepest) deepest = depth
    return nodeType(v, at, depth, walk, visit)
  }
  const got = visit(value, path, 1)
  if (walk.nodes > EXPRESSION_MAX_NODES || deepest > EXPRESSION_MAX_DEPTH) {
    walk.issues.push({ path, code: 'EXPRESSION_TOO_LARGE', message: `evaluation bound exceeded: at most ${EXPRESSION_MAX_NODES} nodes and depth ${EXPRESSION_MAX_DEPTH}` })
  }
  if (got !== null && got !== want) walk.issues.push({ path, code: 'EXPRESSION_TYPE', message: `the expression must be ${want === 'num' ? 'a number' : 'a condition'}` })
  return walk.issues
}

type Visit = (v: unknown, at: string, depth: number) => ExprType | null

function nodeType(v: unknown, at: string, depth: number, walk: Walk, visit: Visit): ExprType | null {
  const bad = (message: string): null => {
    walk.issues.push({ path: at, code: 'EXPRESSION_INVALID', message })
    return null
  }
  if (!isRecord(v)) return bad('an expression node is an object')
  const keys = keysOf(v).join(',')
  if (keys === 'const') return typeof v.const === 'string' && DECIMAL.test(v.const) ? 'num' : bad('const is a non-negative decimal string with at most 6 places')
  if (keys === 'measure') return typeof v.measure === 'string' && KEY.test(v.measure) ? 'num' : bad('measure names a measure key')
  if (keys === 'state') return typeof v.state === 'string' && STATE.test(v.state) ? 'num' : bad('state is carry.<key> or counter.<key>')
  if (keys === 'equals,fact') {
    walk.issues.push({ path: at, code: 'PROFILE_FACTS_UNAVAILABLE', message: 'participant profile facts are not available yet' })
    return 'bool'
  }
  if (keys === 'agg,atLeastMinor,of,tree') {
    const ok = AGGREGATES.includes(v.agg as AggregateKind) && typeof v.of === 'string' && KEY.test(v.of) && TREES.includes(v.tree as TreeKind)
      && (v.atLeastMinor === null || (v.agg === 'count' && typeof v.atLeastMinor === 'string' && MINOR.test(v.atLeastMinor)))
    return ok ? 'num' : bad('agg is sum|max|min|count of a measure over sponsor|placement children; atLeastMinor only for count')
  }
  if (keys !== 'args,op') return bad('unknown expression node')
  const op = v.op as ExprOp
  if (!OPS.includes(op) || !Array.isArray(v.args)) return bad('op is a known operator with an args array')
  const arity = ARITY[op]
  if (arity === null ? v.args.length < 2 : v.args.length !== arity) return bad(`${op} takes ${arity === null ? 'two or more' : arity} arguments`)
  const types = v.args.map((a: unknown, i: number) => visit(a, `${at}.args[${i}]`, depth + 1))
  const expect = (i: number, t: ExprType): void => {
    if (types[i] !== null && types[i] !== t) walk.issues.push({ path: `${at}.args[${i}]`, code: 'EXPRESSION_TYPE', message: `${op} needs ${t === 'num' ? 'a number' : 'a condition'} here` })
  }
  if (op === 'if') {
    expect(0, 'bool')
    if (types[1] !== null && types[2] !== null && types[1] !== types[2]) walk.issues.push({ path: at, code: 'EXPRESSION_TYPE', message: 'both branches of if have one type' })
    return types[1] ?? types[2] ?? null
  }
  const argType: ExprType = BOOL_OPS.includes(op) ? 'bool' : 'num'
  types.forEach((_, i) => expect(i, argType))
  return NUM_OPS.includes(op) ? 'num' : 'bool'
}

/** Measures (incl. aggregated ones) and state items an expression reads, in first-seen order. */
export function expressionRefs(expr: Expr): { readonly measures: string[]; readonly states: string[] } {
  const measures: string[] = []
  const states: string[] = []
  const visit = (e: Expr): void => {
    if ('measure' in e) measures.push(e.measure)
    else if ('agg' in e) measures.push(e.of)
    else if ('state' in e) states.push(e.state)
    else if ('op' in e) e.args.forEach(visit)
  }
  visit(expr)
  return { measures: [...new Set(measures)], states: [...new Set(states)] }
}

const INFIX: Partial<Readonly<Record<ExprOp, string>>> = { add: '+', sub: '-', mul: '×', div: '÷', gte: '≥', gt: '>', lte: '≤', lt: '<', eq: '=', and: 'and', or: 'or' }

/** Plain-language text of an expression (also its verbatim form in rule renderings). */
export function renderExpression(e: Expr): string {
  if ('const' in e) return e.const
  if ('measure' in e) return e.measure
  if ('state' in e) return `prior-period ${e.state}`
  if ('fact' in e) return `profile ${e.fact} is "${e.equals}"`
  if ('agg' in e) {
    const at = e.atLeastMinor === null ? '' : ` reaching ${e.atLeastMinor}`
    return e.agg === 'count' ? `count of ${e.tree} children${at} in ${e.of}` : `${e.agg} of ${e.of} over ${e.tree} children`
  }
  const args = e.args.map(renderExpression)
  if (e.op === 'if') return `(if ${args[0]} then ${args[1]} else ${args[2]})`
  if (e.op === 'not') return `not ${args[0]}`
  const infix = INFIX[e.op]
  return infix === undefined ? `${e.op}(${args.join(', ')})` : `(${args.join(` ${infix} `)})`
}

// ---------------------------------------- evaluation ----------------------------------------

/** n / d with d > 0. */
interface Q { readonly n: bigint; readonly d: bigint }

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a
  let y = b
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}
const reduce = (n: bigint, d: bigint): Q => {
  const g = gcd(n, d)
  return g > 1n ? { n: n / g, d: d / g } : { n, d }
}
const cmp = (a: Q, b: Q): number => {
  const l = a.n * b.d
  const r = b.n * a.d
  return l < r ? -1 : l > r ? 1 : 0
}
const add = (a: Q, b: Q): Q => (a.d === b.d ? { n: a.n + b.n, d: a.d } : reduce(a.n * b.d + b.n * a.d, a.d * b.d))
const neg = (a: Q): Q => ({ n: -a.n, d: a.d })

/** What a compiled expression reads, by position index. */
export interface ExprEnv {
  readonly ctx: RunContext
  readonly rule: string
  readonly measure: (key: string) => BigInt64Array
  readonly prior: readonly (QualificationStateRow | null)[]
}

type Num = (k: number) => Q
type Bool = (k: number) => boolean

const invalid = (message: string, details: Readonly<Record<string, string>>): EngineError => new EngineError('INVALID_INPUT', message, details)

function compileNum(e: Expr, env: ExprEnv): Num {
  if ('const' in e) {
    const q = reduce(parseDecimal(e.const), RATE_SCALE)
    return () => q
  }
  if ('measure' in e) {
    const values = env.measure(e.measure)
    return (k) => ({ n: values[k]!, d: 1n })
  }
  if ('state' in e) return stateLeaf(e.state, env)
  if ('agg' in e) return aggregate(e, env)
  if (!('op' in e)) throw invalid('a condition is used as a number', { rule: env.rule })
  const args = e.args.map((a) => compileNum(a, env))
  const [a, b] = args as [Num, Num]
  switch (e.op) {
    case 'add':
      return (k) => args.reduce((acc, f) => add(acc, f(k)), { n: 0n, d: 1n })
    case 'sub':
      return (k) => add(a(k), neg(b(k)))
    case 'mul':
      return (k) => args.reduce((acc, f) => {
        const v = f(k)
        return reduce(acc.n * v.n, acc.d * v.d)
      }, { n: 1n, d: 1n })
    case 'div':
      return (k) => {
        const x = a(k)
        const y = b(k)
        if (y.n === 0n) throw invalid('division by zero in an expression', { rule: env.rule, positionId: env.ctx.positions[k]!.positionId })
        return y.n < 0n ? reduce(-x.n * y.d, x.d * -y.n) : reduce(x.n * y.d, x.d * y.n)
      }
    case 'min':
      return (k) => args.map((f) => f(k)).reduce((m, v) => (cmp(v, m) < 0 ? v : m))
    case 'max':
      return (k) => args.map((f) => f(k)).reduce((m, v) => (cmp(v, m) > 0 ? v : m))
    case 'if': {
      const test = compileBool(e.args[0]!, env)
      const [then, otherwise] = [compileNum(e.args[1]!, env), compileNum(e.args[2]!, env)]
      return (k) => (test(k) ? then(k) : otherwise(k))
    }
    default:
      throw invalid('a condition is used as a number', { rule: env.rule })
  }
}

function compileBool(e: Expr, env: ExprEnv): Bool {
  if ('fact' in e) {
    const { ctx } = env
    return (k) => ctx.participants.get(ctx.ownerOf[k]!)?.facts.find((f) => f.key === e.fact)?.value === e.equals
  }
  if (!('op' in e)) throw invalid('a number is used as a condition', { rule: env.rule })
  switch (e.op) {
    case 'and': {
      const args = e.args.map((a) => compileBool(a, env))
      return (k) => args.every((f) => f(k))
    }
    case 'or': {
      const args = e.args.map((a) => compileBool(a, env))
      return (k) => args.some((f) => f(k))
    }
    case 'not': {
      const arg = compileBool(e.args[0]!, env)
      return (k) => !arg(k)
    }
    case 'if': {
      const [test, then, otherwise] = e.args.map((a) => compileBool(a, env)) as [Bool, Bool, Bool]
      return (k) => (test(k) ? then(k) : otherwise(k))
    }
    case 'gte': case 'gt': case 'lte': case 'lt': case 'eq': {
      const [a, b] = e.args.map((x) => compileNum(x, env)) as [Num, Num]
      const holds = { gte: (c: number) => c >= 0, gt: (c: number) => c > 0, lte: (c: number) => c <= 0, lt: (c: number) => c < 0, eq: (c: number) => c === 0 }[e.op]
      return (k) => holds(cmp(a(k), b(k)))
    }
    default:
      throw invalid('a number is used as a condition', { rule: env.rule })
  }
}

/** E-ADR-42: the prior period's balance after transitions; a position without one reads 0. */
function stateLeaf(item: string, env: ExprEnv): Num {
  const [kind, key] = item.split('.') as ['carry' | 'counter', string]
  return (k) => {
    const row = env.prior[k] ?? null
    const n = kind === 'carry' ? (row?.carry.find((c) => c.key === key)?.amountMinor ?? 0n) : BigInt(row?.counters.find((c) => c.key === key)?.value ?? 0)
    return { n, d: 1n }
  }
}

function aggregate(e: Extract<Expr, { readonly agg: AggregateKind }>, env: ExprEnv): Num {
  const tree = env.ctx.trees[e.tree]
  const values = env.measure(e.of)
  return (k) => {
    let acc: bigint | null = null
    for (let c = tree.childStart[k]!; c < tree.childStart[k + 1]!; c++) {
      const v = values[tree.childList[c]!]!
      if (e.agg === 'count') acc = (acc ?? 0n) + (e.atLeastMinor === null || v >= e.atLeastMinor ? 1n : 0n)
      else if (acc === null) acc = v
      else acc = e.agg === 'sum' ? acc + v : e.agg === 'max' ? (v > acc ? v : acc) : v < acc ? v : acc
    }
    return { n: acc ?? 0n, d: 1n }
  }
}

/** Half-up to a whole minor unit (ties away from zero), the one rounding of a derived value. */
const roundHalfUp = (q: Q): bigint => {
  const magnitude = q.n < 0n ? -q.n : q.n
  const rounded = (magnitude * 2n + q.d) / (2n * q.d)
  return q.n < 0n ? -rounded : rounded
}

/** measure.derived: one value per position, rounded once. */
export function derivedValues(expr: Expr, env: ExprEnv): BigInt64Array {
  const f = compileNum(expr, env)
  return BigInt64Array.from(env.ctx.positions, (_, k) => assertInt64(roundHalfUp(f(k)), `derived measure ${env.rule}`))
}

/** Requirement kind expression: whether the condition holds, by position index. */
export function conditionOf(expr: Expr, env: ExprEnv): Bool {
  return compileBool(expr, env)
}
