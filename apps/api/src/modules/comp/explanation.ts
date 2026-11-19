import { formatUnits, RAW_DECIMALS, toRaw, traceAmountMinor, type Trace, type TraceSource, type TraceStep } from '@nmp/engine'
import type { OriginKind } from './statements.js'

// FR-DIST-002 (D-B5-08): the distributor's explanation of one result line, a pure template over the stored compact
// trace. Sources are aggregated per level: no other position's id, ref or name ever appears (C-B5-15). English only.

export interface PeriodDates { readonly starts_at: Date; readonly ends_at: Date }

export interface ExplanationInput {
  readonly line: { readonly id: string; readonly run_id: string; readonly amount_minor: string; readonly currency: string }
  readonly trace: Trace
  readonly rule: { readonly key: string; readonly name: string | null }
  readonly period: PeriodDates
  readonly origin: { readonly kind: OriginKind; readonly original_period: (PeriodDates & { readonly id: string }) | null } | null
  readonly minorDigits: number
}

export interface Part {
  readonly level: number | null
  readonly label: string
  readonly count: number
  readonly base: string | null
  readonly base_unit: 'money' | 'volume' | null
  readonly rate: string | null
  readonly contribution: string
}

/** Opening sentence per engine bonus kind (template = kind without "pay."); any other kind is explained generically. */
const TEMPLATES: Readonly<Record<string, string>> = {
  'pay.retail_margin': 'A margin on the sales to your customers.',
  'pay.percent_by_level': 'A percentage of the volume of each level of your team, at the rate of that level.',
  'pay.generations': 'A percentage of the volume of each generation of your team.',
  'pay.percent_of_measure': 'A percentage of a volume, at the rate of your paid-as rank.',
  'pay.differential': 'The difference between your rate and the rates already paid below you, applied to the volume.',
  'pay.override': 'An override on the volume of the levels below you.',
  'pay.matching': 'A match on bonuses earned by your team, per generation.',
  'pay.fast_start': 'A fast-start bonus on the first orders of newly enrolled positions.',
  'pay.flat': 'A fixed amount for the period.',
  'pay.one_time': 'A one-time amount.',
  'pay.pool': 'Your share of a pool funded from the market total.',
  adjustment: 'An adjustment of an earlier period.',
}

const TRACE_BIGINTS = new Set(['raw', 'base', 'capMinor', 'num', 'den', 'beforeRaw', 'afterRaw', 'afterMinor', 'weight', 'totalMinor', 'minor', 'knownAtUs'])

/** The stored trace (jsonb text, bigints as decimal strings) as the engine's Trace. */
export function traceFromJson(text: string): Trace {
  return JSON.parse(text, (key, value: unknown) => (TRACE_BIGINTS.has(key) && typeof value === 'string' ? BigInt(value) : value)) as Trace
}

/** Raw (minor x 10^12) as a decimal with at least `digits` places and no trailing zeros beyond them. */
export function rawDecimal(raw: bigint, digits: number): string {
  const [whole, fraction = ''] = formatUnits(raw, digits + RAW_DECIMALS, true).split('.')
  return `${whole}.${fraction.padEnd(digits, '0')}`.replace(/\.$/, '')
}

const sourceRaw = (s: TraceSource): bigint => (s.baseScale === 'minor' ? toRaw(s.base) : s.base)

function partOf(sources: readonly TraceSource[], level: number | null, label: string, digits: number): Part {
  const rates = new Set(sources.flatMap((s) => (s.rate === null ? [] : [s.rate])))
  return {
    level, label, count: sources.length,
    base: rawDecimal(sources.reduce((a, s) => a + sourceRaw(s), 0n), digits),
    base_unit: sources.every((s) => s.measure === null) ? 'money' : 'volume',
    rate: rates.size === 0 ? null : rates.size === 1 ? [...rates][0]! : 'rates vary',
    contribution: rawDecimal(sources.reduce((a, s) => a + s.raw, 0n), digits),
  }
}

/** Sources per level; the payee's own position is "your own volume" and the market total its own part. */
export function partsOf(trace: Trace, digits: number): Part[] {
  const own = trace.sources.filter((s) => s.positionId === trace.payeePositionId)
  const market = trace.sources.filter((s) => s.positionId === null)
  const others = trace.sources.filter((s) => s.positionId !== null && s.positionId !== trace.payeePositionId)
  const levels = [...new Set(others.map((s) => s.level))].sort((a, b) => (a ?? -1) - (b ?? -1))
  const word = trace.kind === 'pay.generations' || trace.kind === 'pay.matching' ? 'generation' : 'level'
  return [
    ...(own.length === 0 ? [] : [partOf(own, own[0]!.level, 'your own volume', digits)]),
    ...levels.map((level) => partOf(others.filter((s) => s.level === level), level, level === null ? 'your team' : `${word} ${level}`, digits)),
    ...(market.length === 0 ? [] : [partOf(market, null, 'market total', digits)]),
    ...(trace.omitted.count === 0 ? [] : [{
      level: null, label: `${trace.omitted.count} further sources`, count: trace.omitted.count, base: null, base_unit: null, rate: null,
      contribution: rawDecimal(trace.omitted.raw, digits),
    }]),
  ]
}

function stepText(step: Exclude<TraceStep, { step: 'rounding' }>, digits: number): string {
  const raw = (r: bigint) => rawDecimal(r, digits)
  const money = (m: bigint) => formatUnits(m, digits)
  if (step.step === 'constraint') return `Limit ${step.key}: ${raw(step.beforeRaw)} reduced to ${raw(step.afterRaw)}.`
  if (step.step === 'cap') return `Cap ${step.key} (${step.method}): ${raw(step.beforeRaw)} capped to ${money(step.afterMinor)}.`
  if (step.step === 'allocation') return `Allocation ${step.key}: weight ${step.weight} of ${money(step.totalMinor)} gives ${money(step.afterMinor)}.`
  return `Points converted at ${step.factor}: ${raw(step.beforeRaw)} becomes ${raw(step.afterRaw)}.`
}

const day = (at: Date): string => at.toISOString().slice(0, 10)

export type Explanation = ReturnType<typeof explainLine>

/**
 * The explanation body (API-29). `template` is 'generic' for a kind without a template (the caller logs it);
 * `reconciles` = the engine's traceAmountMinor equals the line amount (the caller refuses a mismatch).
 */
export function explainLine(input: ExplanationInput) {
  const { trace, minorDigits: digits } = input
  const intro = TEMPLATES[trace.kind]
  const template = intro === undefined ? 'generic' : trace.kind.replace(/^pay\./, '')
  const parts = partsOf(trace, digits)
  const steps = trace.steps.flatMap((s) => (s.step === 'rounding' ? [] : [{ kind: s.step === 'constraint' ? 'limit' : s.step, text: stepText(s, digits) }]))
  const roundingStep = trace.steps.find((s): s is Extract<TraceStep, { step: 'rounding' }> => s.step === 'rounding')
  const rounding = roundingStep === undefined ? null
    : { mode: roundingStep.mode, before: rawDecimal(roundingStep.raw, digits), after: formatUnits(roundingStep.minor, digits) }
  const amount = formatUnits(BigInt(input.line.amount_minor), digits)
  const ranks = trace.rankEvaluated.map((r) => `${r.ladder} ${r.rank ?? 'none'}`).join(', ')
  const origin = input.origin
  const text = [
    intro ?? `This bonus (${trace.kind}) was calculated from the inputs below.`,
    `Rule: ${input.rule.name ?? input.rule.key}.`,
    ...(ranks === '' ? [] : [`Rank used: ${ranks}.`]),
    `Period: ${day(input.period.starts_at)} to ${day(input.period.ends_at)}.`,
    ...parts.map((p) => `${p.label}: ${p.count} ${p.count === 1 ? 'source' : 'sources'}${p.base === null ? '' : `, base ${p.base}`}${p.rate === null ? '' : `, rate ${p.rate}`}, contribution ${p.contribution}.`),
    ...steps.map((s) => s.text),
    ...(rounding === null ? [] : [`Rounded ${rounding.mode.replace('_', ' ')}: ${rounding.before} to ${rounding.after}.`]),
    ...(origin === null ? [] : [`Origin: ${origin.kind.replace('_', ' ')}${origin.original_period === null ? '' : ` of the period ${day(origin.original_period.starts_at)} to ${day(origin.original_period.ends_at)}`}.`]),
    `Amount: ${amount} ${input.line.currency}.`,
  ]
  return {
    line_id: input.line.id, run_id: input.line.run_id, template,
    rule: { key: input.rule.key, name: input.rule.name, kind: trace.kind },
    period: { starts_at: input.period.starts_at, ends_at: input.period.ends_at },
    amount_minor: input.line.amount_minor, currency: input.line.currency, rank_used: trace.rankEvaluated, parts, steps, rounding, origin, text,
    reconciles: traceAmountMinor(trace) === BigInt(input.line.amount_minor),
  }
}
